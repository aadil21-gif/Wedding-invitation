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
    return NextResponse.json(
      {
        error:
          "AI unavailable right now — no provider key is configured, or all providers are rate-limited.",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    text: result.text,
    providerId: result.providerId,
    modelId: result.modelId,
  });
}
