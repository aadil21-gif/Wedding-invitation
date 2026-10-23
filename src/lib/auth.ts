export const AUTH_COOKIE = "seefar_auth";

/**
 * Not a real session token — a single-user app has nothing to put inside
 * one. The cookie's presence plus its value matching this constant is the
 * whole check; APP_PASSCODE itself is never stored client-side.
 *
 * Deliberately free of Node-only APIs (no node:crypto) so middleware.ts,
 * which runs on the Edge runtime, can import it. checkPasscode() lives in
 * ./passcode.ts instead, imported only by the Node.js /api/auth route.
 */
export const AUTH_COOKIE_VALUE = "ok";

export function passcodeConfigured(): boolean {
  return Boolean(process.env.APP_PASSCODE);
}
