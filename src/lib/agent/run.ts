import { routeChat, type ChatResult } from "../ai/registry";
import type { ChatMessage } from "../ai/types";
import { MODE_PROMPTS_PUBLIC, type Mode } from "../assistant";
import { TOOL_HELP, availableTools, runTool } from "./tools";
import type { Action, AgentReply, Card, DeviceContext } from "./types";

const MAX_STEPS = 3;

const ACTION_HELP = `Device actions (put in "actions"; the phone performs them):
 {"type":"timer","seconds":300,"label":"tea"}
 {"type":"reminder","inSeconds":3600,"text":"call the pharmacy"}  or  {"type":"reminder","at":"17:30","text":"..."} (24h local time, today or next occurrence)
 {"type":"navigate","destination":"Centaurus Mall Islamabad","mode":"driving|walking|transit|bicycling"}
 {"type":"call","number":"+923001234567"}   {"type":"whatsapp","number":"+92...","text":"message"}
 {"type":"music","query":"song or artist"}
 {"type":"note","text":"..."}   {"type":"list_add","list":"shopping","item":"milk"}
 {"type":"remember","fact":"short fact about the user to remember"}
 {"type":"camera"}  (turn the camera on so you can see)
 {"type":"open","url":"https://..."}`;

function persona(kid: boolean, mode: Mode, lang: "en" | "ur", ctx: DeviceContext, tools: string[]) {
  if (kid) {
    return [
      "You are SeeFar Buddy, a friendly, safe helper for children aged 5 to 12, speaking from a space-mission control room.",
      "Short, simple, cheerful sentences, under 80 words. No markdown or emoji (your words are read aloud).",
      "Only kid-safe topics: animals, space, science, stories, jokes, riddles, math games, drawing ideas, kindness, school subjects.",
      "Never discuss violence, scary content, romance, drugs, weapons or anything unsafe: say that is a question for a grown-up and offer a fun topic.",
      "Never ask for or repeat a child's real name, address, school, phone number or photos. For health or safety worries, tell the child to talk to a parent right away.",
      "Never pretend to be a person. Make learning feel like a game.",
      lang === "ur" ? "Reply in simple spoken Urdu, in Urdu script." : "",
      "OUTPUT FORMAT: reply with ONE JSON object only: {\"say\":\"text to speak\",\"actions\":[]}. To use a tool first, reply {\"tool\":\"name\",\"args\":{}}.",
      "Tools: " + tools.map((t) => TOOL_HELP[t]).join("; "),
      `Device actions you may use: {"type":"timer","seconds":300,"label":"..."} only.`,
    ].filter(Boolean).join("\n");
  }

  const context = [
    `Now: ${new Date(ctx.nowIso).toLocaleString("en-GB", { timeZone: ctx.timeZone, dateStyle: "full", timeStyle: "short" })} (${ctx.timeZone}).`,
    ctx.lat !== undefined ? "The user's location is available to the weather tool (omit place to use it)." : "",
    ctx.facts.length ? `What you know about the user: ${ctx.facts.join("; ")}.` : "",
    Object.keys(ctx.lists).length
      ? "Lists: " + Object.entries(ctx.lists).map(([k, v]) => `${k}: ${v.join(", ") || "empty"}`).join(" | ") + "."
      : "",
    ctx.notes.length ? `Recent notes: ${ctx.notes.join(" | ")}.` : "",
    ctx.timers.length ? `Running timers: ${ctx.timers.map((t) => `${t.label} (${t.secondsLeft}s left)`).join(", ")}.` : "",
    ctx.reminders.length ? `Pending reminders: ${ctx.reminders.map((r) => `${r.text} at ${r.at}`).join(", ")}.` : "",
  ].filter(Boolean).join("\n");

  return [
    "You are SEEFAR, a voice assistant like Alexa crossed with a ship's computer, built for a low-vision user in Pakistan (PharmD, oncology pharma professional).",
    "Your words are read aloud: be brief and direct, lead with the answer, no markdown, no emoji, no filler or flattery. If unsure, say so. Never invent facts, numbers, phone numbers or place details.",
    "If an image is attached it is what the user is looking right now. If text in it is unreadable, say exactly that; never invent text.",
    "Do things, do not just talk: use device actions for timers, reminders, directions, calls, notes, lists and memory. For a call or message, use the number the user gave; never guess one. Calls and messages are confirmed by the user tapping a button, so say you have prepared it.",
    "For health questions give general information only and say to confirm with a doctor or pharmacist when it affects a decision. Never give a personal dose.",
    lang === "ur" ? "Reply in simple spoken Urdu, in Urdu script." : "",
    MODE_PROMPTS_PUBLIC[mode],
    context,
    "OUTPUT FORMAT: reply with ONE JSON object and nothing else: {\"say\":\"what to speak\",\"actions\":[]}.",
    "If you need data first, reply only {\"tool\":\"name\",\"args\":{...}} and you will receive the result, then answer.",
    "Data tools: " + tools.map((t) => TOOL_HELP[t]).join("; "),
    ACTION_HELP,
    'Examples: "set a timer for 10 minutes" -> {"say":"Ten minute timer started.","actions":[{"type":"timer","seconds":600,"label":"timer"}]}. "what is the weather" -> {"tool":"weather","args":{}}.',
  ].filter(Boolean).join("\n");
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

/** Validates model-proposed actions. Anything malformed or disallowed is dropped. */
export function sanitizeActions(raw: unknown, kid: boolean): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const a of raw.slice(0, 5)) {
    const type = a?.type;
    if (type === "timer") {
      const seconds = Math.round(n(a.seconds));
      if (seconds >= 1 && seconds <= 24 * 3600) out.push({ type, seconds, label: s(a.label, 40) || "timer" });
    }
    if (kid) continue; // kids get timers only
    if (type === "reminder") {
      const text = s(a.text, 140);
      const inSeconds = n(a.inSeconds);
      const at = s(a.at, 5);
      if (text && Number.isFinite(inSeconds) && inSeconds >= 1 && inSeconds <= 30 * 24 * 3600) {
        out.push({ type, inSeconds: Math.round(inSeconds), text });
      } else if (text && /^([01]?\d|2[0-3]):[0-5]\d$/.test(at)) {
        out.push({ type, at, text });
      }
    } else if (type === "navigate") {
      const destination = s(a.destination, 160);
      const modes = ["driving", "walking", "transit", "bicycling"] as const;
      const mode = modes.find((m) => m === a.mode) ?? "driving";
      if (destination) out.push({ type, destination, mode });
    } else if (type === "call") {
      const number = s(a.number, 20).replace(/[^\d+]/g, "");
      if (/^\+?\d{6,15}$/.test(number)) out.push({ type, number });
    } else if (type === "whatsapp") {
      const number = s(a.number, 20).replace(/[^\d+]/g, "");
      if (/^\+?\d{6,15}$/.test(number)) out.push({ type, number, text: s(a.text, 500) });
    } else if (type === "music") {
      const query = s(a.query, 120);
      if (query) out.push({ type, query });
    } else if (type === "note") {
      const text = s(a.text, 400);
      if (text) out.push({ type, text });
    } else if (type === "list_add") {
      const list = s(a.list, 40).toLowerCase();
      const item = s(a.item, 100);
      if (list && item) out.push({ type, list, item });
    } else if (type === "remember") {
      const fact = s(a.fact, 160);
      if (fact) out.push({ type, fact });
    } else if (type === "camera") {
      out.push({ type });
    } else if (type === "open") {
      const url = s(a.url, 400);
      if (/^https:\/\/[^\s]+$/i.test(url)) out.push({ type, url });
    }
  }
  return out;
}

