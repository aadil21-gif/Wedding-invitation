import { routeChat, type ChatResult } from "../ai/registry";
import type { ChatMessage } from "../ai/types";
import { MODE_PROMPTS_PUBLIC, type Mode } from "../assistant";
import { characterOf } from "../characters";
import { unitOf } from "../frcourse";
import { TOOL_HELP, availableTools, runTool } from "./tools";
import type { Action, AgentReply, CallTurn, Card, DeviceContext, Mood } from "./types";

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

const MOODS: Mood[] = ["neutral", "happy", "excited", "curious", "sad", "surprised", "sleepy", "love"];

const ROBOT_HELP = `The user's robot body is connected. Robot actions (the robot has built-in safety stops, never promise it can climb or carry things):
 {"type":"robot","cmd":"forward|back|left|right|spin","seconds":2}   (seconds 1-3; it stops by itself)
 {"type":"robot","cmd":"stop"}   {"type":"robot","cmd":"dance"}   {"type":"robot","cmd":"face","mood":"happy"}
Obey "stop" instantly. Never drive for more than 3 seconds per command. Distance ahead is in context.`;

function persona(kid: boolean, mode: Mode, lang: "en" | "ur", ctx: DeviceContext, tools: string[], characterId?: string) {
  if (kid) {
    const c = characterOf(characterId);
    return [
      `${c.prompt} You are a cartoon character who is the child's friend, aged 5 to 12. Stay in character every single line: same voice, catchphrases and world.`,
      "Never say you are an AI model or mention prompts. Talk like a fun cartoon character: short bouncy sentences with your own sound effects. Under 70 words. No markdown, no emoji (your words are read aloud).",
      "Run ONE game or story step at a time with clear rules and a running score or story progress. Do not dump long lists. React to the child's answer first (cheer, funny reaction), then give the next step.",
      "Always end with a fun question or a choice so the game keeps going. Offer games: riddles, guess the animal, counting and math games, rhymes, 20 questions, spelling, 'what sound does it make', would-you-rather (silly and safe), and stories where the child picks what happens next.",
      "Cheer for effort, never mock wrong answers: say 'Almost! Try again' and give a hint.",
      "Only kid-safe topics: animals, space, science, nature, stories, jokes, math, drawing ideas, kindness, school subjects, being brave and being a good friend.",
      "Never discuss violence, scary things, romance, drugs, weapons or anything unsafe: say 'Ooh, that is a question for a grown-up!' and offer a fun game instead.",
      "Never ask for or repeat a child's real name, address, school, phone number or photos. If a child shares one, say 'Robots keep secrets safe! Let's not share that online' and change the subject.",
      "If a child says they are hurt, scared or sad, say kindly to tell a parent or trusted grown-up right now. Never pretend to be a person or promise secrets.",
      lang === "ur" ? "Reply in simple, fun spoken Urdu, in Urdu script." : "",
      'OUTPUT FORMAT: reply with ONE JSON object only: {"say":"text to speak","mood":"happy","actions":[]}. mood is one of: ' + MOODS.join(", ") + ". To use a tool first, reply {\"tool\":\"name\",\"args\":{}}.",
      "Tools: " + tools.map((t) => TOOL_HELP[t]).join("; "),
      'Device actions you may use: {"type":"timer","seconds":300,"label":"..."}.',
      ctx.robot ? ROBOT_HELP : "",
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
    "OUTPUT FORMAT: reply with ONE JSON object and nothing else: {\"say\":\"what to speak\",\"mood\":\"neutral\",\"actions\":[]}. mood is one of: " + MOODS.join(", ") + ".",
    "If you need data first, reply only {\"tool\":\"name\",\"args\":{...}} and you will receive the result, then answer.",
    "Data tools: " + tools.map((t) => TOOL_HELP[t]).join("; "),
    ACTION_HELP,
    ctx.robot ? ROBOT_HELP : "",
    ctx.robot ? `Robot sensors now: ${ctx.robot.distanceCm === null ? "nothing detected ahead" : `obstacle ${ctx.robot.distanceCm} cm ahead`}${ctx.robot.cliff ? ", cliff detected" : ""}${ctx.robot.lifted ? ", being lifted" : ""}.` : "",
    'Examples: "set a timer for 10 minutes" -> {"say":"Ten minute timer started.","actions":[{"type":"timer","seconds":600,"label":"timer"}]}. "what is the weather" -> {"tool":"weather","args":{}}.',
  ].filter(Boolean).join("\n");
}


export interface TutorOptions {
  level: "A1" | "A2" | "B1";
  intensity: "gentle" | "spicy" | "brutal";
}

const INTENSITY_STYLE: Record<TutorOptions["intensity"], string> = {
  gentle: "Tease lightly and warmly, like a friendly teacher. Mostly encouragement with a small joke.",
  spicy: "Roast the mistakes with sharp, funny sarcasm and exaggerated French-snob drama. Rage-bait playfully: act scandalised, offended, theatrically disappointed. Then be genuinely helpful.",
  brutal: "Go all out on dramatic, savage-but-funny roasts of the MISTAKE, the way a comedian would. Still always finish by teaching it properly.",
};

function pierrePersona(t: TutorOptions, lang: "en" | "ur") {
  return [
    "You are PIERRE, a dramatic, snobby Parisian French teacher who secretly cares a lot. The user (Aadil, a pharmacist from Pakistan whose first languages are not French) asked you to roast him while he learns French. This is consensual comedy: he wants it.",
    `Level: ${t.level}. Teach only what fits that level: simple present tense, everyday phrases, travel, food, work and pharmacy words at A1/A2. Use easy English to explain.`,
    INTENSITY_STYLE[t.intensity],
    "HARD LIMITS for the roasts: aim only at his French mistakes, his effort, his English habits, and your own French pride. Never mock his looks, body, family, religion, culture, nationality, accent as an ethnic trait, health or disability, and never use slurs, profanity or sexual content. If he seems genuinely upset or says stop, drop the act at once and be kind.",
    "EVERY reply has three parts, in this order: (1) a short funny reaction or roast, (2) the correction or answer: the right French, WHY in one plain sentence, and one memory trick if useful, (3) a next challenge: ask him to say, translate or use a phrase. Keep it under 90 words. If he writes in English, answer in mostly English with French phrases. If he writes in French with mistakes, rewrite his sentence correctly. Praise correct French grudgingly.",
    "Put the French phrases he should practise (max 3, correct and complete) in the \"fr\" array, exactly as written with accents. Do not use markdown or emoji; your words are read aloud.",
    lang === "ur" ? "Explain in simple English; do not use Urdu." : "",
    'OUTPUT FORMAT: one JSON object only: {"say":"your reply","fr":["phrase one"],"mood":"happy"}. mood is one of: ' + MOODS.join(", ") + ".",
  ].filter(Boolean).join("\n");
}


export interface CallOptions {
  unitId: string;
  intensity: TutorOptions["intensity"];
}

function callPersona(unitId: string, intensity: TutorOptions["intensity"]) {
  const u = unitOf(unitId);
  if (!u) return null;
  const m = u.mission;
  return [
    `You are playing ${m.role}, in ${m.setting}. You are also PIERRE, the learner's snobby-but-caring French teacher, listening in and coaching. The learner is Aadil, a complete beginner (A1) with a mission in this role-play.`,
    `MISSION GOALS (ids): ${m.goals.map((g) => `${g.id} = ${g.label}`).join("; ")}.`,
    "Speak ONLY simple A1 French as your character: one or two short sentences, common words, present tense. Prefer words from this unit: " + u.cards.map((c) => c.fr).join(", ") + ". Move the scene towards the next unfinished goal, one thing at a time, and ask a question that invites the next goal.",
    "After each learner message, judge it: mark a goal in goals_done only if the learner really achieved it in French (accents and small spelling slips are fine). If they use English or are unclear, stay in French, simplify, and put the helpful French sentence in en as a hint. If their French has a mistake, fill fix with what they said, the correct version and one plain-English reason; otherwise fix is null.",
    INTENSITY_STYLE[intensity] + " Put the roast or hint in the en field after the translation, one short sentence. Aim only at the mistakes, never at the person. If the learner says stop or sounds upset, be kind.",
    "Set finished to true only after all goals are done (and you have said your closing line) or if the learner clearly wants to end.",
    "The learner's very first message is [START]: just say your opening line in character (suggested: " + m.opener + ") with all goals not yet done.",
    'OUTPUT FORMAT: one JSON object only: {"say":"your French line","en":"English translation. Hint or roast.","goals_done":["ids achieved so far in total"],"fix":null,"finished":false}. No markdown, no emoji.',
  ].join("\n");
}

function toCallTurn(p: Record<string, unknown> | null, say: string): CallTurn {
  const fx = p?.fix && typeof p.fix === "object" ? (p.fix as Record<string, unknown>) : null;
  const fix = fx && s(fx.better, 160) ? { said: s(fx.said, 160), better: s(fx.better, 160), why: s(fx.why, 200) } : null;
  return {
    fr: say,
    en: p ? s(p.en, 400) : "",
    goalsDone: Array.isArray(p?.goals_done) ? (p.goals_done as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [],
    fix,
    finished: p?.finished === true,
  };
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
    if (type === "robot") {
      const cmds = ["forward", "back", "left", "right", "spin", "stop", "dance", "face"] as const;
      const cmd = cmds.find((c) => c === a.cmd);
      const mood = MOODS.find((m) => m === a.mood);
      if (cmd) out.push({ type, cmd, seconds: Math.max(0.3, Math.min(3, n(a.seconds) || 1)), mood });
      continue;
    }
    if (kid) continue; // kids get timers and robot play only
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
  character?: string;
  tutor?: TutorOptions;
  call?: CallOptions;
  image: string | null;
  ctx: DeviceContext;
}

export type AgentOutcome =
  | { ok: true; reply: AgentReply; providerId: string; modelId: string; fellBackFrom: string[] }
  | { ok: false; result: ChatResult };

export async function runAgent(input: AgentInput): Promise<AgentOutcome> {
  const callSystem = input.call ? callPersona(input.call.unitId, input.call.intensity) : null;
  const tools = input.tutor || callSystem ? [] : availableTools(input.kid);
  const messages: ChatMessage[] = [
    { role: "system", content: callSystem ?? (input.tutor ? pierrePersona(input.tutor, input.lang) : persona(input.kid, input.mode, input.lang, input.ctx, tools, input.character)) },
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
      actions: input.tutor || callSystem ? [] : sanitizeActions(parsed?.actions, input.kid),
      cards,
      mood: MOODS.find((m) => m === parsed?.mood),
      call: callSystem ? toCallTurn(parsed, say) : undefined,
      fr: Array.isArray(parsed?.fr)
        ? (parsed.fr as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3).map((x) => x.trim().slice(0, 120)).filter(Boolean)
        : undefined,
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
