import { FEATURE_PROVIDER_ORDER, PROVIDER_CONFIG } from "./config";
import { createGeminiProvider } from "./providers/gemini";
import { AIFeature, AIProvider, ChatRequest, ChatResponse, RateLimitError } from "./types";

function buildProvider(id: string): AIProvider | null {
  switch (id) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      return key ? createGeminiProvider(key) : null;
    }
    // Groq, OpenRouter and Anthropic adapters land in M1/M3.
    default:
      return null;
  }
}

export interface ChatResult extends ChatResponse {
  /** True if no configured provider could answer (keys missing / all rate-limited). */
  unavailable?: boolean;
}

/**
 * Routes a chat request to the first available, allowed provider for the
 * given feature, falling back on 429s. Enforces the health-data privacy
 * rule: health features may only use no_train providers unless the caller
 * explicitly allows free providers.
 */
export async function routeChat(
  feature: AIFeature,
  request: ChatRequest,
  options: { allowTrainingProvidersForHealth?: boolean } = {}
): Promise<ChatResult> {
  let chain = FEATURE_PROVIDER_ORDER[feature] ?? [];

  if (feature === "health" && !options.allowTrainingProvidersForHealth) {
    chain = chain.filter((id) => PROVIDER_CONFIG[id]?.dataPolicy === "no_train");
  }

  for (const id of chain) {
    const provider = buildProvider(id);
    if (!provider) continue;
    try {
      return await provider.chat(request);
    } catch (err) {
      // Rate limit or any other provider failure: fall through to the next
      // provider in the chain rather than failing the whole feature.
      console.error(`[ai] ${id} failed`, err instanceof RateLimitError ? "rate-limited" : err);
      continue;
    }
  }

  return {
    text: "",
    providerId: "none",
    modelId: "none",
    unavailable: true,
  };
}
