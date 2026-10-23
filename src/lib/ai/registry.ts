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
    // Aborted/timeout has no status: the provider was too slow.
    if (err.status === undefined && /abort|timed? ?out/i.test(err.message)) return "busy";
  }
  return "error";
}

/** Total time one routed request may take; the route's maxDuration is 60s. */
const REQUEST_BUDGET_MS = 50_000;
/** If the first provider has not answered in this long, start the next one too. */
const HEDGE_MS = 4_500;
/** Providers that just failed go to the back of the line for a while. */
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS: Record<UnavailableReason, number> = {
  no_key: 0,
  busy: 45_000,
  rate_limited: 90_000,
  key_rejected: 10 * 60_000,
  error: 30_000,
};

/**
 * Routes a chat request across the feature's providers automatically.
 *
 * - Providers without a key are skipped.
 * - Providers that failed in the last minute or so go to the back of the line.
 * - If the front provider is slow (4.5 s) the next one starts in parallel
 *   and the first answer wins, so one overloaded provider does not stall you.
 * - Health features may only use no_train providers unless the caller allows it.
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

  const now = Date.now();
  const providers = chain
    .map((id) => ({ id, provider: buildProvider(id) }))
    .filter((p): p is { id: string; provider: AIProvider } => !!p.provider)
    .sort(
      (a, b) =>
        Number((cooldownUntil.get(a.id) ?? 0) > now) - Number((cooldownUntil.get(b.id) ?? 0) > now)
    );

  const skipped: { providerId: string; reason: UnavailableReason }[] = [];
  if (providers.length === 0) {
    return { text: "", providerId: "none", modelId: "none", unavailable: true, reason: "no_key", skipped };
  }

  const deadline = now + REQUEST_BUDGET_MS;

  return new Promise<ChatResult>((resolve) => {
    let next = 0;
    let active = 0;
    let finished = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: ChatResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(hedge);
      clearTimeout(overall);
      resolve(result);
    };

    const giveUp = () => {
      // The most useful reason: a rejected key outranks busy, then rate limit.
      const rank: UnavailableReason[] = ["key_rejected", "busy", "rate_limited", "error"];
      const reason: UnavailableReason =
        rank.find((r) => skipped.some((s) => s.reason === r)) ?? "busy";
      finish({ text: "", providerId: "none", modelId: "none", unavailable: true, reason, skipped });
    };

    const overall = setTimeout(giveUp, REQUEST_BUDGET_MS);

    const launch = (): boolean => {
      if (finished || next >= providers.length) return false;
      const { id, provider } = providers[next++];
      active++;
      provider
        .chat(request, { deadline })
        .then((result) => {
          cooldownUntil.delete(id);
          finish({ ...result, skipped });
        })
        .catch((err) => {
          const reason = reasonFor(err);
          console.error(`[ai] ${id} failed (${reason})`, err instanceof RateLimitError ? "" : err);
          cooldownUntil.set(id, Date.now() + COOLDOWN_MS[reason]);
          skipped.push({ providerId: id, reason });
          active--;
          if (finished) return;
          if (!launch() && active === 0) giveUp();
        });
      clearTimeout(hedge);
      hedge = setTimeout(() => {
        launch();
      }, HEDGE_MS);
      return true;
    };

    launch();
  });
}
