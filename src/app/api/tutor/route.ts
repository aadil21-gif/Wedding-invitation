import { NextRequest, NextResponse } from "next/server";
import { routeChat } from "@/lib/ai/registry";
import { parseModelJson } from "@/lib/agent/run";
import { DRILL_TYPES, TASKS, TUTOR_SYSTEM } from "@/lib/tutor";

export const maxDuration = 60;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const strs = (v: unknown, n: number, len: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, len)) : [];

/** Keeps only drills the app can run; returns them with stable ids. */
function cleanDrills(raw: unknown, day: number): Obj[] {
  if (!Array.isArray(raw)) return [];
  const out: Obj[] = [];
  for (const d of raw) {
    if (!isObj(d)) continue;
    const type = str(d.type, 30);
    if (!(DRILL_TYPES as readonly string[]).includes(type)) continue;
    const base: Obj = { id: `g${day}-${out.length + 1}`, type };
    if (type === "fill" || type === "translate_en_fr" || type === "translate_fr_en") {
      if (!str(d.prompt) || !str(d.answer)) continue;
      Object.assign(base, { prompt: str(d.prompt), answer: str(d.answer), accept: strs(d.accept, 6, 120) });
    } else if (type === "mcq") {
      const options = strs(d.options, 5, 120);
      if (!str(d.prompt) || options.length < 2 || !options.includes(str(d.answer, 120))) continue;
      Object.assign(base, { prompt: str(d.prompt), options, answer: str(d.answer, 120) });
    } else if (type === "order") {
      const words = strs(d.words, 12, 40);
      if (words.length < 2 || !str(d.answer)) continue;
      Object.assign(base, { words, answer: str(d.answer) });
    } else if (type === "dictation") {
      if (!str(d.audio_text) || !str(d.answer)) continue;
      Object.assign(base, { audio_text: str(d.audio_text), answer: str(d.answer) });
    } else if (type === "say_it") {
      if (!str(d.target)) continue;
      Object.assign(base, { target: str(d.target), hint: str(d.hint) });
    }
    out.push(base);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!isObj(body)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const kind = (Object.keys(TASKS) as (keyof typeof TASKS)[]).find((k) => k === body.kind);
  if (!kind) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });

  const payload = JSON.stringify({ ...body, kind: undefined }).slice(0, 14_000);
  const system = `${TUTOR_SYSTEM}\n\n${TASKS[kind]}`;

  for (let attempt = 0; attempt < (kind === "generate" ? 2 : 1); attempt++) {
    const result = await routeChat("chat", {
      messages: [
        { role: "system", content: system },
        { role: "user", content: payload },
      ],
      json: true,
    });
    if (result.unavailable) {
      return NextResponse.json({ error: "The AI is busy or out of free quota. Try again in a minute." }, { status: 503 });
    }
    const data = parseModelJson(result.text);
    if (!data) continue;

    if (kind === "generate") {
      const day = Number(isObj(body.day) ? body.day.day : 0) || 0;
      const drills = cleanDrills(data.drills, day);
      const vocab = Array.isArray(data.vocab)
        ? data.vocab.filter(isObj).map((v) => ({ fr: str(v.fr, 80), en: str(v.en, 80), note: str(v.note, 120) })).filter((v) => v.fr && v.en).slice(0, 30)
        : [];
      const dict = Array.isArray(data.in_app_dictation)
        ? data.in_app_dictation.filter(isObj).map((v) => ({ audio_text: str(v.audio_text, 160), answer: str(v.answer, 160) })).filter((v) => v.audio_text && v.answer).slice(0, 6)
        : [];
      const steps = isObj(data.lesson) ? strs(data.lesson.steps, 5, 500) : [];
      if (drills.length < 6 || vocab.length < 5 || steps.length < 1) continue; // retry once
      return NextResponse.json({ lesson: { steps }, vocab, drills, in_app_dictation: dict });
    }
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "The tutor could not produce a usable answer. Try again." }, { status: 502 });
}
