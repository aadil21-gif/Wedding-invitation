import { NextRequest, NextResponse } from "next/server";
import { LIMITS, MODES, Mode } from "@/lib/assistant";
import { unitOf } from "@/lib/frcourse";
import { runAgent } from "@/lib/agent/run";
import type { DeviceContext } from "@/lib/agent/types";
import type { ChatMessage } from "@/lib/ai/types";

// Provider fallback plus tool calls can take a while; Vercel's default is shorter.
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

const strList = (v: unknown, count: number, len: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").slice(0, count).map((x) => x.slice(0, len))
    : [];

function cleanContext(raw: unknown): DeviceContext {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const now = typeof c.nowIso === "string" && !Number.isNaN(Date.parse(c.nowIso)) ? c.nowIso : new Date().toISOString();
  const tz = typeof c.timeZone === "string" && /^[A-Za-z_\/+-]{1,40}$/.test(c.timeZone) ? c.timeZone : "Asia/Karachi";
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && v >= lo && v <= hi ? v : undefined;

  const lists: Record<string, string[]> = {};
  if (c.lists && typeof c.lists === "object") {
    for (const [k, v] of Object.entries(c.lists as Record<string, unknown>).slice(0, 8)) {
      lists[k.slice(0, 40)] = strList(v, 20, 80);
    }
  }
  const timers = Array.isArray(c.timers)
    ? c.timers.slice(0, 5).map((t: { label?: unknown; secondsLeft?: unknown }) => ({
        label: String(t?.label ?? "timer").slice(0, 40),
        secondsLeft: Math.max(0, Math.round(Number(t?.secondsLeft) || 0)),
      }))
    : [];
  const reminders = Array.isArray(c.reminders)
    ? c.reminders.slice(0, 5).map((r: { text?: unknown; at?: unknown }) => ({
        text: String(r?.text ?? "").slice(0, 100),
        at: String(r?.at ?? "").slice(0, 40),
      }))
    : [];

  const rb = c.robot && typeof c.robot === "object" ? (c.robot as Record<string, unknown>) : null;
  const robot = rb
    ? {
        distanceCm: typeof rb.distanceCm === "number" ? Math.round(rb.distanceCm) : null,
        cliff: rb.cliff === true,
        lifted: rb.lifted === true,
      }
    : undefined;

  return {
    nowIso: now,
    timeZone: tz,
    lat: num(c.lat, -90, 90),
    lon: num(c.lon, -180, 180),
    facts: strList(c.facts, 20, 160),
    lists,
    notes: strList(c.notes, 8, 160),
    timers,
    reminders,
    robot,
  };
}

/**
 * One endpoint for every spoken or typed turn: text, optional camera frame,
 * a mode, kid mode and device context. The agent loop (tools, actions, cards)
 * lives in lib/agent/run.ts; provider routing in lib/ai/registry.ts.
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
  const intensity = (["gentle", "spicy", "brutal"] as const).find((i) => i === body?.intensity) ?? "spicy";
  if (body?.tutor === "call" && !unitOf(body?.unit)) {
    return NextResponse.json({ error: "Unknown lesson." }, { status: 400 });
  }
  const call =
    body?.tutor === "call" && !kid && typeof body?.unit === "string"
      ? { unitId: body.unit as string, intensity }
      : undefined;
  const tutor =
    body?.tutor === "fr" && !kid
      ? {
          level: (["A1", "A2", "B1"] as const).find((l) => l === body?.level) ?? "A1",
          intensity,
        }
      : undefined;

  if (image === "invalid") {
    return NextResponse.json({ error: "That photo could not be used. Try again." }, { status: 400 });
  }
  // Every free provider may train on what it receives, so camera frames never
  // leave the phone in kid mode.
  if (kid && image) {
    return NextResponse.json({ error: "The camera is off in kid mode." }, { status: 400 });
  }

  const outcome = await runAgent({
    message,
    history: cleanHistory(body?.history),
    mode,
    kid,
    lang,
    tutor,
    call,
    character: typeof body?.character === "string" ? body.character : undefined,
    image,
    // Kid mode never receives personal memory, notes or location (robot state is fine).
    ctx: kid
      ? cleanContext({
          nowIso: body?.context?.nowIso,
          timeZone: body?.context?.timeZone,
          robot: body?.context?.robot,
        })
      : cleanContext(body?.context),
  });

  if (!outcome.ok) {
    const reason = outcome.result.reason ?? "error";
    return NextResponse.json(
      {
        error:
          image && reason === "no_key"
            ? "No provider that can see images is set up. Gemini, Groq or Mistral needs a key."
            : (UNAVAILABLE[reason] ?? UNAVAILABLE.error),
        tried: outcome.result.skipped?.map((s) => `${s.providerId}: ${s.reason}`) ?? [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ...outcome.reply,
    providerId: outcome.providerId,
    modelId: outcome.modelId,
    fellBackFrom: outcome.fellBackFrom,
  });
}
