import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_COOKIE_VALUE, passcodeConfigured } from "@/lib/auth";
import { checkPasscode } from "@/lib/passcode";

export async function POST(request: NextRequest) {
  if (!passcodeConfigured()) {
    return NextResponse.json(
      { error: "APP_PASSCODE is not configured on this deployment." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  if (!checkPasscode(passcode)) {
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }

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
