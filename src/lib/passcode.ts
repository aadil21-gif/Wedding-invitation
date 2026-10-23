import { timingSafeEqual } from "node:crypto";

/** Node-runtime only — import this from route handlers, never from middleware.ts. */
export function checkPasscode(candidate: string): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  // Avoids leaking passcode length/prefix via response-time differences.
  return timingSafeEqual(a, b);
}
