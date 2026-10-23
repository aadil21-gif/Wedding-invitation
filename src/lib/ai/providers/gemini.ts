import { GoogleGenAI } from "@google/genai";
import { PROVIDER_CONFIG } from "../config";
import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderUnavailableError,
  RateLimitError,
} from "../types";

const config = PROVIDER_CONFIG.gemini;

/** Statuses where trying a different model on the same key can still work. */
const TRY_NEXT_MODEL = new Set([429, 500, 503]);

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown } | null;
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  return undefined;
}

export function createGeminiProvider(apiKey: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    id: config.id,
    dataPolicy: config.dataPolicy,
    capabilities: config.capabilities,
    modelId: config.modelIds[0],
    async chat(request: ChatRequest): Promise<ChatResponse> {
      type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
      const contents: { role: string; parts: Part[] }[] = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content } as Part],
        }));

      const systemInstruction = request.messages.find((m) => m.role === "system")?.content;

      const lastTurn = contents[contents.length - 1];
      for (const image of request.images ?? []) {
        lastTurn?.parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
      }

      let lastError: unknown;
      let lastStatus: number | undefined;

      for (const modelId of config.modelIds) {
        try {
          const response = await client.models.generateContent({
            model: modelId,
            contents,
            ...(systemInstruction ? { config: { systemInstruction } } : {}),
          });
          return { text: response.text ?? "", providerId: config.id, modelId };
        } catch (err) {
          lastError = err;
          lastStatus = statusOf(err);
          if (lastStatus !== undefined && TRY_NEXT_MODEL.has(lastStatus)) {
            console.error(`[ai] gemini ${modelId} busy (${lastStatus}), trying next model`);
            continue;
          }
          // A bad key or a bad request will fail on every model: stop here.
          break;
        }
      }

      if (lastStatus === 429) throw new RateLimitError(config.id);
      throw new ProviderUnavailableError(config.id, lastError, lastStatus);
    },
  };
}
