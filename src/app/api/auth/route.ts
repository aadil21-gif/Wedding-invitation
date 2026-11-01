import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_COOKIE_VALUE, passcodeConfigured } from "@/lib/auth";
import { checkPasscode } from "@/lib/passcode";
import { authThrottled, authFailed, authOk } from "@/lib/authThrottle";

export async function POST(request: NextRequest) {
  if (!passcodeConfigured()) {
    return NextResponse.json(
      { error: "APP_PASSCODE is not configured on this deployment." },
      { status: 503 }
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (authThrottled(ip)) {
    return NextResponse.json({ error: "Too many attempts. Wait 15 minutes." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  if (!checkPasscode(passcode)) {
    authFailed(ip);
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }

  authOk(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, AUTH_COOKIE_VALUE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days — re-enter after that, by design
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(AUTH_COOKIE);
  return response;
}
