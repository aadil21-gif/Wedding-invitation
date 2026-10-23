"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import {
  DECK,
  accentOnly,
  nextCards,
  parseProgress,
  review,
  roastFor,
  similarity,
  stats,
  type FrCard,
  type Intensity,
  type FrProgress,
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

type Tab = "chat" | "cards" | "say";
type Level = "A1" | "A2" | "B1";

interface Msg {
  role: "user" | "assistant";
  text: string;
  fr?: string[];
  error?: boolean;
}

interface Target {
  id?: string;
  fr: string;
  en?: string;
}

const INTENSITIES: { id: Intensity; label: string; blurb: string }[] = [
  { id: "gentle", label: "Gentle", blurb: "Light teasing" },
  { id: "spicy", label: "Spicy", blurb: "Proper roasting" },
  { id: "brutal", label: "Brutal", blurb: "No mercy (still about the mistakes)" },
];

const OPENERS = [
  "Say hello to me in French. Make it good.",
  "Teach me 5 French phrases for ordering food.",
  "Roast my French: je suis allé au magasin hier et j'ai acheter du pain",
  "Quiz me on French numbers, one at a time.",
];

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

export function FrenchPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("chat");
  const [intensityPref, setIntensity] = usePref(PREF.roast, "spicy");
  const intensity = (INTENSITIES.find((i) => i.id === intensityPref)?.id ?? "spicy") as Intensity;
  const [levelPref, setLevel] = usePref(PREF.frlevel, "A1");
  const level = (["A1", "A2", "B1"].includes(levelPref) ? levelPref : "A1") as Level;
  const [speakOn] = useBoolPref(PREF.speak, true);
  const [rawProgress] = usePref(PREF.fr, "");
  const progress = useMemo(() => parseProgress(rawProgress), [rawProgress]);
  const st = stats(progress);

  const [target, setTarget] = useState<Target | null>(null);
  const recRef = useRef<Recognizer | null>(null);
  const [listening, setListening] = useState(false);
  const voiceOk = recognitionSupported();

  const commit = (p: FrProgress) => writePref(PREF.fr, JSON.stringify(p));

  function pierreSays(text: string) {
    if (speakOn) speak(text, "en", undefined, "pierre");
  }
  function hear(fr: string) {
    speak(fr, "fr", undefined, "frslow");
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
      play("listen");
      try {
        r.start();
      } catch {
        setListening(false);
        resolve("");
      }
    });
  }

  function close() {
    stopSpeaking();
    recRef.current?.abort();
    onClose();
  }

  // ---------- chat with Pierre ----------

  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Ah. A new student. I am Pierre. Say bonjour, or type it, if your mouth cannot manage it yet.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [frSpeech, setFrSpeech] = useState(false);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          mode: "general",
          kid: false,
          lang: "en",
          tutor: "fr",
          level,
          intensity,
          context: { nowIso: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgs((m) => [
          ...m,
          { role: "assistant", text: data.error ?? "Pierre is out for a cigarette. Try again.", error: true },
        ]);
        play("error");
        return;
      }
      setMsgs((m) => [...m, { role: "assistant", text: data.say, fr: data.fr }]);
      play("reply");
      pierreSays(data.say);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "No connection. Even Pierre cannot roast you offline.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function micChat() {
    if (listening) return recRef.current?.stop();
    const heard = await listen(frSpeech ? "fr" : "en");
    if (heard.trim()) void ask(heard);
  }

  // ---------- flashcards ----------

  interface Session {
    queue: FrCard[];
    i: number;
    right: number;
    wrong: number;
    revealed: boolean;
    feedback: string;
    ok: boolean;
  }
  const [session, setSession] = useState<Session | null>(null);
  const [answer, setAnswer] = useState("");
  const card = session && session.i < session.queue.length ? session.queue[session.i] : null;
  const isNew = card ? !progress.cards[card.id] : false;

  function startSession() {
    const queue = nextCards(progress, 10);
    setSession({ queue, i: 0, right: 0, wrong: 0, revealed: false, feedback: "", ok: false });
    setAnswer("");
    if (queue[0] && !progress.cards[queue[0].id]) hear(queue[0].fr);
  }

  function judge(given: string) {
    if (!session || !card) return;
    const score = similarity(given, card.fr);
    const ok = score >= 0.85;
    const accent = ok && accentOnly(given, card.fr);
    const roast = ok
      ? accent
        ? `Correct, but your accents are missing. It is ${card.fr}. Letters matter, mon ami.`
        : roastFor(1, intensity, card.fr)
      : `${roastFor(score, intensity, card.fr)}${card.tip ? " Tip: " + card.tip : ""}`;
    commit(review(progress, card.id, ok));
    setSession({ ...session, revealed: true, feedback: roast, ok, right: session.right + (ok ? 1 : 0), wrong: session.wrong + (ok ? 0 : 1) });
    play(ok ? "snap" : "error");
    hear(card.fr);
    if (!ok && speakOn) setTimeout(() => pierreSays(roast), 1800);
  }

  function nextCard() {
    if (!session) return;
    stopSpeaking();
    const i = session.i + 1;
    setSession({ ...session, i, revealed: false, feedback: "", ok: false });
    setAnswer("");
    const nxt = session.queue[i];
    if (nxt && !progress.cards[nxt.id]) hear(nxt.fr);
  }

  function gotIt() {
    // A new card was shown: schedule it for review tomorrow without scoring a quiz.
    if (!card || !session) return;
    commit(review(progress, card.id, true));
    nextCard();
  }

  async function micCard() {
    if (listening) return recRef.current?.stop();
    const heard = await listen("fr");
    if (heard.trim()) {
      setAnswer(heard);
      judge(heard);
    }
  }

  // ---------- say it ----------

  const [heard, setHeard] = useState("");
  const [sayResult, setSayResult] = useState<{ score: number; line: string } | null>(null);

  function pickTarget(t?: Target) {
    const c = DECK[Math.floor(Math.random() * DECK.length)];
    setTarget(t ?? { id: c.id, fr: c.fr, en: c.en });
    setHeard("");
    setSayResult(null);
  }

  async function micSay() {
    if (!target) return;
    if (listening) return recRef.current?.stop();
    const text = await listen("fr");
    setHeard(text);
    if (!text.trim()) {
      setSayResult({ score: 0, line: "I heard nothing. Silence is not a language. Try again closer to the mic." });
      return;
    }
    const score = similarity(text, target.fr);
    const line = roastFor(score, intensity, target.fr);
    setSayResult({ score, line });
    if (target.id) commit(review(progress, target.id, score >= 0.85));
    play(score >= 0.85 ? "snap" : "error");
    pierreSays(line);
  }

  const showTab = (t: Tab) => {
    stopSpeaking();
    setTab(t);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="French with Pierre" className="overlay">
      <div className="panel w-full max-w-xl mx-auto p-4 flex flex-col gap-4 my-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="hud-title text-xl font-bold">LE DOJO · PIERRE</h2>
            <p className="hud-mono text-xs opacity-80">
              XP {progress.xp} · STREAK {progress.streak}d · KNOWN {st.known}/{DECK.length}
            </p>
          </div>
          <button type="button" onClick={close} className="touch-target hud-cta px-6 font-bold">
            CLOSE
          </button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Roast level">
          {INTENSITIES.map((i) => (
            <Pill key={i.id} active={intensity === i.id} onClick={() => setIntensity(i.id)}>
              {i.label}
            </Pill>
          ))}
          <span className="w-2" />
          {(["A1", "A2", "B1"] as Level[]).map((l) => (
            <Pill key={l} active={level === l} onClick={() => setLevel(l)}>
              {l}
            </Pill>
          ))}
        </div>
        <p className="text-xs opacity-70">
          {INTENSITIES.find((i) => i.id === intensity)?.blurb}. Pierre roasts your mistakes, never you.
        </p>

        <div className="flex gap-2" role="tablist">
          <Pill active={tab === "chat"} onClick={() => showTab("chat")}>Talk to Pierre</Pill>
          <Pill active={tab === "cards"} onClick={() => showTab("cards")}>Cards{st.due ? ` (${st.due} due)` : ""}</Pill>
          <Pill active={tab === "say"} onClick={() => { showTab("say"); if (!target) pickTarget(); }}>Say it</Pill>
        </div>

        {tab === "chat" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 max-h-[46dvh] overflow-y-auto" aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "self-end max-w-[90%]" : "max-w-[95%]"}>
                  {m.role === "user" ? (
                    <p className="hud-mono text-right"><span className="opacity-60">&gt; </span>{m.text}</p>
                  ) : (
                    <div className={`panel p-3 ${m.error ? "hud-error" : ""}`}>
                      <p className="leading-snug">🥖 {m.text}</p>
                      {m.fr && m.fr.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1">
                          {m.fr.map((f) => (
                            <div key={f} className="flex items-center gap-2">
                              <span className="font-bold flex-1">{f}</span>
                              <button type="button" onClick={() => hear(f)} className="hud-chip rounded px-3 py-1 text-sm font-bold" aria-label={`Hear ${f}`}>
                                HEAR
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTab("say");
                                  pickTarget({ fr: f });
                                }}
                                className="hud-chip rounded px-3 py-1 text-sm font-bold"
                              >
                                SAY IT
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {busy && <p className="hud-mono opacity-80">&gt; PIERRE IS SIGHING…</p>}
            </div>

            {msgs.length <= 1 && (
              <div className="flex flex-wrap gap-2">
                {OPENERS.map((o) => (
                  <button key={o} type="button" onClick={() => void ask(o)} className="hud-chip rounded px-3 py-2 text-sm text-left">
                    {o}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void ask(input);
              }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Write in French or English…"
                className="hud-input flex-1 min-w-0 px-3"
                aria-label="Message to Pierre"
                autoCapitalize="off"
              />
              {voiceOk && (
                <button type="button" onClick={() => void micChat()} className={`hud-mic touch-target px-3 font-bold ${listening ? "is-live" : ""}`} aria-label="Speak">
                  {listening ? "●" : "MIC"}
                </button>
              )}
              <button type="submit" disabled={busy} className="touch-target hud-cta px-4 font-bold disabled:opacity-60">
                SEND
              </button>
            </form>
            {voiceOk && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={frSpeech} onChange={(e) => setFrSpeech(e.target.checked)} className="h-5 w-5" />
                I&apos;m speaking French into the mic (otherwise English)
              </label>
            )}
          </div>
        )}

        {tab === "cards" && (
          <div className="flex flex-col gap-3">
            {!session && (
              <div className="flex flex-col gap-3">
                <p>
                  {st.due} due · {st.fresh} new · {st.learning} learning · {st.known} known. Ten cards per round. New
                  cards are shown first, then Pierre quizzes you.
                </p>
                <button type="button" onClick={startSession} className="touch-target hud-cta px-6 font-bold">
                  START ROUND
                </button>
              </div>
            )}

            {session && !card && (
              <div className="flex flex-col gap-3">
                <p className="text-lg font-bold">
                  Round over: {session.right} right, {session.wrong} wrong.
                </p>
                <p>
                  {session.wrong === 0
                    ? "Flawless. Disgusting. I'm checking the dictionary for cheating."
                    : session.wrong > session.right
                      ? "That was painful to supervise. Again, and wear a beret this time."
                      : "Not terrible. Not good. Passable, like airport coffee."}
                </p>
                <button type="button" onClick={startSession} className="touch-target hud-cta px-6 font-bold">
                  NEXT ROUND
                </button>
              </div>
            )}

            {session && card && (
              <div className="flex flex-col gap-3">
                <p className="hud-mono text-xs opacity-70">
                  CARD {session.i + 1}/{session.queue.length} · {card.group.toUpperCase()}
                </p>
                {isNew && !session.revealed ? (
                  <div className="panel p-4 flex flex-col gap-2">
                    <p className="hud-mono text-xs opacity-70">NEW</p>
                    <p className="text-3xl font-bold">{card.fr}</p>
                    <p className="text-lg">{card.en}</p>
                    {card.tip && <p className="text-sm opacity-80">Tip: {card.tip}</p>}
                    <div className="flex gap-2 mt-2">
                      <button type="button" onClick={() => hear(card.fr)} className="touch-target hud-chip rounded px-4 font-bold">
                        HEAR
                      </button>
                      <button type="button" onClick={gotIt} className="touch-target hud-cta px-6 font-bold flex-1">
                        GOT IT
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="panel p-4 flex flex-col gap-3">
                    <p className="hud-mono text-xs opacity-70">SAY OR TYPE IN FRENCH</p>
                    <p className="text-2xl font-bold">{card.en}</p>
                    {!session.revealed ? (
                      <form
                        onSubmit={(e: FormEvent) => {
                          e.preventDefault();
                          if (answer.trim()) judge(answer);
                        }}
                        className="flex gap-2"
                      >
                        <input
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          className="hud-input flex-1 min-w-0 px-3"
                          aria-label="Your French answer"
                          autoCapitalize="off"
                          autoCorrect="off"
                        />
                        {voiceOk && (
                          <button type="button" onClick={() => void micCard()} className={`hud-mic touch-target px-3 font-bold ${listening ? "is-live" : ""}`} aria-label="Speak your answer">
                            {listening ? "●" : "MIC"}
                          </button>
                        )}
                        <button type="submit" className="touch-target hud-cta px-4 font-bold">
                          CHECK
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className={`text-xl font-bold ${session.ok ? "" : "hud-alert"}`}>{card.fr}</p>
                        <p>{session.feedback}</p>
                        <button type="button" onClick={nextCard} className="touch-target hud-cta px-6 font-bold">
                          NEXT
                        </button>
                      </div>
                    )}
                    {!session.revealed && (
                      <button
                        type="button"
                        onClick={() => judge("")}
                        className="text-sm underline opacity-70 self-start"
                      >
                        I have no idea
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "say" && (
          <div className="flex flex-col gap-3">
            {target && (
              <div className="panel p-4 flex flex-col gap-2">
                <p className="hud-mono text-xs opacity-70">SAY THIS</p>
                <p className="text-3xl font-bold">{target.fr}</p>
                {target.en && <p>{target.en}</p>}
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => hear(target.fr)} className="touch-target hud-chip rounded px-4 font-bold">
                    HEAR IT
                  </button>
                  {voiceOk ? (
                    <button type="button" onClick={() => void micSay()} className={`hud-mic touch-target px-4 font-bold flex-1 ${listening ? "is-live" : ""}`}>
                      {listening ? "● LISTENING… TAP TO STOP" : "TAP AND SAY IT"}
                    </button>
                  ) : (
                    <p className="text-sm opacity-80 flex-1">Speech recognition needs Chrome on Android.</p>
                  )}
                </div>
                {heard && (
                  <p className="hud-mono text-sm">
                    I heard: <span className="font-bold">{heard}</span>
                  </p>
                )}
                {sayResult && (
                  <div>
                    <p className="hud-mono text-sm">MATCH {Math.round(sayResult.score * 100)}%</p>
                    <p className="text-lg leading-snug">🥖 {sayResult.line}</p>
                  </div>
                )}
              </div>
            )}
            <button type="button" onClick={() => pickTarget()} className="touch-target hud-cta px-6 font-bold">
              NEW PHRASE
            </button>
            <p className="text-xs opacity-70">
              The score compares what Chrome heard with the phrase, so it rewards clear pronunciation. It cannot
              judge your accent the way a person does.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
