"use client";

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

export type VoiceLang = "en" | "ur";
export type VoiceStyle = "natural" | "robot" | "cartoon";

/** Pitch and speed per style. Robot stays close to normal speed so answers remain clear. */
const STYLE: Record<VoiceStyle, { pitch: number; rate: number }> = {
  natural: { pitch: 1, rate: 1 },
  robot: { pitch: 0.55, rate: 0.95 },
  cartoon: { pitch: 1.75, rate: 1.1 },
};
const BCP47: Record<VoiceLang, string> = { en: "en-US", ur: "ur-PK" };

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

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Reads text aloud. Markdown symbols are stripped so they are not spoken. */
export function speak(text: string, lang: VoiceLang, onEnd?: () => void, style: VoiceStyle = "natural") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  if (!clean) {
    onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = BCP47[lang];
  u.pitch = STYLE[style].pitch;
  u.rate = STYLE[style].rate;
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}
