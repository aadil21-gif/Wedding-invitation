/**
 * Per-IP token bucket, in-memory only. This resets whenever the serverless
 * function cold-starts and does not share state across instances — on
 * Vercel that means it throttles *a* instance, not the whole deployment.
 * That's an acceptable, cheap first line of defence for a single-user app
 * behind a passcode; a shared store (e.g. Vercel KV/Upstash) would be
 * needed for a real multi-instance guarantee, and isn't worth the extra
 * paid dependency here.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

const MAX_TOKENS = 20;
const REFILL_PER_MS = MAX_TOKENS / (60 * 1000); // refills fully every 60s

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { tokens: MAX_TOKENS, updatedAt: now };

  const elapsed = now - bucket.updatedAt;
  const refreshed = Math.min(MAX_TOKENS, bucket.tokens + elapsed * REFILL_PER_MS);

  if (refreshed < 1) {
    buckets.set(ip, { tokens: refreshed, updatedAt: now });
    return true;
  }

  buckets.set(ip, { tokens: refreshed - 1, updatedAt: now });
  return false;
}
