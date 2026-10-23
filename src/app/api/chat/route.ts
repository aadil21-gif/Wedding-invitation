import { NextRequest, NextResponse } from "next/server";
import { routeChat } from "@/lib/ai/registry";

// Fallback across several providers can take a while; Vercel's default is shorter.
export const maxDuration = 60;

/**
 * M0's "hello" call: plain text in, plain text out. Vision input, memory
 * context and tool calls are added in M1-M3; the shape of this route
 * (feature -> routeChat -> provider fallback) doesn't change.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const result = await routeChat("chat", {
    messages: [
      {
        role: "system",
        content:
          "You are SeeFar, a plainly-spoken voice assistant for a low-vision user. " +
          "Keep answers short, concrete and free of markdown — they will be read aloud.",
      },
      { role: "user", content: message },
    ],
  });

  if (result.unavailable) {
    const messages: Record<string, string> = {
      no_key: "No AI key is set on this deployment. Add GEMINI_API_KEY in Vercel and redeploy.",
      busy: "Every AI provider that has a key is overloaded right now. Wait a few seconds and ask again.",
      rate_limited: "The free limits of every configured provider are used up for now. Wait a minute and ask again, or add another provider key.",
      key_rejected: "A provider rejected its API key. Open Settings, run the provider check, and fix the one marked rejected.",
      error: "The AI request failed on every provider. Try again, and check the server logs if it keeps happening.",
    };
    return NextResponse.json(
      {
        error: messages[result.reason ?? "error"] ?? messages.error,
        tried: result.skipped?.map((s) => `${s.providerId}: ${s.reason}`) ?? [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    text: result.text,
    providerId: result.providerId,
    modelId: result.modelId,
    fellBackFrom: result.skipped?.map((s) => s.providerId) ?? [],
  });
}
