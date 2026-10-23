import { FEATURE_PROVIDER_ORDER, PROVIDER_CONFIG } from "./config";
import { createGeminiProvider } from "./providers/gemini";
import {
  AIFeature,
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderUnavailableError,
  RateLimitError,
  UnavailableReason,
} from "./types";

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
  /** True if no configured provider could answer. */
  unavailable?: boolean;
  /** Why nothing answered, so the app can say something accurate. */
  reason?: UnavailableReason;
}

function reasonFor(err: unknown): UnavailableReason {
  if (err instanceof RateLimitError) return "rate_limited";
  if (err instanceof ProviderUnavailableError) {
    if (err.status === 401 || err.status === 403) return "key_rejected";
    // Google reports a rejected key as 400 API_KEY_INVALID.
    if (err.status === 400 && /API key/i.test(err.message)) return "key_rejected";
    if (err.status === 500 || err.status === 503) return "busy";
  }
  return "error";
}

/**
 * Routes a chat request to the first available, allowed provider for the
 * given feature, falling back on failures. Enforces the health-data privacy
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

  let reason: UnavailableReason = "no_key";

  for (const id of chain) {
    const provider = buildProvider(id);
    if (!provider) continue;
    try {
      return await provider.chat(request);
    } catch (err) {
      // Any provider failure: fall through to the next provider in the chain
      // rather than failing the whole feature, but remember why.
      console.error(`[ai] ${id} failed`, err instanceof RateLimitError ? "rate-limited" : err);
      reason = reasonFor(err);
      continue;
    }
  }

  return {
    text: "",
    providerId: "none",
    modelId: "none",
    unavailable: true,
    reason,
  };
}
