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
const TRY_NEXT_MODEL = new Set([404, 408, 429, 500, 502, 503, 504]);
const PER_ATTEMPT_MS = 12_000;
const MODEL_LIST_TTL_MS = 10 * 60_000;
const MAX_MODELS_PER_REQUEST = 4;

interface ModelInfo {
  id: string;
  vision: boolean;
}

const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function envOf(): Record<string, string | undefined> {
  return process.env;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function discoverModels(
  cfg: CompatProviderConfig,
  baseUrl: string,
  headers: Record<string, string>
): Promise<ModelInfo[]> {
  const override = cfg.modelOverrideEnv ? envOf()[cfg.modelOverrideEnv] : undefined;
  if (override) return [{ id: override, vision: false }];

  if (cfg.discovery === "none") {
    return cfg.preferredModels.map((id) => ({ id, vision: false }));
  }

  const cached = modelCache.get(cfg.id);
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) return cached.models;

  let models: ModelInfo[];
  try {
    if (cfg.discovery === "openrouter-free") {
      const json = await getJson(`${baseUrl}/models`, headers, 6_000);
      const data: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[] };
        context_length?: number;
      }> = json.data ?? [];
      models = data
        .filter(
          (m) =>
            m.pricing?.prompt === "0" &&
            m.pricing?.completion === "0" &&
            // Skip router/placeholder entries and tiny contexts.
            (m.context_length ?? 0) >= 8_000
        )
        .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
        .map((m) => ({
          id: m.id,
          vision: m.architecture?.input_modalities?.includes("image") ?? false,
        }));
    } else {
      const json = await getJson(`${baseUrl}/models`, headers, 6_000);
      const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
      const preferred = cfg.preferredModels.filter((id) => ids.includes(id));
      models = preferred.map((id) => ({ id, vision: false }));
    }
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new ProviderUnavailableError(cfg.id, err, err.status);
    }
    // Model list unreachable: fall back to the configured names and let the
    // chat call itself report a real error.
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
      vision: cfg.vision === "discovered",
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

      let models = await discoverModels(cfg, baseUrl, headers);
      if (wantsImages) models = models.filter((m) => m.vision);
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
              ...(request.images ?? []).map((b64) => ({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${b64}` },
              })),
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
            throw new HttpError(res.status, `${res.status} ${(await res.text()).slice(0, 200)}`);
          }
          const json = await res.json();
          const content = json?.choices?.[0]?.message?.content;
          const text = typeof content === "string" ? content.trim() : "";
          if (!text) {
            lastError = new Error("empty answer");
            lastStatus = undefined;
            continue;
          }
          return { text, providerId: cfg.id, modelId: model.id };
        } catch (err) {
          lastError = err;
          lastStatus = err instanceof HttpError ? err.status : undefined;
          if (lastStatus === 401 || lastStatus === 403) break;
          if (lastStatus === undefined || TRY_NEXT_MODEL.has(lastStatus)) {
            console.error(`[ai] ${cfg.id} ${model.id} failed (${lastStatus ?? "timeout"}), trying next model`);
            continue;
          }
          break;
        }
      }

      if (lastStatus === 429) throw new RateLimitError(cfg.id);
      throw new ProviderUnavailableError(cfg.id, lastError, lastStatus);
    },
  };
}
