"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Card, DeviceContext, Mood } from "@/lib/agent/types";
import { executeActions, LaunchLink } from "@/lib/actions";
import { MODES, MODE_LABELS, type Mode } from "@/lib/assistant";
import { PREF, useBoolPref, usePref, writePref } from "@/lib/prefs";
import { onRobotEvent, robotConnected, setFace, stopDriving, useRobot, type RobotEvent } from "@/lib/robot";
import { play } from "@/lib/sfx";
import {
  Recognizer,
  VoiceLang,
  VoiceStyle,
  createRecognizer,
  recognitionSupported,
  speak,
  stopSpeaking,
  transcriptOf,
} from "@/lib/speech";
import { dataOps, getData, useData } from "@/lib/store";
import { CardView, TimerRing } from "./Cards";
import { HudCore, type OrbState } from "./HudCore";
import { MemoryManager } from "./MemoryManager";
import { RoboFace } from "./RoboFace";
import { RobotPanel } from "./RobotPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Typewriter } from "./Typewriter";

interface Entry {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
  note?: string;
  isError?: boolean;
  cards?: Card[];
  links?: LaunchLink[];
  chips?: string[];
}

const ORB_LABEL: Record<OrbState, string> = {
  standby: "STANDBY",
  listening: "LISTENING",
  thinking: "PROCESSING",
  speaking: "TRANSMITTING",
};

const MODE_HINT: Record<Mode, string> = {
  general: "Ask anything or give a command: timers, reminders, directions, weather, notes.",
  read: "Aim the camera at text and say: read this.",
  medicine: "Aim at a medicine box and say: what is this.",
  ad: "Aim at an ad and say: what is this ad really saying.",
  math: "Say a sum, or aim at a bill and say: add this up.",
};

const QUICK: { label: string; say: string }[] = [
  { label: "Weather", say: "What's the weather today?" },
  { label: "Prayer times", say: "What are today's prayer times?" },
  { label: "Timer 5 min", say: "Set a timer for 5 minutes" },
  { label: "USD to PKR", say: "How much is 100 dollars in rupees?" },
  { label: "What's the time", say: "What time is it?" },
  { label: "Take a note", say: "Take a note: " },
];

const KID_TILES: { icon: string; label: string; say: string; color: string }[] = [
  { icon: "🚀", label: "Space fact", say: "Tell me an amazing space fact", color: "#7c3aed" },
  { icon: "🐱", label: "Space cat story", say: "Tell me a funny story about a space cat", color: "#ec4899" },
  { icon: "🧩", label: "Riddle", say: "Ask me a riddle", color: "#0ea5e9" },
  { icon: "🔢", label: "Math game", say: "Let's play a fun math game", color: "#22c55e" },
  { icon: "🦁", label: "Guess the animal", say: "Let's play guess the animal", color: "#f59e0b" },
  { icon: "😂", label: "Joke", say: "Tell me a joke", color: "#ef4444" },
  { icon: "🎵", label: "Silly rhyme", say: "Make a silly rhyme", color: "#14b8a6" },
  { icon: "🎨", label: "Drawing idea", say: "Give me a fun drawing idea", color: "#a855f7" },
];

/** Instant, offline reactions to the robot's sensors (no AI call, so they are immediate). */
const REACTIONS: Record<RobotEvent, { adult: string[]; kid: string[]; mood: Mood; sfx: "ouch" | "whee" | "giggle" }> = {
  near: {
    adult: ["Obstacle ahead. Stopping."],
    kid: ["Oof! Something is in my way! Beep boop!", "Whoa, a wall! Time to turn around!"],
    mood: "surprised",
    sfx: "ouch",
  },
  cliff: {
    adult: ["Edge detected. Stopping."],
    kid: ["Yikes! A big drop! I am not going there!"],
    mood: "surprised",
    sfx: "ouch",
  },
  lift: {
    adult: ["I have been lifted. Motors off."],
    kid: ["Wheee! I am flying! Put me down gently please!"],
    mood: "excited",
    sfx: "whee",
  },
  touch: {
    adult: ["Touch detected. Hello."],
    kid: ["Hee hee! That tickles! Beep boop!", "Hello friend! Boop!"],
    mood: "love",
    sfx: "giggle",
  },
};

