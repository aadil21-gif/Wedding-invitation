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

function isRateLimitStatus(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ??
    (err as { status?: number; code?: number })?.code;
  return status === 429;
}

export function createGeminiProvider(apiKey: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    id: config.id,
    dataPolicy: config.dataPolicy,
    capabilities: config.capabilities,
    modelId: config.modelId,
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

      try {
        const response = await client.models.generateContent({
          model: config.modelId,
          contents,
          ...(systemInstruction ? { config: { systemInstruction } } : {}),
        });

        const text = response.text ?? "";
        return { text, providerId: config.id, modelId: config.modelId };
      } catch (err) {
        if (isRateLimitStatus(err)) {
          throw new RateLimitError(config.id);
        }
        throw new ProviderUnavailableError(config.id, err);
      }
    },
  };
}
