import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_COOKIE_VALUE, passcodeConfigured } from "@/lib/auth";
import { isRateLimited } from "@/lib/rateLimit";

// Routes an unauthenticated visitor may always reach.
const PUBLIC_PATHS = ["/login", "/api/auth", "/manifest.webmanifest"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // No passcode set (local dev without .env.local yet): don't lock the
  // owner out, but never allow AI routes to run unauthenticated either.
  if (!passcodeConfigured()) {
    if (pathname.startsWith("/api/") && pathname !== "/api/auth") {
      return NextResponse.json(
        { error: "APP_PASSCODE is not configured on this deployment." },
        { status: 503 }
      );
    }
    return NextResponse.next();
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const authed = request.cookies.get(AUTH_COOKIE)?.value === AUTH_COOKIE_VALUE;
  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Rate-limit every authenticated API call before it can reach a provider.
  if (pathname.startsWith("/api/") && pathname !== "/api/auth") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
