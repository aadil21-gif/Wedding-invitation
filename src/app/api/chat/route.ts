import { NextRequest, NextResponse } from "next/server";
import { LIMITS, MODES, Mode, systemPrompt } from "@/lib/assistant";
import { routeChat } from "@/lib/ai/registry";
import type { ChatMessage } from "@/lib/ai/types";

// Fallback across several providers can take a while; Vercel's default is shorter.
export const maxDuration = 60;

const UNAVAILABLE: Record<string, string> = {
  no_key: "No AI key is set on this deployment. Add GEMINI_API_KEY in Vercel and redeploy.",
  busy: "Every AI provider that has a key is overloaded right now. Wait a few seconds and ask again.",
  rate_limited:
    "The free limits of every configured provider are used up for now. Wait a minute and ask again, or add another provider key.",
  key_rejected:
    "A provider rejected its API key. Open Settings, run the provider check, and fix the one marked rejected.",
  error: "The AI request failed on every provider. Try again, and check the server logs if it keeps happening.",
};

function cleanHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw.slice(-LIMITS.historyTurns)) {
    const role = item?.role;
    const content = typeof item?.content === "string" ? item.content.slice(0, LIMITS.message) : "";
    if ((role === "user" || role === "assistant") && content.trim()) {
      out.push({ role, content });
    }
  }
  // Providers expect the conversation to start with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function cleanImage(raw: unknown): string | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const b64 = raw.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
  if (b64.length > LIMITS.imageChars || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return "invalid";
  return b64;
}

/**
 * One endpoint for every spoken or typed turn: text, optional camera frame,
 * a mode, and kid mode. Routing and provider fallback live in routeChat.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const message =
    typeof body?.message === "string" ? body.message.trim().slice(0, LIMITS.message) : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const mode: Mode = MODES.includes(body?.mode) ? body.mode : "general";
  const kid = body?.kid === true;
  const lang = body?.lang === "ur" ? "ur" : "en";
  const image = cleanImage(body?.image);

  if (image === "invalid") {
    return NextResponse.json({ error: "That photo could not be used. Try again." }, { status: 400 });
  }
  // Every free provider may train on what it receives, so camera frames never
  // leave the phone in kid mode.
  if (kid && image) {
    return NextResponse.json({ error: "The camera is off in kid mode." }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt({ mode, kid, lang }) },
    ...cleanHistory(body?.history),
    { role: "user", content: message },
  ];

  const result = await routeChat(image ? "vision" : "chat", {
    messages,
    ...(image ? { images: [image] } : {}),
  });

  if (result.unavailable) {
    const base = UNAVAILABLE[result.reason ?? "error"] ?? UNAVAILABLE.error;
    return NextResponse.json(
      {
        error: image && result.reason === "no_key"
          ? "No provider that can see images is set up. Gemini or OpenRouter needs a key."
          : base,
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
