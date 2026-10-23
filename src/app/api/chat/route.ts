import { NextRequest, NextResponse } from "next/server";
import { routeChat } from "@/lib/ai/registry";

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
      busy: "Google's AI is overloaded right now. Wait a few seconds and ask again.",
      rate_limited: "The free AI limit was reached for now. Wait a minute and ask again.",
      key_rejected: "Google rejected the API key. Check GEMINI_API_KEY in Vercel, then redeploy.",
      error: "The AI request failed. Try again, and check the server logs if it keeps happening.",
    };
    return NextResponse.json(
      { error: messages[result.reason ?? "error"] ?? messages.error },
      { status: 503 }
    );
  }

  return NextResponse.json({
    text: result.text,
    providerId: result.providerId,
    modelId: result.modelId,
  });
}
