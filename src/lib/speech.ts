"use client";

import { VOICE_SPECS, type VoiceStyleId } from "./voices";
import { readPref, PREF } from "./prefs";

/** Minimal typings: the browser speech-recognition API is not in lib.dom. */
interface RecogResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecogEvent {
  resultIndex: number;
  results: ArrayLike<RecogResult>;
}
export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecogEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type VoiceLang = "en" | "ur" | "fr";
export type VoiceStyle = VoiceStyleId;

const BCP47: Record<VoiceLang, string> = { en: "en-US", ur: "ur-PK", fr: "fr-FR" };

export function recognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createRecognizer(lang: VoiceLang): Recognizer | null {
  if (!recognitionSupported()) return null;
  const w = window as unknown as Record<string, new () => Recognizer>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const r = new Ctor();
  r.lang = BCP47[lang];
  r.interimResults = true;
  r.continuous = false;
  return r;
}

export function transcriptOf(e: RecogEvent): { text: string; final: boolean } {
  let text = "";
  let final = false;
  for (let i = e.resultIndex; i < e.results.length; i++) {
    text += e.results[i][0].transcript;
    if (e.results[i].isFinal) final = true;
  }
  return { text, final };
}

// ---------- speaking ----------

/** Plays one decoded clip at a time; a new utterance bumps the token and silences the old one. */
let token = 0;
let currentSource: AudioBufferSourceNode | null = null;
let ctx: AudioContext | null = null;
/** After an AI-voice failure, use the phone voice for a while instead of retrying every sentence. */
let aiCooldownUntil = 0;
const aiCache = new Map<string, Promise<AudioBuffer>>();

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a tap so the browser lets audio play later. */
export function unlockSpeech() {
  audioCtx();
}

export function stopSpeaking() {
  token++;
  try {
    currentSource?.stop();
  } catch {
    // already stopped
  }
  currentSource = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Splits text into pieces the voice service accepts, at sentence ends. */
export function chunkText(text: string, max = 300): string[] {
  // A short first piece reaches the ear sooner; the rest is fetched meanwhile.
  const first = text.match(/^[^.!?؟۔]{20,110}[.!?؟۔]\s+/);
  if (first && text.length > first[0].length + 40) {
    return [first[0].trim(), ...chunkText(text.slice(first[0].length), max)].slice(0, 6);
  }
  const sentences = text.match(/[^.!?؟۔]+[.!?؟۔]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const sen of sentences) {
    if (cur && (cur + sen).length > max) {
      out.push(cur.trim());
      cur = "";
    }
    cur += sen;
    while (cur.length > max) {
      out.push(cur.slice(0, max).trim());
      cur = cur.slice(max);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 6);
}

function fetchClip(text: string, style: VoiceStyleId): Promise<AudioBuffer> {
  const key = `${style}|${text}`;
  const hit = aiCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, style }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const c = audioCtx();
    if (!c) throw new Error("no audio");
    return c.decodeAudioData(await res.arrayBuffer());
  })();
  aiCache.set(key, p);
  if (aiCache.size > 40) aiCache.delete(aiCache.keys().next().value as string);
  p.catch(() => aiCache.delete(key));
  return p;
}

/** Robot voice: ring modulation, a short metallic echo and light distortion. */
function playClip(buffer: AudioBuffer, fx: boolean, onEnd: () => void, onStart?: () => void) {
  const c = audioCtx();
  if (!c) return onEnd();
  const src = c.createBufferSource();
  src.buffer = buffer;
  if (!fx) {
    src.connect(c.destination);
  } else {
    const ring = c.createGain();
    ring.gain.value = 0.55;
    const osc = c.createOscillator();
    osc.frequency.value = 62;
    const depth = c.createGain();
    depth.gain.value = 0.45;
    osc.connect(depth).connect(ring.gain);
    osc.start();
    const dry = c.createGain();
    dry.gain.value = 0.45;
    const mix = c.createGain();
    const delay = c.createDelay(0.05);
    delay.delayTime.value = 0.011;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    delay.connect(fb).connect(delay);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    src.connect(ring).connect(mix);
    src.connect(dry).connect(mix);
    mix.connect(delay);
    mix.connect(shaper);
    delay.connect(shaper);
    const out = c.createGain();
    out.gain.value = 0.8;
    shaper.connect(out).connect(c.destination);
    src.onended = () => {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    };
  }
  const prev = src.onended;
  src.onended = (e) => {
    (prev as ((this: AudioScheduledSourceNode, ev: Event) => void) | null)?.call(src, e);
    onEnd();
  };
  currentSource = src;
  src.start();
  onStart?.();
}

/** Picks the most natural-sounding voice the phone has for a language. */
function bestVoice(lang: VoiceLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online|wavenet/i.test(v.name) ? 6 : 0) +
    (/google/i.test(v.name) ? 4 : 0) +
    (/enhanced|premium/i.test(v.name) ? 3 : 0) +
    (v.localService ? 0 : 1) +
    (lang === "en" && /en[-_]?(us|gb)/i.test(v.lang) ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0];
}

function speakBrowser(text: string, lang: VoiceLang, style: VoiceStyleId, onEnd?: () => void, myToken = token, onStart?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return onEnd?.();
  const spec = VOICE_SPECS[style];
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP47[lang];
  u.pitch = spec.fallback.pitch;
  u.rate = spec.fallback.rate;
  const v = bestVoice(lang);
  if (v) u.voice = v;
  const done = () => {
    if (myToken === token) onEnd?.();
  };
  u.onstart = () => onStart?.();
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}

/**
 * Reads text aloud. Uses the AI voice (server) when enabled and reachable and
 * falls back to the best voice installed on the phone. Markdown symbols are
 * stripped so they are not spoken.
 */
export function speak(text: string, lang: VoiceLang, onEnd?: () => void, style: VoiceStyleId = "natural", onStart?: () => void) {
  if (typeof window === "undefined") return onEnd?.();
  stopSpeaking();
  const myToken = token;
  const clean = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return onEnd?.();

  const studio = readPref(PREF.studio, "1") === "1" && lang !== "ur" && Date.now() > aiCooldownUntil;
  if (!studio || !audioCtx()) return speakBrowser(clean, lang, style, onEnd, myToken, onStart);

  const chunks = chunkText(clean);
  const fx = VOICE_SPECS[style].robotFx;
  // Start every request now so later sentences are ready when the earlier ones finish.
  const clips = chunks.map((c) => fetchClip(c, style));
  clips.forEach((p) => p.catch(() => undefined));

  const playFrom = (i: number) => {
    if (myToken !== token) return;
    if (i >= clips.length) return onEnd?.();
    clips[i].then(
      (buf) => {
        if (myToken !== token) return;
        playClip(buf, fx, () => playFrom(i + 1), i === 0 ? onStart : undefined);
      },
      () => {
        if (myToken !== token) return;
        aiCooldownUntil = Date.now() + 5 * 60_000;
        speakBrowser(chunks.slice(i).join(" "), lang, style, onEnd, myToken, i === 0 ? onStart : undefined);
      }
    );
  };
  playFrom(0);
}
