/** Brute-force guard for the passcode: 6 failures per IP locks it for 15 min (per instance). */
const fails = new Map<string, { n: number; until: number }>();
const MAX = 6;
const LOCK_MS = 15 * 60 * 1000;

export function authThrottled(ip: string): boolean {
  const f = fails.get(ip);
  return !!f && f.n >= MAX && Date.now() < f.until;
}
export function authFailed(ip: string): void {
  const f = fails.get(ip);
  const n = f && Date.now() < f.until + LOCK_MS ? f.n + 1 : 1;
  fails.set(ip, { n, until: Date.now() + LOCK_MS });
  if (fails.size > 500) fails.clear();
}
export function authOk(ip: string): void {
  fails.delete(ip);
}
