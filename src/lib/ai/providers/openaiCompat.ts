import { COMPAT_PROVIDERS, type CompatProviderConfig } from "../config";
import {
  AIProvider,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ProviderUnavailableError,
  RateLimitError,
} from "../types";

/** Statuses where trying another model on the same key can still work. */
const TRY_NEXT_MODEL = new Set([400, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504]);
const PER_ATTEMPT_MS = 9_000;
const MODEL_LIST_TTL_MS = 10 * 60_000;
const BAD_MODEL_TTL_MS = 30 * 60_000;
const MAX_MODELS_PER_REQUEST = 5;

interface ModelInfo {
  id: string;
  vision: boolean;
}

const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();
/** "provider/model" -> time it was last refused, so a broken model is not retried every turn. */
const badModels = new Map<string, number>();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isBad(providerId: string, modelId: string) {
  const at = badModels.get(`${providerId}/${modelId}`);
  return !!at && Date.now() - at < BAD_MODEL_TTL_MS;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Families that behave as ordinary chat models. Others are tried last. */
const GOOD_FAMILY = /gemma|llama|qwen|mistral|nemotron|gpt-oss|deepseek|glm|kimi|phi/i;
/** Entries that are not usable chat models for this app. */
const EXCLUDED = /inkling|thinkingmachines|lyria|image|audio|embed|moderation|safeguard|guard/i;

async function discoverModels(
  cfg: CompatProviderConfig,
  baseUrl: string,
  headers: Record<string, string>
): Promise<ModelInfo[]> {
  const override = cfg.modelOverrideEnv ? process.env[cfg.modelOverrideEnv] : undefined;
  if (override) return [{ id: override, vision: false }];

  if (cfg.discovery === "none") {
    return cfg.preferredModels.map((id) => ({ id, vision: false }));
  }

  const cached = modelCache.get(cfg.id);
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) return cached.models;

  let models: ModelInfo[];
  try {
    const json = await getJson(`${baseUrl}/models`, headers, 6_000);
    if (cfg.discovery === "openrouter-free") {
      const data: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[]; output_modalities?: string[] };
        context_length?: number;
      }> = json.data ?? [];
      models = data
        .filter(
          (m) =>
            m.pricing?.prompt === "0" &&
            m.pricing?.completion === "0" &&
            (m.context_length ?? 0) >= 8_000 &&
            !EXCLUDED.test(m.id) &&
            (m.architecture?.output_modalities ?? ["text"]).includes("text")
        )
        .sort((a, b) => {
          const fa = GOOD_FAMILY.test(a.id) ? 0 : 1;
          const fb = GOOD_FAMILY.test(b.id) ? 0 : 1;
          return fa - fb || (b.context_length ?? 0) - (a.context_length ?? 0);
        })
        .map((m) => ({
          id: m.id,
          vision: m.architecture?.input_modalities?.includes("image") ?? false,
        }));
    } else {
      const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
      models = cfg.preferredModels.filter((id) => ids.includes(id)).map((id) => ({ id, vision: false }));
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new ProviderUnavailableError(cfg.id, err, 401);
    }
    // Model list unreachable: fall back to the configured names and let the
    // chat call itself report a real error. Retry the list soon.
    models = cfg.preferredModels.map((id) => ({ id, vision: false }));
    modelCache.set(cfg.id, { at: Date.now() - MODEL_LIST_TTL_MS + 30_000, models });
    return models;
  }

  modelCache.set(cfg.id, { at: Date.now(), models });
  return models;
}

export function isCompatConfigured(id: string): boolean {
  const cfg = COMPAT_PROVIDERS[id];
  return !!cfg && cfg.envVars.every((v) => !!process.env[v]);
}

export function createCompatProvider(id: string): AIProvider | null {
  const cfg = COMPAT_PROVIDERS[id];
  if (!cfg || !isCompatConfigured(id)) return null;
  const apiKey = process.env[cfg.envVars[0]] as string;
  const baseUrl = cfg.baseUrl(process.env);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(cfg.extraHeaders ?? {}),
  };

  return {
    id: cfg.id,
    label: cfg.label,
    dataPolicy: cfg.dataPolicy,
    capabilities: {
      vision: cfg.vision !== "never",
      streaming: false,
      toolCalling: false,
      jsonMode: false,
    },
    modelId: cfg.preferredModels[0] ?? "auto",
    async chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse> {
      const deadline = options?.deadline ?? Date.now() + 45_000;
      const wantsImages = (request.images?.length ?? 0) > 0;
      if (wantsImages && cfg.vision === "never") {
        throw new ProviderUnavailableError(cfg.id, "no verified image support", 400);
      }

      let models: ModelInfo[];
      if (wantsImages && cfg.vision === "listed") {
        models = (cfg.visionModels ?? []).map((m) => ({ id: m, vision: true }));
      } else {
        models = await discoverModels(cfg, baseUrl, headers);
        if (wantsImages) models = models.filter((m) => m.vision);
      }
      models = models.filter((m) => !isBad(cfg.id, m.id));
      if (models.length === 0) {
        throw new ProviderUnavailableError(cfg.id, "no usable model found", 404);
      }

      const messages = request.messages.map((m, i, all) => {
        const isLastUser = m.role === "user" && i === all.length - 1;
        if (isLastUser && wantsImages) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...(request.images ?? []).map((b64) => {
                const url = `data:image/jpeg;base64,${b64}`;
                return {
                  type: "image_url",
                  image_url: cfg.imageUrlAsString ? url : { url },
                };
              }),
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

      let lastError: unknown;
      let lastStatus: number | undefined;

      for (const model of models.slice(0, MAX_MODELS_PER_REQUEST)) {
        const remaining = deadline - Date.now();
        if (remaining < 2_500) break;
        try {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ model: model.id, messages }),
            signal: AbortSignal.timeout(Math.min(PER_ATTEMPT_MS, remaining - 500)),
          });
          if (!res.ok) {
            throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 300)}`);
          }
          const json = await res.json();
          const content = json?.choices?.[0]?.message?.content;
          const text = typeof content === "string" ? content.trim() : "";
          if (!text) {
            lastError = new Error("empty answer");
            lastStatus = undefined;
            badModels.set(`${cfg.id}/${model.id}`, Date.now());
            continue;
          }
          return { text, providerId: cfg.id, modelId: model.id };
        } catch (err) {
          lastError = err;
          lastStatus = err instanceof HttpError ? err.status : undefined;
          // 401 is the key itself: no other model will work.
          if (lastStatus === 401) break;
          // 400/403/404 mean this model refused the request (wrong modality,
          // "agentic harness only", retired): remember it and try another.
          if (lastStatus === 400 || lastStatus === 403 || lastStatus === 404 || lastStatus === 422) {
            badModels.set(`${cfg.id}/${model.id}`, Date.now());
          }
          if (lastStatus === undefined || TRY_NEXT_MODEL.has(lastStatus)) {
            console.error(`[ai] ${cfg.id} ${model.id} failed (${lastStatus ?? "timeout"}), trying next model`);
            continue;
          }
          break;
        }
      }

      if (lastStatus === 429) throw new RateLimitError(cfg.id);
      // A 403 here is a model refusing us, not a rejected key: report it as a
      // generic failure so Settings does not blame the API key.
      const status = lastStatus === 403 ? 424 : lastStatus;
      throw new ProviderUnavailableError(cfg.id, lastError, status);
    },
  };
}
