import { COMPAT_PROVIDERS, FEATURE_PROVIDER_ORDER, PROVIDER_CONFIG } from "./config";
import { createGeminiProvider } from "./providers/gemini";
import { createCompatProvider } from "./providers/openaiCompat";
import {
  AIFeature,
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderUnavailableError,
  RateLimitError,
  UnavailableReason,
} from "./types";

export function buildProvider(id: string): AIProvider | null {
  if (id === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    return key ? createGeminiProvider(key) : null;
  }
  return createCompatProvider(id);
}

export function dataPolicyOf(id: string) {
  return PROVIDER_CONFIG[id]?.dataPolicy ?? COMPAT_PROVIDERS[id]?.dataPolicy;
}

export interface ChatResult extends ChatResponse {
  /** True if no configured provider could answer. */
  unavailable?: boolean;
  /** Why nothing answered, so the app can say something accurate. */
  reason?: UnavailableReason;
  /** Providers that were tried and failed before the answer (or before giving up). */
  skipped?: { providerId: string; reason: UnavailableReason }[];
}

export function reasonFor(err: unknown): UnavailableReason {
  if (err instanceof RateLimitError) return "rate_limited";
  if (err instanceof ProviderUnavailableError) {
    if (err.status === 401 || err.status === 403) return "key_rejected";
    // Google reports a rejected key as 400 API_KEY_INVALID.
    if (err.status === 400 && /API key/i.test(err.message)) return "key_rejected";
    if (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504) return "busy";
  }
  return "error";
}

/** Budget for one routed request: the route's maxDuration minus headroom. */
const REQUEST_BUDGET_MS = 50_000;

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
    chain = chain.filter((id) => dataPolicyOf(id) === "no_train");
  }

  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const skipped: { providerId: string; reason: UnavailableReason }[] = [];

  for (const id of chain) {
    if (deadline - Date.now() < 2_500) break;
    const provider = buildProvider(id);
    if (!provider) continue;
    try {
      const result = await provider.chat(request, { deadline });
      return { ...result, skipped };
    } catch (err) {
      // Any provider failure: fall through to the next provider in the chain
      // rather than failing the whole feature, but remember why.
      console.error(`[ai] ${id} failed`, err instanceof RateLimitError ? "rate-limited" : err);
      skipped.push({ providerId: id, reason: reasonFor(err) });
    }
  }

  // Report the most useful reason: a rejected key outranks busy, which outranks
  // rate-limited, which outranks a generic error. No attempts means no key.
  const rank: UnavailableReason[] = ["key_rejected", "busy", "rate_limited", "error"];
  const reason: UnavailableReason =
    skipped.length === 0 ? "no_key" : rank.find((r) => skipped.some((s) => s.reason === r)) ?? "error";

  return {
    text: "",
    providerId: "none",
    modelId: "none",
    unavailable: true,
    reason,
    skipped,
  };
}
