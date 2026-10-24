import { NextRequest, NextResponse } from "next/server";
import { routeChat } from "@/lib/ai/registry";
import { parseModelJson } from "@/lib/agent/run";

export const maxDuration = 30;

const KINDS = {
  fact:
    "Tell him ONE short, genuinely interesting and TRUE fact (science, medicine, history, language, how things work, or a French word of the day with its meaning). Under 35 words. Start with a hook like 'Random thought:' or 'Did you know'. Only say things you are certain are true; if unsure pick a famous well-established fact.",
  usage:
    "Look at how he used his phone today. If something looks like time-wasting (social media, games, video) for long, call it out in a playful but pointed way and suggest ONE concrete better thing to do next (10 minutes of French, a walk, work on his projects). If usage looks fine, praise him briefly. Under 40 words. Never shame him, tease him.",
  observe:
    "You see through his camera what is in front of him. Make ONE short, funny or useful remark about what you see (under 25 words). If it is a medicine, name it and say to check the label. If nothing interesting is visible or you cannot tell what it is, return an empty say.",
  morning:
    "Give a quick, upbeat morning briefing opener in under 40 words using the date and his reminders. End with one nudge for the day.",
  idle:
    "He has been quiet for a while. Say one short friendly line: a fun question, a tease, or a tiny challenge (like a quick French phrase). Under 25 words.",
} as const;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const kind = (Object.keys(KINDS) as (keyof typeof KINDS)[]).find((k) => k === body?.kind);
  if (!kind) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (v: unknown, n: number, len: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, len)) : [];
  const image = typeof body?.image === "string" && /^[A-Za-z0-9+/=]+$/.test(body.image) && body.image.length < 2_400_000 ? body.image : null;

  const context = [
    `Now: ${str(body?.nowIso, 40) || new Date().toISOString()}.`,
    list(body?.usage, 8, 60).length ? `Phone use today: ${list(body?.usage, 8, 60).join(", ")}.` : "",
    list(body?.reminders, 5, 100).length ? `Reminders: ${list(body?.reminders, 5, 100).join("; ")}.` : "",
    list(body?.facts, 10, 140).length ? `About him: ${list(body?.facts, 10, 140).join("; ")}.` : "",
  ].filter(Boolean).join("\n");

  const system = [
    "You are SEEFAR, the witty friend-and-assistant voice inside Aadil's phone (a pharmacist in Pakistan who is learning French and building startups). Your words are spoken aloud: plain text, no markdown, no emoji.",
    KINDS[kind],
    context,
    'Reply with ONE JSON object only: {"say":"..."}.',
  ].filter(Boolean).join("\n");

  const result = await routeChat(image ? "vision" : "chat", {
    messages: [{ role: "system", content: system }, { role: "user", content: "Go." }],
    json: true,
    ...(image ? { images: [image] } : {}),
  });
  if (result.unavailable) return NextResponse.json({ say: "" }, { status: 503 });
  const say = (parseModelJson(result.text)?.say as string | undefined)?.toString().trim().slice(0, 300) ?? "";
  return NextResponse.json({ say });
}
