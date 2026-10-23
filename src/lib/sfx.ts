"use client";

import { PREF, readPref } from "./prefs";

/**
 * Tiny synthesized sound set (Web Audio, no audio files to load or license).
 * Browsers only allow audio after a tap, so the app unlocks it from the
 * "power up" button before anything else plays.
 */
export type Sfx = "boot" | "listen" | "send" | "reply" | "error" | "snap" | "kid" | "tick" | "alarm" | "wake" | "chatter" | "giggle" | "ouch" | "whee";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  slideTo?: number
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function play(name: Sfx) {
  if (readPref(PREF.sound, "1") !== "1") return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (name) {
    case "boot":
      tone(c, t, 110, 0.5, "sawtooth", 0.08, 440);
      tone(c, t + 0.35, 440, 0.15, "square", 0.05);
      tone(c, t + 0.5, 660, 0.15, "square", 0.05);
      tone(c, t + 0.65, 880, 0.35, "sine", 0.08, 1320);
      break;
    case "listen":
      tone(c, t, 660, 0.12, "sine", 0.1, 990);
      break;
    case "send":
      tone(c, t, 880, 0.08, "square", 0.04);
      tone(c, t + 0.08, 1320, 0.1, "square", 0.04);
      break;
    case "reply":
      tone(c, t, 990, 0.1, "sine", 0.08, 660);
      tone(c, t + 0.1, 740, 0.18, "sine", 0.08, 1100);
      break;
    case "snap":
      tone(c, t, 1800, 0.05, "square", 0.05);
      tone(c, t + 0.06, 900, 0.1, "triangle", 0.06);
      break;
    case "error":
      tone(c, t, 220, 0.25, "sawtooth", 0.07, 110);
      break;
    case "tick":
      tone(c, t, 2400, 0.02, "square", 0.02);
      break;
    case "wake":
      tone(c, t, 520, 0.09, "sine", 0.1, 780);
      tone(c, t + 0.09, 780, 0.12, "sine", 0.1, 1170);
      break;
    case "alarm":
      for (let i = 0; i < 6; i++) {
        tone(c, t + i * 0.45, 1400, 0.16, "square", 0.08);
        tone(c, t + i * 0.45 + 0.2, 1000, 0.16, "square", 0.08);
      }
      break;
    case "chatter": {
      // quick robot "blip-bloop" before it talks
      const notes = [880, 1320, 660, 1100, 990];
      notes.forEach((f, i) => tone(c, t + i * 0.055, f, 0.05, "square", 0.035));
      break;
    }
    case "giggle":
      [700, 900, 700, 1000, 800, 1100].forEach((f, i) => tone(c, t + i * 0.07, f, 0.06, "triangle", 0.07));
      break;
    case "ouch":
      tone(c, t, 500, 0.15, "square", 0.06, 200);
      break;
    case "whee":
      tone(c, t, 400, 0.45, "sine", 0.08, 1600);
      break;
    case "kid":
      [523, 659, 784, 1046].forEach((f, i) => tone(c, t + i * 0.09, f, 0.14, "triangle", 0.08));
      break;
  }
}