const WAKE =
  /\b(?:hey|hi|ok|okay|hello)?[\s,]*(?:see[\s-]?far|sea[\s-]?far|safar|sefar|seafar|c[\s-]?far)\b|سی\s?فار/i;

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`seefar-parent:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function storedPin(): string | null {
  try {
    return window.localStorage.getItem(PREF.pin);
  } catch {
    return null;
  }
}

export function Console() {
  const router = useRouter();
  const data = useData();

  const [booted, setBooted] = useState(false);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [booting, setBooting] = useState(false);
  const [mode, setMode] = useState<Mode>("general");
  const [log, setLog] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualListening, setManualListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<null | "set" | "exit">(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [showSystems, setShowSystems] = useState(false);
  const [now, setNow] = useState(0);
  const [battery, setBattery] = useState<number | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const [providerCount, setProviderCount] = useState<number | null>(null);
  const [freshId, setFreshId] = useState(0);
  const [awake, setAwake] = useState(false);
  const [mood, setMood] = useState<Mood>("neutral");
  const [showRobot, setShowRobot] = useState(false);

  const [motionOn] = useBoolPref(PREF.motion, true);
  const [speakOn] = useBoolPref(PREF.speak, true);
  const [handsfree, setHandsfree] = useBoolPref(PREF.handsfree, false);
  const [shareLoc] = useBoolPref(PREF.loc, true);
  const [lang] = usePref(PREF.lang, "en");
  const [voicePref] = usePref(PREF.voice, "robot");
  const [facePref] = useBoolPref(PREF.face, false);
  const robot = useRobot();
  const [kid, setKid] = useBoolPref(PREF.kid, false);
  const voiceLang: VoiceLang = lang === "ur" ? "ur" : "en";
  const voiceStyle: VoiceStyle = kid ? "cartoon" : voicePref === "natural" || voicePref === "cartoon" ? voicePref : "robot";

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const manualRecRef = useRef<Recognizer | null>(null);
  const hfRecRef = useRef<Recognizer | null>(null);
  const idRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(text: string) => void>(() => {});
  const awakeUntil = useRef(0);
  const locRef = useRef<{ lat: number; lon: number } | null>(null);
  const awakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- clock, timers, reminders ----------

  const fireAlert = useCallback(
    (title: string, body: string) => {
      play("alarm");
      idRef.current += 1;
      setLog((prev) => [...prev, { id: idRef.current, role: "system", text: `${title}: ${body}` }]);
      if (speakOn) speak(`${title}. ${body}`, voiceLang, undefined, voiceStyle);
      try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          void navigator.serviceWorker?.ready.then((r) =>
            r.showNotification(`SeeFar · ${title}`, { body, icon: "/icons/icon-192.png", tag: title + body })
          );
        }
      } catch {
        // Notifications are a bonus; the in-app alert already fired.
      }
    },
    [speakOn, voiceLang, voiceStyle]
  );

  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const d = getData();
      for (const timer of d.timers) {
        if (!timer.fired && timer.endsAt <= t) {
          dataOps.markFired("timers", timer.id);
          fireAlert("Timer complete", timer.label);
        }
      }
      for (const r of d.reminders) {
        if (!r.fired && r.at <= t) {
          dataOps.markFired("reminders", r.id);
          fireAlert("Reminder", r.text);
        }
      }
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [fireAlert]);

  useEffect(() => {
    dataOps.prune();
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; addEventListener: (e: string, f: () => void) => void }>;
    };
    nav.getBattery?.().then((b) => {
      const update = () => setBattery(Math.round(b.level * 100));
      update();
      b.addEventListener("levelchange", update);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      manualRecRef.current?.abort();
      hfRecRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, busy]);

  // ---------- camera ----------

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);

  async function startCamera() {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamOn(true);
      play("snap");
    } catch {
      setCamError("Camera blocked or unavailable. Allow camera access for this site in Chrome.");
      play("error");
    }
  }

  /** Current video frame as a small JPEG (base64, no prefix), or null. */
  function captureFrame(): string | null {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.videoWidth === 0) return null;
    for (const [maxSide, quality] of [
      [1280, 0.72],
      [960, 0.6],
      [720, 0.5],
    ] as const) {
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
      if (b64.length < 2_000_000) return b64;
    }
    return null;
  }

  // ---------- conversation ----------

  /** Speaks with the chosen voice style, preceded by a little robot chatter. */
  function talk(text: string, onEnd?: () => void) {
    if (voiceStyle !== "natural") play("chatter");
    speak(text, voiceLang, onEnd, voiceStyle);
  }

  function addEntry(e: Omit<Entry, "id">): number {
    idRef.current += 1;
    const id = idRef.current;
    setLog((prev) => [...prev, { ...e, id }]);
    return id;
  }

  /** After the assistant speaks, follow-up commands are accepted for 12 s without the wake word. */
  function openWindow() {
    awakeUntil.current = Date.now() + 12_000;
    setAwake(true);
    if (awakeTimer.current) clearTimeout(awakeTimer.current);
    awakeTimer.current = setTimeout(() => setAwake(false), 12_000);
  }

  function buildContext(): DeviceContext & { facts: string[] } {
    const d = getData();
    const t = Date.now();
    const tel = robot.telemetry;
    return {
      robot:
        robot.status === "on"
          ? { distanceCm: tel?.distanceCm ?? null, cliff: !!tel?.cliff, lifted: !!tel?.lifted }
          : undefined,
      nowIso: new Date(t).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi",
      lat: locRef.current?.lat,
      lon: locRef.current?.lon,
      facts: d.facts,
      lists: d.lists,
      notes: d.notes.slice(0, 8).map((n) => n.text),
      timers: d.timers
        .filter((x) => !x.fired)
        .map((x) => ({ label: x.label, secondsLeft: Math.max(0, Math.round((x.endsAt - t) / 1000)) })),
      reminders: d.reminders
        .filter((x) => !x.fired)
        .map((x) => ({
          text: x.text,
          at: new Date(x.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }),
        })),
    };
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    const image = camOn && !kid ? captureFrame() : null;
    const history = log
      .filter((m) => m.role !== "system" && !m.isError)
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    stopSpeaking();
    setSpeaking(false);
    if (image) play("snap");
    play("send");
    addEntry({ role: "user", text, note: image ? "camera frame attached" : undefined });
    setInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, mode, kid, lang, image, context: buildContext() }),
      });
      if (response.status === 401) {
        router.push("/login?next=/");
        return;
      }
      const res = await response.json().catch(() => ({}));
      if (!response.ok) {
        play("error");
        addEntry({ role: "assistant", text: res.error ?? "Something went wrong.", isError: true });
        return;
      }

      const outcome = executeActions(res.actions ?? []);
      if (res.mood) {
        setMood(res.mood);
        setFace(res.mood);
      }
      if (outcome.wantsCamera && !camOn && !kid) void startCamera();
      const fell: string[] = res.fellBackFrom ?? [];
      setFreshId(addEntry({
        role: "assistant",
        text: res.say,
        cards: res.cards,
        links: outcome.links,
        chips: outcome.chips,
        note: `${res.providerId}${fell.length ? ` · ${fell.join(", ")} skipped` : ""}`,
      }));
      play(kid ? "kid" : "reply");
      if (outcome.chips.length) play("tick");

      if (speakOn && res.say) {
        setSpeaking(true);
        talk(res.say, () => {
          setSpeaking(false);
          openWindow();
        });
      } else {
        openWindow();
      }
    } catch {
      play("error");
      addEntry({ role: "assistant", text: "Could not reach the server. Check your connection.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    sendRef.current = send;
  });

  // ---------- robot sensor reactions ----------

  const reactRef = useRef<(e: RobotEvent) => void>(() => {});
  const lastReact = useRef<Record<string, number>>({});

  useEffect(() => {
    reactRef.current = (e: RobotEvent) => {
      const t = Date.now();
      if (t - (lastReact.current[e] ?? 0) < 4000) return;
      lastReact.current[e] = t;
      const r = REACTIONS[e];
      const lines = kid ? r.kid : r.adult;
      const line = lines[Math.floor(Math.random() * lines.length)];
      play(r.sfx);
      setMood(r.mood);
      setFace(r.mood);
      addEntry({ role: "system", text: line });
      if (speakOn && !busy) {
        setSpeaking(true);
        talk(line, () => setSpeaking(false));
      }
      setTimeout(() => {
        setMood("neutral");
        if (robotConnected()) setFace("happy");
      }, 4500);
    };
  });

  useEffect(() => onRobotEvent((e) => reactRef.current(e)), []);

  // ---------- voice: tap to talk ----------

  function toggleManual() {
    if (manualListening) {
      manualRecRef.current?.stop();
      return;
    }
    hfRecRef.current?.abort();
    stopSpeaking();
    setSpeaking(false);
    const r = createRecognizer(voiceLang);
    if (!r) return;
    manualRecRef.current = r;
    let finalText = "";
    r.onresult = (e) => {
      const { text, final } = transcriptOf(e);
      setInput(text);
      if (final) finalText = text;
    };
    r.onerror = () => play("error");
    r.onend = () => {
      setManualListening(false);
      if (finalText.trim()) sendRef.current(finalText);
    };
    play("listen");
    setManualListening(true);
    try {
      r.start();
    } catch {
      setManualListening(false);
    }
  }

  // ---------- voice: "Hey SeeFar" always-listening loop ----------

  const hfActive = handsfree && booted && !busy && !speaking && !manualListening && !pinMode && !showSystems;

  useEffect(() => {
    if (!hfActive) return;
    const r = createRecognizer(voiceLang);
    if (!r) return;
    hfRecRef.current = r;
    let stopped = false;
    let heard = "";
    r.interimResults = false;
    r.onresult = (e) => {
      const { text, final } = transcriptOf(e);
      if (final) heard = text;
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        setHandsfree(false);
        addEntry({
          role: "system",
          text: "Microphone permission was refused, so Hey SeeFar is off. Allow the mic for this site in Chrome.",
        });
      }
    };
    r.onend = () => {
      const text = heard.trim();
      if (text) {
        const m = WAKE.exec(text);
        const t = Date.now();
        if (m) {
          const cmd = text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, "");
          if (cmd.length > 1) sendRef.current(cmd);
          else {
            play("wake");
            openWindow();
            setSpeaking(true);
            talk(voiceLang === "ur" ? "جی؟" : "Yes?", () => {
              setSpeaking(false);
              openWindow();
            });
          }
        } else if (t < awakeUntil.current) {
          sendRef.current(text);
        }
      }
      if (!stopped) setTimeout(() => setRestartTick((n) => n + 1), text ? 0 : 350);
    };
    try {
      r.start();
    } catch {
      // Already started elsewhere; the next tick retries.
    }
    return () => {
      stopped = true;
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hfActive, restartTick, voiceLang]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  // ---------- power-up sequence ----------

  async function powerUp() {
    if (booting) return;
    setBooting(true);
    play("boot");
    const lines: string[] = [];
    const push = (l: string) => {
      lines.push(l);
      setBootLines([...lines]);
      play("tick");
    };
    push("CORE ........ ONLINE");
    push(`VOICE ....... ${recognitionSupported() ? "READY" : "UNSUPPORTED (use Chrome)"}`);
    push(`CAMERA ...... ${navigator.mediaDevices ? "STANDBY" : "UNAVAILABLE"}`);
    push(`MEMORY ...... ${getData().facts.length} FACTS · ${getData().notes.length} NOTES`);

    const locPromise = new Promise<void>((resolve) => {
      if (!shareLoc || kid || !navigator.geolocation) return resolve();
      navigator.geolocation.getCurrentPosition(
        (p) => {
          // Rounded to ~1 km: enough for weather, not enough to find a door.
          locRef.current = {
            lat: Math.round(p.coords.latitude * 100) / 100,
            lon: Math.round(p.coords.longitude * 100) / 100,
          };
          resolve();
        },
        () => resolve(),
        { timeout: 4000, maximumAge: 600000 }
      );
    });
    const provPromise = fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setProviderCount(j.providers.filter((p: { configured: boolean }) => p.configured).length);
      })
      .catch(() => {});

    await Promise.all([locPromise, provPromise, new Promise((r) => setTimeout(r, 1400))]);
    push(`LOCATION .... ${locRef.current ? "LOCKED" : "NOT SHARED"}`);
    await new Promise((r) => setTimeout(r, 500));
    setBooted(true);
    setBooting(false);
    play("wake");
    if (speakOn) talk(kid ? "Beep boop! Zippy is online! Pick a game!" : "SeeFar online. How can I help?");
  }

  // ---------- kid mode ----------

  function activateKid() {
    stopCamera();
    setLog([]);
    stopSpeaking();
    setSpeaking(false);
    setMode("general");
    setKid(true);
    setPinMode(null);
    play("kid");
  }

  function enterKidMode() {
    if (!storedPin()) {
      setPinMode("set");
      setPinInput("");
      setPinError(null);
      return;
    }
    activateKid();
  }

  async function submitPin(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError("Use exactly 4 digits.");
      return;
    }
    const hash = await hashPin(pinInput);
    if (pinMode === "set") {
      writePref(PREF.pin, hash);
      setPinInput("");
      activateKid();
      return;
    }
    if (hash === storedPin()) {
      setLog([]);
      stopSpeaking();
      setSpeaking(false);
      setKid(false);
      setPinMode(null);
      setPinInput("");
      play("reply");
    } else {
      setPinError("Wrong PIN.");
      play("error");
    }
  }

  // ---------- derived UI state ----------

  const orb: OrbState = manualListening
    ? "listening"
    : busy
      ? "thinking"
      : speaking
        ? "speaking"
        : hfActive && awake
          ? "listening"
          : "standby";
  const voiceOk = recognitionSupported();
  const activeTimers = data.timers.filter((t) => !t.fired);
  const clock = now
    ? new Date(now).toLocaleTimeString("en-GB", { hour12: false })
    : "--:--:--";
  const dateStr = now
    ? new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase()
    : "";

  // ---------- render ----------

  if (!booted) {
    return (
      <div className={`app-root ${kid ? "kid-skin" : ""} flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center`} data-motion={motionOn ? "on" : "off"}>
        {kid || facePref ? (
          <RoboFace state={booting ? "thinking" : "standby"} mood="happy" motion={motionOn} kid={kid} />
        ) : (
          <HudCore state={booting ? "thinking" : "standby"} motion={motionOn} kid={kid} />
        )}
        <h1 className="hud-title text-4xl font-bold">{kid ? "MISSION CONTROL" : "SEEFAR"}</h1>
        {booting ? (
          <ul className="hud-mono text-left text-sm leading-relaxed" aria-live="polite">
            {bootLines.map((l) => (
              <li key={l}>&gt; {l}</li>
            ))}
          </ul>
        ) : (
          <>
            <p className="opacity-80 max-w-xs">Voice and vision assistant. Say commands, aim the camera, get things done.</p>
            <button type="button" onClick={powerUp} className="touch-target hud-cta px-10 text-xl font-bold">
              POWER UP
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`app-root ${kid ? "kid-skin" : ""} flex-1 flex flex-col items-center gap-2 px-3 pb-3 pt-2`} data-motion={motionOn ? "on" : "off"}>
      <header className="w-full max-w-xl flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="hud-title text-xl font-bold leading-none">{kid ? "MISSION CONTROL" : "SEEFAR"}</h1>
          <p className="hud-mono text-xs opacity-80 mt-1">
            {clock} · {dateStr}
            {battery !== null ? ` · BAT ${battery}%` : ""}
            {providerCount !== null ? ` · AI ${providerCount}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {kid ? (
            <button
              type="button"
              onClick={() => {
                setPinMode("exit");
                setPinInput("");
                setPinError(null);
              }}
              className="touch-target hud-chip rounded px-3 font-bold text-sm"
            >
              PARENT
            </button>
          ) : (
            <>
              <button type="button" onClick={enterKidMode} className="touch-target hud-chip rounded px-3 font-bold text-sm">
                KID
              </button>
              <button
                type="button"
                onClick={() => setShowRobot(true)}
                className={`touch-target hud-chip rounded px-3 font-bold text-sm ${robot.status === "on" ? "is-active" : ""}`}
              >
                BOT
              </button>
              <button
                type="button"
                onClick={() => setShowSystems(true)}
                className="touch-target hud-chip rounded px-3 font-bold text-sm"
              >
                SYSTEMS
              </button>
            </>
          )}
        </div>
      </header>

      {pinMode && (
        <form onSubmit={submitPin} className="panel w-full max-w-xl p-4 flex flex-col gap-3">
          <label htmlFor="pin" className="font-bold">
            {pinMode === "set"
              ? "Set a 4-digit parent PIN. It is needed to leave kid mode."
              : "Enter the parent PIN"}
          </label>
          <input
            id="pin"
            inputMode="numeric"
            autoComplete="off"
            type="password"
            maxLength={4}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
            className="hud-input p-3 text-2xl tracking-widest"
          />
          {pinError && (
            <p role="alert" className="font-bold">
              {pinError}
            </p>
          )}
          <p className="text-sm opacity-70">
            This lock stops children tapping out of kid mode. It is not strong security: it is stored on
            this phone only.
          </p>
          <div className="flex gap-3">
            <button type="submit" className="touch-target hud-cta flex-1 font-bold">
              {pinMode === "set" ? "SAVE AND START" : "UNLOCK"}
            </button>
            <button type="button" onClick={() => setPinMode(null)} className="touch-target hud-chip rounded px-5 font-bold">
              CANCEL
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col items-center">
        {kid || facePref ? (
          <RoboFace state={orb} mood={mood} motion={motionOn} kid={kid} compact={camOn} />
        ) : (
          <HudCore state={orb} motion={motionOn} kid={kid} compact={camOn} />
        )}
        <p role="status" aria-live="polite" className="hud-title font-bold tracking-widest text-sm -mt-1">
          {ORB_LABEL[orb]}
          {handsfree && orb === "standby" ? " · SAY “HEY SEEFAR”" : ""}
        </p>
      </div>

      {!kid && (
        <div className="w-full max-w-xl flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`hud-chip rounded px-4 py-2 font-bold whitespace-nowrap ${mode === m ? "is-active" : ""}`}
            >
              {MODE_LABELS[m].toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className={`w-full max-w-xl ${camOn && !kid ? "" : "hidden"}`}>
        <div className="panel relative overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full aspect-video object-cover max-h-[26dvh]"
            aria-label="Camera view"
          />
          <div className="reticle" aria-hidden />
          <span className="hud-label absolute left-2 top-2">VISION · LIVE</span>
        </div>
      </div>
      {camError && (
        <p role="alert" className="font-bold w-full max-w-xl">
          {camError}
        </p>
      )}

      {activeTimers.length > 0 && (
        <div className="w-full max-w-xl flex flex-col gap-2">
          {activeTimers.map((t) => (
            <TimerRing
              key={t.id}
              label={t.label}
              endsAt={t.endsAt}
              startedLen={t.len ?? Math.max(1, (t.endsAt - now) / 1000)}
              now={now}
              onCancel={() => dataOps.cancelTimer(t.id)}
            />
          ))}
        </div>
      )}

      <section aria-label="Conversation" className="w-full max-w-xl flex-1 min-h-[96px] overflow-y-auto flex flex-col gap-2">
        {log.length === 0 && (
          kid ? (
            <div className="grid grid-cols-2 gap-3">
              {KID_TILES.map((k) => (
                <button
                  key={k.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(k.say)}
                  className="kid-tile touch-target flex flex-col items-center justify-center gap-1 p-3 font-bold disabled:opacity-60"
                  style={{ background: k.color }}
                >
                  <span className="text-4xl" aria-hidden>
                    {k.icon}
                  </span>
                  <span className="text-lg">{k.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="opacity-70 text-sm">{MODE_HINT[mode]}</p>
          )
        )}
        {log.map((m) => (
          <div key={m.id} className="flex flex-col gap-2">
            {m.role === "user" && (
              <p className="hud-mono self-end max-w-[90%] text-right">
                <span className="opacity-60">&gt; </span>
                {m.text}
                {m.note && <span className="block text-xs opacity-60">{m.note}</span>}
              </p>
            )}
            {m.role === "system" && (
              <p role="alert" className="panel hud-alert p-2 text-center font-bold">
                {m.text}
              </p>
            )}
            {m.role === "assistant" && (
              <div className={`panel p-3 ${m.isError ? "hud-error" : ""}`} role={m.isError ? "alert" : undefined}>
                <p className="text-lg leading-snug">
                  <Typewriter
                    text={m.text}
                    instant={m.id !== freshId || !motionOn}
                  />
                </p>
                {m.chips && m.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.chips.map((c) => (
                      <span key={c} className="hud-tag">
                        ✓ {c}
                      </span>
                    ))}
                  </div>
                )}
                {m.note && <p className="mt-1 text-xs opacity-50 hud-mono">{m.note}</p>}
              </div>
            )}
            {m.cards?.map((c, i) => <CardView key={i} card={c} />)}
            {m.links?.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="touch-target hud-cta flex flex-col justify-center px-4 py-2">
                <span className="font-bold">{l.label} ↗</span>
                {l.sub && <span className="text-sm opacity-90">{l.sub}</span>}
              </a>
            ))}
          </div>
        ))}
        {busy && <p className="hud-mono opacity-80">&gt; PROCESSING…</p>}
        <div ref={logEndRef} />
      </section>

      <div className="w-full max-w-xl flex gap-2 overflow-x-auto" aria-label="Quick commands">
        {(kid ? (log.length ? KID_TILES.map((k) => ({ label: `${k.icon} ${k.label}`, say: k.say })) : []) : QUICK).map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={busy}
            onClick={() => (q.say.endsWith(": ") ? setInput(q.say) : void send(q.say))}
            className="hud-chip rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap disabled:opacity-50"
          >
            {q.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="w-full max-w-xl flex flex-col gap-2">
        <label htmlFor="ask" className="sr-only">
          Ask SeeFar
        </label>
        <div className="flex gap-2">
          <input
            id="ask"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={kid ? "Type here or tap the mic" : "Type a command…"}
            className="hud-input flex-1 p-3 text-lg"
            enterKeyHint="send"
          />
          <button type="submit" disabled={busy || !input.trim()} className="touch-target hud-chip rounded px-4 font-bold disabled:opacity-50">
            SEND
          </button>
        </div>
        <div className="flex gap-2">
          {!kid && (
            <button
              type="button"
              onClick={camOn ? stopCamera : startCamera}
              aria-pressed={camOn}
              className={`touch-target hud-chip rounded px-4 font-bold ${camOn ? "is-active" : ""}`}
            >
              {camOn ? "CAM ON" : "CAM"}
            </button>
          )}
          <button
            type="button"
            onClick={toggleManual}
            disabled={!voiceOk || busy}
            aria-pressed={manualListening}
            className={`touch-target hud-mic flex-1 text-lg font-bold disabled:opacity-50 ${manualListening ? "is-live" : ""}`}
          >
            {!voiceOk ? "VOICE NEEDS CHROME" : manualListening ? "LISTENING… TAP TO SEND" : "TAP & SPEAK"}
          </button>
          <button
            type="button"
            onClick={() => setHandsfree(!handsfree)}
            aria-pressed={handsfree}
            disabled={!voiceOk}
            title="Always listen for 'Hey SeeFar'"
            className={`touch-target hud-chip rounded px-3 font-bold text-sm ${handsfree ? "is-active" : ""}`}
          >
            HEY
          </button>
        </div>
        {robot.status === "on" && (
          <button
            type="button"
            onClick={stopDriving}
            className="touch-target rounded font-bold"
            style={{ background: "#c1121f", color: "#fff", border: "2px solid #fff" }}
          >
            ROBOT STOP
          </button>
        )}
        {speaking && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setSpeaking(false);
            }}
            className="touch-target hud-chip rounded font-bold"
          >
            STOP TALKING
          </button>
        )}
      </form>

      {showRobot && (
        <div role="dialog" aria-modal="true" aria-label="Robot" className="overlay">
          <div className="panel w-full max-w-xl mx-auto p-4 flex flex-col gap-5 my-4">
            <div className="flex items-center justify-between">
              <h2 className="hud-title text-xl font-bold">ROBOT BODY</h2>
              <button
                type="button"
                onClick={() => {
                  stopDriving();
                  setShowRobot(false);
                }}
                className="touch-target hud-cta px-6 font-bold"
              >
                CLOSE
              </button>
            </div>
            <RobotPanel />
          </div>
        </div>
      )}

      {showSystems && (
        <div role="dialog" aria-modal="true" aria-label="Systems" className="overlay">
          <div className="panel w-full max-w-xl mx-auto p-4 flex flex-col gap-5 my-4">
            <div className="flex items-center justify-between">
              <h2 className="hud-title text-xl font-bold">SYSTEMS</h2>
              <button type="button" onClick={() => setShowSystems(false)} className="touch-target hud-cta px-6 font-bold">
                CLOSE
              </button>
            </div>
            <SettingsPanel />
            <MemoryManager />
          </div>
        </div>
      )}
    </div>
  );
}
