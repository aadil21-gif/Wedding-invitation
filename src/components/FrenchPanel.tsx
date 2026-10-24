"use client";

/* The speech recogniser lives in a ref and is only touched from event handlers. */
/* eslint-disable react-hooks/refs */

import { FormEvent, useMemo, useRef, useState } from "react";
import { COURSE, DECK, type FrCard, type Unit } from "@/lib/frcourse";
import {
  accentOnly,
  bucketOf,
  nextCards,
  parseProgress,
  review,
  roastFor,
  similarity,
  stats,
  type FrProgress,
  type Intensity,
} from "@/lib/french";
import { PREF, usePref, useBoolPref, writePref } from "@/lib/prefs";
import { play } from "@/lib/sfx";
import {
  createRecognizer,
  recognitionSupported,
  speak,
  stopSpeaking,
  transcriptOf,
  type Recognizer,
  type VoiceLang,
} from "@/lib/speech";
import type { Mood } from "@/lib/agent/types";
import { RoboFace } from "./RoboFace";
import type { OrbState } from "./HudCore";

type Screen =
  | { name: "path" }
  | { name: "learn"; unit: Unit }
  | { name: "practice"; unit: Unit | null; cards: FrCard[] }
  | { name: "call"; unit: Unit };

const INTENSITIES: { id: Intensity; label: string }[] = [
  { id: "gentle", label: "Gentle" },
  { id: "spicy", label: "Spicy" },
  { id: "brutal", label: "Brutal" },
];