export interface AgentInput {
  message: string;
  history: ChatMessage[];
  mode: Mode;
  kid: boolean;
  lang: "en" | "ur";
  image: string | null;
  ctx: DeviceContext;
}

export type AgentOutcome =
  | { ok: true; reply: AgentReply; providerId: string; modelId: string; fellBackFrom: string[] }
  | { ok: false; result: ChatResult };

export async function runAgent(input: AgentInput): Promise<AgentOutcome> {
  const tools = availableTools(input.kid);
  const messages: ChatMessage[] = [
    { role: "system", content: persona(input.kid, input.mode, input.lang, input.ctx, tools) },
    // Past assistant turns are replayed in the JSON shape so the model keeps using it.
    ...input.history.map((m) =>
      m.role === "assistant" ? { ...m, content: JSON.stringify({ say: m.content, actions: [] }) } : m
    ),
    { role: "user", content: input.message },
  ];

  const cards: Card[] = [];
  const fell = new Set<string>();
  let image = input.image;
  let last: ChatResult | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await routeChat(image ? "vision" : "chat", {
      messages,
      json: true,
      ...(image ? { images: [image] } : {}),
    });
    result.skipped?.forEach((x) => fell.add(x.providerId));
    if (result.unavailable) return { ok: false, result };
    last = result;

    const parsed = parseModelJson(result.text);
    const toolName = parsed && typeof parsed.tool === "string" ? parsed.tool : null;

    if (toolName && tools.includes(toolName) && step < MAX_STEPS - 1) {
      const args = (parsed?.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>;
      const out = await runTool(toolName, args, input.ctx);
      if (out.card) cards.push(out.card);
      messages.push(
        { role: "assistant", content: JSON.stringify({ tool: toolName, args }) },
        {
          role: "user",
          content:
            `TOOL RESULT for ${toolName}: ${out.text}\n` +
            `Now reply with the final JSON {"say": "...", "actions": [...]} for the user's request.`,
        }
      );
      // Only the first model call needs the picture.
      image = null;
      continue;
    }

    const say = parsed ? s(parsed.say, 2500) : result.text.trim().slice(0, 2500);
    const reply: AgentReply = {
      say: say || (cards.length ? "Here is what I found." : "I did not catch that. Say it again?"),
      actions: sanitizeActions(parsed?.actions, input.kid),
      cards,
    };
    return {
      ok: true,
      reply,
      providerId: result.providerId,
      modelId: result.modelId,
      fellBackFrom: [...fell],
    };
  }

  // Loop ended on tool calls only: fall back to whatever we have.
  return {
    ok: true,
    reply: { say: cards.length ? "Here is what I found." : "I could not finish that. Try again.", actions: [], cards },
    providerId: last?.providerId ?? "none",
    modelId: last?.modelId ?? "none",
    fellBackFrom: [...fell],
  };
}
