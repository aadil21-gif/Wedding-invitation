import { NextRequest, NextResponse } from "next/server";
import { routeChat } from "@/lib/ai/registry";
import { parseModelJson } from "@/lib/agent/run";
import { persona } from "@/lib/coach";

export const maxDuration = 45;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown, n: number, len: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, len)) : [];

async function ask(system: string, user: string) {
  const res = await routeChat("chat", {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    json: true,
  });
  if (res.unavailable) return null;
  return parseModelJson(res.text);
}

/**
 * Madame Roast endpoints. Drill grading is done on the phone (instant, offline);
 * the model is only used where it adds intelligence: new lessons, spoken
 * conversation feedback, written corrections and leech mnemonics.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const op = str(body?.op, 20);
  const week = Math.min(40, Math.max(1, Number(body?.week) || 1));
  const serious = body?.serious === true;
  const errors = arr(body?.errors, 6, 40).join(", ");
  const system = persona({ week, serious, errors });

  if (op === "generate") {
    const day = Number(body?.day) || 0;
    const theme = str(body?.theme, 120);
    const grammar = str(body?.grammar, 160);
    const taught = arr(body?.taught, 150, 60).join("; ");
    const wrong = arr(body?.review, 20, 80).join("; ");
    const out = await ask(
      system,
      [
        `Create Day ${day} of the course. Theme: ${theme}. Grammar: ${grammar}.`,
        `Vocabulary and grammar already taught (use ONLY these plus today's new items): ${taught || "Day 1-7 basics: alphabet, greetings, introductions, etre, avoir, numbers to 100, nouns with articles."}`,
        wrong ? `Items he got wrong earlier (at least 30% of drills must review these or earlier material): ${wrong}.` : "",
        "Return ONE JSON object: {\"lesson\":{\"steps\":[3 short explanations in English, each under 60 words, with a French example inside]},\"vocab\":[15 items {\"fr\":\"\",\"en\":\"\"}],\"drills\":[10 items],\"dictation\":[3 items {\"audio_text\":\"\",\"answer\":\"\"}]}.",
        "Each drill: {\"id\":\"g1\",\"type\":\"fill|translate_en_fr|translate_fr_en|mcq|order|say_it\",\"prompt\":\"\",\"answer\":\"\",\"accept\":[],\"options\":[] (mcq only, 3 items),\"words\":[] (order only),\"target\":\"\" (say_it only)}.",
        "Every answer must be checkable by exact match or accepted variants. Never use a grammar structure in a drill before the lesson teaches it. Self-check gender, agreement and accents before answering. If unsure of a fact, drop the item.",
      ].filter(Boolean).join("\n")
    );
    if (!out || !Array.isArray(out.drills) || !Array.isArray(out.vocab)) {
      return NextResponse.json({ error: "Could not build this lesson right now. Try again." }, { status: 503 });
    }
    return NextResponse.json(out);
  }

  if (op === "write") {
    const prompt = str(body?.prompt, 300);
    const text = str(body?.text, 1500);
    if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
    const out = await ask(
      system,
      [
        `Writing task: ${prompt}`,
        `His text: ${text}`,
        "Correct it. Return ONE JSON object: {\"corrections\":[{\"original\":\"\",\"fix\":\"\",\"reason\":\"\",\"category\":\"gender|article|conjugation|agreement|word_order|vocabulary|spelling|accent|number|other\"}],\"corrected_text\":\"\",\"summary_en\":\"2 sentences, specific\",\"roast\":\"one line or empty\",\"praise\":\"one specific line or empty\"}.",
        "Missing accents count as errors in writing. Only list real errors. Max 8 corrections, the most important ones.",
      ].join("\n")
    );
    if (!out) return NextResponse.json({ error: "Could not check your writing right now." }, { status: 503 });
    return NextResponse.json(out);
  }

  if (op === "talk") {
    const prompt = str(body?.prompt, 300);
    const input = str(body?.input, 600);
    const history = arr(body?.history, 8, 300).join("\n");
    const taught = arr(body?.taught, 150, 60).join("; ");
    const out = await ask(
      system,
      [
        `Speaking block. Task: ${prompt}`,
        `Only vocabulary taught so far is allowed in your French: ${taught}.`,
        history ? `Conversation so far:\n${history}` : "",
        `He said (speech-to-text, may have recognition errors): ${input}`,
        "Reply as a coach: react to what he said, correct at most 2 errors, then give him the next line to say or the next question. Return ONE JSON object: {\"feedback_en\":\"\",\"roast\":\"one line or empty\",\"fix\":{\"said\":\"\",\"better\":\"\"} or null,\"next_fr\":\"short French line for him to answer or repeat\",\"next_en\":\"its translation\"}.",
        "Keep it short. Never claim you can judge his accent from text.",
      ].filter(Boolean).join("\n")
    );
    if (!out) return NextResponse.json({ error: "Madame Roast lost the line. Try again." }, { status: 503 });
    return NextResponse.json(out);
  }

  if (op === "leech") {
    const front = str(body?.front, 80);
    const back = str(body?.back, 80);
    const out = await ask(system, `He keeps forgetting this card: ${front} = ${back}. Give a memorable mnemonic and one simple example sentence using only beginner words. Return ONE JSON object: {"mnemonic":"","example_fr":"","example_en":""}.`);
    if (!out) return NextResponse.json({ error: "No mnemonic right now." }, { status: 503 });
    return NextResponse.json(out);
  }

  return NextResponse.json({ error: "Unknown request." }, { status: 400 });
}