const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`touch-target hud-chip rounded px-3 font-bold text-sm ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );
}

/** Big picture tile, Duolingo style. */
function Picture({ emoji }: { emoji: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border-2 border-[var(--border)] mx-auto"
      style={{ width: 132, height: 132, fontSize: 76, background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
      aria-hidden
    >
      {emoji}
    </div>
  );
}

const FR_THEME = { "--accent": "#4f7bff", "--accent-2": "#ef4135" } as React.CSSProperties;

export function FrenchPanel({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>({ name: "path" });
  const [intensityPref, setIntensity] = usePref(PREF.roast, "spicy");
  const intensity = (INTENSITIES.find((i) => i.id === intensityPref)?.id ?? "spicy") as Intensity;
  const [speakOn] = useBoolPref(PREF.speak, true);
  const [rawProgress] = usePref(PREF.fr, "");
  const progress = useMemo(() => parseProgress(rawProgress), [rawProgress]);
  const st = stats(progress);
  const voiceOk = recognitionSupported();

  const recRef = useRef<Recognizer | null>(null);
  const [listening, setListening] = useState(false);
  const [face, setFace] = useState<{ state: OrbState; mood: Mood }>({ state: "standby", mood: "happy" });

  const commit = (p: FrProgress) => writePref(PREF.fr, JSON.stringify(p));

  function hear(fr: string, onEnd?: () => void) {
    speak(fr, "fr", onEnd, "frslow");
  }

  function listen(lang: VoiceLang): Promise<string> {
    return new Promise((resolve) => {
      const r = createRecognizer(lang);
      if (!r) return resolve("");
      recRef.current = r;
      let text = "";
      r.onresult = (e) => {
        text = transcriptOf(e).text;
      };
      r.onend = () => {
        setListening(false);
        resolve(text);
      };
      r.onerror = () => {
        setListening(false);
        resolve(text);
      };
      stopSpeaking();
      setListening(true);
      try {
        r.start();
      } catch {
        setListening(false);
        resolve("");
      }
    });
  }

  function leave() {
    stopSpeaking();
    recRef.current?.abort();
    setListening(false);
    setFace({ state: "standby", mood: "happy" });
    setScreen({ name: "path" });
  }

  function close() {
    stopSpeaking();
    recRef.current?.abort();
    onClose();
  }

  const unlocked = (i: number) => i === 0 || (progress.missions[COURSE[i - 1].id] ?? 0) >= 0.5;

  // ---------- practice ----------

  type Step = { card: FrCard; kind: "mc" | "say"; options?: string[] };
  const [steps, setSteps] = useState<Step[]>([]);
  const [si, setSi] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; line: string } | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [typed, setTyped] = useState("");

  function buildSteps(cards: FrCard[]): Step[] {
    const mc: Step[] = shuffle(cards).map((card) => ({
      card,
      kind: "mc",
      options: shuffle([card.en, ...shuffle(DECK.filter((d) => d.en !== card.en)).slice(0, 3).map((d) => d.en)]),
    }));
    const say: Step[] = shuffle(cards).slice(0, 4).map((card) => ({ card, kind: "say" }));
    return [...mc, ...say];
  }

  function openPractice(unit: Unit | null, cards: FrCard[]) {
    if (cards.length === 0) return;
    stopSpeaking();
    setSteps(buildSteps(cards));
    setSi(0);
    setPicked(null);
    setFeedback(null);
    setTally({ right: 0, wrong: 0 });
    setTyped("");
    setScreen({ name: "practice", unit, cards });
    setFace({ state: "standby", mood: "happy" });
  }

  function grade(ok: boolean, card: FrCard, score: number) {
    const line = ok
      ? roastFor(1, intensity, card.fr)
      : `${roastFor(score, intensity, card.fr)}${card.tip ? " Tip: " + card.tip : ""}`;
    commit(review(progress, card.id, ok));
    setFeedback({ ok, line });
    setTally((t) => ({ right: t.right + (ok ? 1 : 0), wrong: t.wrong + (ok ? 0 : 1) }));
    setFace({ state: "standby", mood: ok ? "excited" : "sad" });
    play(ok ? "snap" : "error");
    hear(card.fr, () => {
      if (!ok && speakOn) speak(line, "en", undefined, "pierre");
    });
  }

  function chooseOption(step: Step, opt: string) {
    if (feedback) return;
    setPicked(opt);
    grade(opt === step.card.en, step.card, opt === step.card.en ? 1 : 0.2);
  }

  function checkSay(step: Step, given: string) {
    if (feedback) return;
    const score = similarity(given, step.card.fr);
    const ok = score >= 0.8;
    if (ok && accentOnly(given, step.card.fr)) {
      grade(true, step.card, 1);
      return;
    }
    grade(ok, step.card, score);
  }

  async function micSay(step: Step) {
    if (listening) return recRef.current?.stop();
    const heard = await listen("fr");
    if (heard.trim()) {
      setTyped(heard);
      checkSay(step, heard);
    }
  }

  function nextStep() {
    stopSpeaking();
    setSi((i) => i + 1);
    setPicked(null);
    setFeedback(null);
    setTyped("");
    setFace({ state: "standby", mood: "happy" });
  }

  // ---------- call mission ----------

  interface Turn {
    who: "pierre" | "you";
    text: string;
    en?: string;
  }
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [fixes, setFixes] = useState<{ said: string; better: string; why: string }[]>([]);
  const [callState, setCallState] = useState<"idle" | "thinking" | "speaking" | "listening" | "over">("idle");
  const [callError, setCallError] = useState("");
  const [showEn, setShowEn] = useState(true);
  const [hint, setHint] = useState(false);
  const [callInput, setCallInput] = useState("");
  const callUnit = screen.name === "call" ? screen.unit : null;

  function pushTurn(t: Turn) {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  }

  function openCall(unit: Unit) {
    stopSpeaking();
    turnsRef.current = [];
    setTurns([]);
    setDone([]);
    setFixes([]);
    setCallError("");
    setHint(false);
    setCallState("idle");
    setFace({ state: "standby", mood: "happy" });
    setScreen({ name: "call", unit });
  }

  async function callTurn(unit: Unit, message: string, doneSoFar: string[]) {
    setCallState("thinking");
    setFace({ state: "thinking", mood: "neutral" });
    const history = turnsRef.current.map((t) => ({ role: t.who === "pierre" ? "assistant" : "user", content: t.text }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: history.slice(-10),
          mode: "general",
          kid: false,
          lang: "en",
          tutor: "call",
          unit: unit.id,
          intensity,
          context: { nowIso: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.call) {
        setCallError(data.error ?? "Pierre hung up. Try again.");
        setCallState("idle");
        setFace({ state: "standby", mood: "sad" });
        play("error");
        return;
      }
      const c = data.call as { fr: string; en: string; goalsDone: string[]; fix: { said: string; better: string; why: string } | null; finished: boolean };
      const valid = new Set(unit.mission.goals.map((g) => g.id));
      const allDone = Array.from(new Set([...doneSoFar, ...c.goalsDone.filter((g) => valid.has(g))]));
      const finished = c.finished || allDone.length === unit.mission.goals.length || turnsRef.current.length >= 24;

      let shown = false;
      const show = () => {
        if (shown) return;
        shown = true;
        pushTurn({ who: "pierre", text: c.fr, en: c.en });
        setDone(allDone);
        if (c.fix) setFixes((f) => [...f, c.fix!]);
        setFace({ state: "speaking", mood: c.fix ? "curious" : "happy" });
        setCallState("speaking");
        if (allDone.length > doneSoFar.length) play("snap");
      };
      const afterSpeech = async () => {
        setFace({ state: "standby", mood: "happy" });
        if (finished) return finishCall(unit, allDone);
        if (!voiceOk) return setCallState("idle");
        setCallState("listening");
        setFace({ state: "listening", mood: "curious" });
        const heard = await listen("fr");
        if (heard.trim()) {
          void sendLearner(unit, heard, allDone);
        } else {
          setCallState("idle");
          setFace({ state: "standby", mood: "neutral" });
        }
      };
      const speakFix = () => {
        if (c.fix && speakOn) speak(`${c.fix.why}. Say: ${c.fix.better}`, "en", () => void afterSpeech(), "pierre");
        else void afterSpeech();
      };
      if (speakOn) {
        speak(c.fr, "fr", speakFix, "pierre", show);
        setTimeout(show, 7000);
      } else {
        show();
        speakFix();
      }
    } catch {
      setCallError("No connection. Even Pierre cannot call you offline.");
      setCallState("idle");
    }
  }

  function sendLearner(unit: Unit, text: string, doneSoFar: string[]) {
    const t = text.trim();
    if (!t) return;
    pushTurn({ who: "you", text: t });
    setCallInput("");
    setHint(false);
    return callTurn(unit, t, doneSoFar);
  }

  async function micCall(unit: Unit) {
    if (listening) return recRef.current?.stop();
    if (callState === "thinking" || callState === "speaking") return;
    setCallState("listening");
    setFace({ state: "listening", mood: "curious" });
    const heard = await listen("fr");
    if (heard.trim()) void sendLearner(unit, heard, done);
    else {
      setCallState("idle");
      setFace({ state: "standby", mood: "neutral" });
    }
  }

  const [result, setResult] = useState<{ unit: Unit; got: number; total: number } | null>(null);

  function finishCall(unit: Unit, allDone: string[]) {
    const total = unit.mission.goals.length;
    const got = allDone.length;
    const score = got / total;
    const p = progress;
    commit({ ...p, missions: { ...p.missions, [unit.id]: Math.max(p.missions[unit.id] ?? 0, score) }, xp: p.xp + 20 * got });
    setResult({ unit, got, total });
    setCallState("over");
    setFace({ state: "standby", mood: score >= 0.75 ? "love" : score >= 0.5 ? "happy" : "sad" });
    play(score >= 0.5 ? "snap" : "error");
  }

  // ---------- learn ----------

  const [li, setLi] = useState(0);

  function openLearn(unit: Unit) {
    stopSpeaking();
    setLi(0);
    setScreen({ name: "learn", unit });
    hear(unit.cards[0].fr);
  }

  // ---------- render ----------

  const title =
    screen.name === "path"
      ? "LE DOJO"
      : screen.name === "learn"
        ? `${screen.unit.emoji} ${screen.unit.title.toUpperCase()}`
        : screen.name === "call"
          ? `📞 ${screen.unit.title.toUpperCase()}`
          : "PRATIQUE";

  return (
    <div role="dialog" aria-modal="true" aria-label="French with Pierre" className="overlay" style={FR_THEME}>
      <div className="panel w-full max-w-xl mx-auto p-4 flex flex-col gap-4 my-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div style={{ width: 84 }} className="shrink-0">
              <RoboFace state={face.state} mood={face.mood} motion kid={false} compact face="french" />
            </div>
            <div className="min-w-0">
              <h2 className="hud-title text-lg font-bold truncate">{title}</h2>
              <p className="hud-mono text-xs opacity-80">
                XP {progress.xp} · 🔥 {progress.streak}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {screen.name !== "path" && (
              <button type="button" onClick={leave} className="touch-target hud-chip rounded px-3 font-bold text-sm">
                BACK
              </button>
            )}
            <button type="button" onClick={close} className="touch-target hud-cta px-4 font-bold">
              CLOSE
            </button>
          </div>
        </div>

        {/* ---------------- PATH ---------------- */}
        {screen.name === "path" && (
          <div className="flex flex-col gap-3">
            <div className="panel p-3">
              <p className="font-bold">Objectif : pass 5 phone-call missions in French.</p>
              <p className="text-sm opacity-80">
                Each unit: learn 8 phrases, practise them, then take a call where Pierre plays a real person and you
                must reach 4 goals. Pass a call (2 of 4 goals) to unlock the next unit.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {COURSE.map((u, i) => {
                const open = unlocked(i);
                const best = progress.missions[u.id];
                const learned = u.cards.filter((c) => progress.cards[c.id]).length;
                return (
                  <div key={u.id} className={`panel p-3 flex flex-col gap-2 ${open ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-3">
                      <span
                        className="flex items-center justify-center rounded-full border-2 border-[var(--border)] text-3xl"
                        style={{ width: 56, height: 56 }}
                        aria-hidden
                      >
                        {open ? u.emoji : "🔒"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold leading-tight">
                          {u.title} <span className="opacity-70 font-normal">· {u.titleEn}</span>
                        </p>
                        <p className="text-sm opacity-80">{u.can}</p>
                        <p className="hud-mono text-xs opacity-70">
                          {learned}/{u.cards.length} phrases · call{" "}
                          {best === undefined ? "not taken" : `${Math.round(best * 100)}%${best >= 0.75 ? " ⭐" : ""}`}
                        </p>
                      </div>
                    </div>
                    {open && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => openLearn(u)} className="touch-target hud-chip rounded px-3 font-bold text-sm flex-1">
                          LEARN
                        </button>
                        <button type="button" onClick={() => openPractice(u, u.cards)} className="touch-target hud-chip rounded px-3 font-bold text-sm flex-1">
                          PRACTISE
                        </button>
                        <button type="button" onClick={() => openCall(u)} className="touch-target hud-cta px-3 font-bold text-sm flex-1">
                          📞 CALL
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={st.due + st.fresh === 0}
              onClick={() => openPractice(null, nextCards(progress, 8))}
              className="touch-target hud-chip rounded px-4 font-bold"
            >
              DAILY REVIEW · {st.due} due
            </button>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Roast level">
              <span className="text-sm opacity-80">Pierre&apos;s mood:</span>
              {INTENSITIES.map((i) => (
                <Pill key={i.id} active={intensity === i.id} onClick={() => setIntensity(i.id)}>
                  {i.label}
                </Pill>
              ))}
            </div>
            <p className="text-xs opacity-70">Pierre roasts your mistakes, never you. Say stop and he softens.</p>
          </div>
        )}

        {/* ---------------- LEARN ---------------- */}
        {screen.name === "learn" && (
          <div className="flex flex-col gap-3">
            <p className="hud-mono text-xs opacity-70">
              PHRASE {li + 1}/{screen.unit.cards.length}
            </p>
            {(() => {
              const c = screen.unit.cards[li];
              return (
                <div className="panel p-4 flex flex-col gap-3 text-center">
                  <Picture emoji={c.emoji} />
                  <p className="text-3xl font-bold">{c.fr}</p>
                  <p className="text-lg">{c.en}</p>
                  {c.tip && <p className="text-sm opacity-80">💡 {c.tip}</p>}
                  <button type="button" onClick={() => hear(c.fr)} className="touch-target hud-chip rounded px-4 font-bold self-center">
                    🔊 HEAR
                  </button>
                </div>
              );
            })()}
            <div className="flex gap-2">
              {li > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setLi(li - 1);
                    hear(screen.unit.cards[li - 1].fr);
                  }}
                  className="touch-target hud-chip rounded px-4 font-bold"
                >
                  ‹
                </button>
              )}
              {li < screen.unit.cards.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setLi(li + 1);
                    hear(screen.unit.cards[li + 1].fr);
                  }}
                  className="touch-target hud-cta px-6 font-bold flex-1"
                >
                  NEXT
                </button>
              ) : (
                <button type="button" onClick={() => openPractice(screen.unit, screen.unit.cards)} className="touch-target hud-cta px-6 font-bold flex-1">
                  PRACTISE →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---------------- PRACTICE ---------------- */}
        {screen.name === "practice" && (
          <div className="flex flex-col gap-3">
            {si >= steps.length ? (
              <div className="flex flex-col gap-3 text-center">
                <p className="text-5xl" aria-hidden>
                  {tally.wrong === 0 ? "🏆" : tally.right >= tally.wrong ? "👍" : "😬"}
                </p>
                <p className="text-lg font-bold">
                  {tally.right} right · {tally.wrong} wrong
                </p>
                <p>
                  {tally.wrong === 0
                    ? "Flawless. Disgusting. I'm checking the dictionary for cheating."
                    : tally.wrong > tally.right
                      ? "That was painful to supervise. Again, and wear a beret this time."
                      : "Not terrible. Not good. Passable, like airport coffee."}
                </p>
                {screen.unit ? (
                  <button type="button" onClick={() => openCall(screen.unit!)} className="touch-target hud-cta px-6 font-bold">
                    📞 TAKE THE CALL
                  </button>
                ) : null}
                <button type="button" onClick={leave} className="touch-target hud-chip rounded px-6 font-bold">
                  BACK TO PATH
                </button>
              </div>
            ) : (
              (() => {
                const step = steps[si];
                return (
                  <div className="flex flex-col gap-3">
                    <div className="h-2 rounded bg-[var(--border)] overflow-hidden" aria-hidden>
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${(si / steps.length) * 100}%` }} />
                    </div>
                    <div className="panel p-4 flex flex-col gap-3 text-center">
                      <Picture emoji={step.card.emoji} />
                      {step.kind === "mc" ? (
                        <>
                          <p className="hud-mono text-xs opacity-70">WHAT DOES IT MEAN?</p>
                          <div className="flex items-center justify-center gap-2">
                            <p className="text-2xl font-bold">{step.card.fr}</p>
                            <button type="button" onClick={() => hear(step.card.fr)} className="hud-chip rounded px-3 py-1" aria-label="Hear it">
                              🔊
                            </button>
                          </div>
                          <div className="flex flex-col gap-2">
                            {step.options!.map((o) => {
                              const right = feedback && o === step.card.en;
                              const wrong = feedback && picked === o && o !== step.card.en;
                              return (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => chooseOption(step, o)}
                                  className={`touch-target rounded-lg border-2 px-3 py-2 font-bold ${
                                    right ? "border-green-500 bg-green-500/20" : wrong ? "border-red-500 bg-red-500/20" : "border-[var(--border)]"
                                  }`}
                                >
                                  {o}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="hud-mono text-xs opacity-70">SAY IT IN FRENCH</p>
                          <p className="text-2xl font-bold">{step.card.en}</p>
                          {!feedback && (
                            <form
                              onSubmit={(e: FormEvent) => {
                                e.preventDefault();
                                if (typed.trim()) checkSay(step, typed);
                              }}
                              className="flex gap-2"
                            >
                              <input
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                className="hud-input flex-1 min-w-0 px-3"
                                aria-label="Your French"
                                autoCapitalize="off"
                                autoCorrect="off"
                                placeholder={voiceOk ? "Tap the mic, or type" : "Type it"}
                              />
                              {voiceOk && (
                                <button type="button" onClick={() => void micSay(step)} className={`hud-mic touch-target px-3 font-bold ${listening ? "is-live" : ""}`} aria-label="Speak">
                                  {listening ? "●" : "🎤"}
                                </button>
                              )}
                              <button type="submit" className="touch-target hud-cta px-4 font-bold">
                                OK
                              </button>
                            </form>
                          )}
                        </>
                      )}
                    </div>
                    {feedback && (
                      <div className={`panel p-3 ${feedback.ok ? "" : "hud-alert"}`}>
                        <p className="font-bold">{feedback.ok ? "✓ Correct" : `✗ ${step.card.fr}`}</p>
                        <p>🥖 {feedback.line}</p>
                        <button type="button" onClick={nextStep} className="touch-target hud-cta px-6 font-bold mt-2 w-full">
                          CONTINUE
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* ---------------- CALL ---------------- */}
        {screen.name === "call" && callUnit && (
          <div className="flex flex-col gap-3">
            {callState !== "over" && (
              <>
                <div className="panel p-3 flex flex-col gap-1">
                  <p className="hud-mono text-xs opacity-70">MISSION · {callUnit.mission.role.toUpperCase()}</p>
                  <ul className="flex flex-col gap-1">
                    {callUnit.mission.goals.map((g) => (
                      <li key={g.id} className={done.includes(g.id) ? "line-through opacity-60" : ""}>
                        {done.includes(g.id) ? "✅" : "⬜"} {g.label}
                      </li>
                    ))}
                  </ul>
                </div>

                {turns.length === 0 && callState === "idle" && (
                  <button type="button" onClick={() => void callTurn(callUnit, "[START]", [])} className="touch-target hud-cta px-6 font-bold text-lg">
                    📞 START CALL
                  </button>
                )}

                <div className="flex flex-col gap-2 max-h-[34dvh] overflow-y-auto" aria-live="polite">
                  {turns.map((t, i) =>
                    t.who === "you" ? (
                      <p key={i} className="hud-mono text-right self-end max-w-[90%]">
                        <span className="opacity-60">&gt; </span>
                        {t.text}
                      </p>
                    ) : (
                      <div key={i} className="panel p-3 max-w-[95%]">
                        <p className="font-bold">🥖 {t.text}</p>
                        {showEn && t.en && <p className="text-sm opacity-80 mt-1">{t.en}</p>}
                      </div>
                    )
                  )}
                  {callState === "thinking" && <p className="hud-mono opacity-80">&gt; …</p>}
                </div>

                {callError && (
                  <p role="alert" className="font-bold">
                    {callError}
                  </p>
                )}

                {turns.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {hint && (
                      <p className="panel p-2 text-sm">
                        💡 Try:{" "}
                        <b>{callUnit.mission.goals.find((g) => !done.includes(g.id))?.model}</b>
                      </p>
                    )}
                    <div className="flex gap-2">
                      {voiceOk && (
                        <button
                          type="button"
                          onClick={() => void micCall(callUnit)}
                          disabled={callState === "thinking" || callState === "speaking"}
                          className={`hud-mic touch-target px-4 font-bold flex-1 disabled:opacity-50 ${listening ? "is-live" : ""}`}
                        >
                          {listening ? "● LISTENING… TAP WHEN DONE" : callState === "speaking" ? "PIERRE IS TALKING…" : "🎤 TAP AND SPEAK FRENCH"}
                        </button>
                      )}
                    </div>
                    <form
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        if (callState !== "thinking") void sendLearner(callUnit, callInput, done);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        value={callInput}
                        onChange={(e) => setCallInput(e.target.value)}
                        className="hud-input flex-1 min-w-0 px-3"
                        placeholder="…or type your French"
                        aria-label="Type your French"
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                      <button type="submit" className="touch-target hud-cta px-4 font-bold">
                        SEND
                      </button>
                    </form>
                    <div className="flex gap-2">
                      <Pill active={hint} onClick={() => setHint((h) => !h)}>
                        💡 Hint
                      </Pill>
                      <Pill active={showEn} onClick={() => setShowEn((v) => !v)}>
                        EN
                      </Pill>
                      <button
                        type="button"
                        onClick={() => {
                          stopSpeaking();
                          recRef.current?.abort();
                          finishCall(callUnit, done);
                        }}
                        className="touch-target hud-chip rounded px-3 font-bold text-sm ml-auto"
                      >
                        HANG UP
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {callState === "over" && result && (
              <div className="flex flex-col gap-3 text-center">
                <p className="text-5xl" aria-hidden>
                  {result.got === result.total ? "🏆" : result.got >= 2 ? "👍" : "😬"}
                </p>
                <p className="text-xl font-bold">
                  {result.got}/{result.total} goals · +{20 * result.got} XP
                </p>
                <p>
                  🥖{" "}
                  {bucketOf(result.got / result.total) === "great"
                    ? "Parfait. I have nothing to complain about, which is deeply upsetting."
                    : bucketOf(result.got / result.total) === "ok"
                      ? "You survived the call. Barely. The croissant of victory is still out of reach."
                      : "Mon Dieu. The person on the line hung up out of pity. Again."}
                </p>
                {result.got >= 2 && result.unit.id !== COURSE[COURSE.length - 1].id && (
                  <p className="hud-mono text-sm">Next unit unlocked.</p>
                )}
                {fixes.length > 0 && (
                  <div className="panel p-3 text-left">
                    <p className="hud-mono text-xs opacity-70 mb-1">YOUR MISTAKES</p>
                    <ul className="flex flex-col gap-2">
                      {fixes.slice(0, 5).map((f, i) => (
                        <li key={i} className="text-sm">
                          <span className="opacity-70 line-through">{f.said}</span>
                          <br />
                          <b>{f.better}</b> <span className="opacity-80">— {f.why}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button" onClick={() => openCall(result.unit)} className="touch-target hud-cta px-6 font-bold">
                  CALL AGAIN
                </button>
                <button type="button" onClick={leave} className="touch-target hud-chip rounded px-6 font-bold">
                  BACK TO PATH
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
