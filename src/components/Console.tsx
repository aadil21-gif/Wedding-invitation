"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MODES, MODE_LABELS, type Mode } from "@/lib/assistant";
import { PREF, removePref, useBoolPref, usePref, writePref } from "@/lib/prefs";
import { play } from "@/lib/sfx";
import {
  Recognizer,
  VoiceLang,
  createRecognizer,
  recognitionSupported,
  speak,
  stopSpeaking,
  transcriptOf,
} from "@/lib/speech";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  note?: string;
  isError?: boolean;
}

type OrbState = "standby" | "listening" | "thinking" | "speaking";

const ORB_LABEL: Record<OrbState, string> = {
  standby: "Standby",
  listening: "Listening",
  thinking: "Analyzing",
  speaking: "Speaking",
};

const MODE_HINT: Record<Mode, string> = {
  general: "Ask me anything",
  read: "Point the camera at text, then say: read this",
  medicine: "Point at a medicine box, then say: what is this",
  ad: "Point at an ad, then say: what is this ad really saying",
  math: "Say a sum, or point at a bill",
};

const KID_IDEAS = [
  "Tell me a funny story about a space cat",
  "Ask me an animal riddle",
  "Give me a fun math game",
  "Tell me an amazing space fact",
  "Teach me a joke",
  "What sound does a whale make?",
];

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`seefar-parent:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function Console() {
  const router = useRouter();
  const [booted, setBooted] = useState(false);
  const [mode, setMode] = useState<Mode>("general");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<null | "set" | "exit">(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const [soundOn] = useBoolPref(PREF.sound, true);
  const [motionOn] = useBoolPref(PREF.motion, true);
  const [speakOn] = useBoolPref(PREF.speak, true);
  const [lang] = usePref(PREF.lang, "en");
  const [kid, setKid] = useBoolPref(PREF.kid, false);
  const voiceLang: VoiceLang = lang === "ur" ? "ur" : "en";

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recogRef = useRef<Recognizer | null>(null);
  const idRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(text: string) => void>(() => {});

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recogRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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

  /** Grabs the current video frame as a small JPEG (base64, no prefix). */
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

  function addMessage(m: Omit<Message, "id">) {
    idRef.current += 1;
    const msg = { ...m, id: idRef.current };
    setMessages((prev) => [...prev, msg]);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    const image = camOn && !kid ? captureFrame() : null;
    const history = messages
      .filter((m) => !m.isError)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }));

    stopSpeaking();
    setSpeaking(false);
    if (image) play("snap");
    play("send");
    addMessage({ role: "user", text, note: image ? "with camera view" : undefined });
    setInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, mode, kid, lang, image }),
      });
      if (response.status === 401) {
        router.push("/login?next=/");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        play("error");
        addMessage({
          role: "assistant",
          text: data.error ?? "Something went wrong.",
          isError: true,
        });
        return;
      }
      const fell: string[] = data.fellBackFrom ?? [];
      addMessage({
        role: "assistant",
        text: data.text,
        note: `${data.providerId}${fell.length ? ` (after ${fell.join(", ")} failed)` : ""}`,
      });
      play(kid ? "kid" : "reply");
      if (speakOn) {
        setSpeaking(true);
        speak(data.text, voiceLang, () => setSpeaking(false));
      }
    } catch {
      play("error");
      addMessage({
        role: "assistant",
        text: "Could not reach the server. Check your connection.",
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    sendRef.current = send;
  });

  function toggleListen() {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    stopSpeaking();
    setSpeaking(false);
    const r = createRecognizer(voiceLang);
    if (!r) return;
    recogRef.current = r;
    let finalText = "";
    r.onresult = (e) => {
      const { text, final } = transcriptOf(e);
      setInput(text);
      if (final) finalText = text;
    };
    r.onerror = () => {
      play("error");
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) sendRef.current(finalText);
    };
    play("listen");
    setListening(true);
    r.start();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function resetConversation() {
    setMessages([]);
    stopSpeaking();
    setSpeaking(false);
  }

  function enterKidMode() {
    if (!readHasPin()) {
      setPinMode("set");
      setPinInput("");
      setPinError(null);
      return;
    }
    activateKid();
  }

  function activateKid() {
    stopCamera();
    resetConversation();
    setMode("general");
    setKid(true);
    setPinMode(null);
    play("kid");
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
    if (hash === localStorageGet(PREF.pin)) {
      resetConversation();
      setKid(false);
      setPinMode(null);
      setPinInput("");
      play("reply");
    } else {
      setPinError("Wrong PIN.");
      play("error");
    }
  }

  const orb: OrbState = listening ? "listening" : busy ? "thinking" : speaking ? "speaking" : "standby";
  const voiceOk = recognitionSupported();

  if (!booted) {
    return (
      <div className="hud-root flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="orb" data-state="standby" data-motion={motionOn ? "on" : "off"} aria-hidden />
        <h1 className="hud-title text-4xl font-bold">SEEFAR</h1>
        <p className="opacity-80">Vision and voice assistant</p>
        <button
          type="button"
          onClick={() => {
            play("boot");
            setBooted(true);
          }}
          className="touch-target hud-button rounded-lg px-8 text-xl font-bold"
        >
          Power up
        </button>
        <p className="text-sm opacity-60">
          Sound is {soundOn ? "on" : "off"}. You can change it in Settings.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`${kid ? "kid-skin" : "hud-root"} flex-1 w-full flex flex-col items-center gap-4 p-4`}
      data-motion={motionOn ? "on" : "off"}
    >
      <header className="w-full max-w-xl flex items-center justify-between gap-2">
        <h1 className="hud-title text-2xl font-bold">{kid ? "SeeFar Buddy" : "SEEFAR"}</h1>
        {kid ? (
          <button
            type="button"
            onClick={() => {
              setPinMode("exit");
              setPinInput("");
              setPinError(null);
            }}
            className="touch-target hud-button rounded-lg px-4 font-bold"
          >
            Parent exit
          </button>
        ) : (
          <button
            type="button"
            onClick={enterKidMode}
            className="touch-target hud-button rounded-lg px-4 font-bold"
          >
            Kid mode
          </button>
        )}
      </header>

      {pinMode && (
        <form
          onSubmit={submitPin}
          className="hud-panel w-full max-w-xl rounded-lg p-4 flex flex-col gap-3"
        >
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
            className="hud-input rounded-lg p-3 text-2xl tracking-widest"
          />
          {pinError && (
            <p role="alert" className="font-bold">
              {pinError}
            </p>
          )}
          <p className="text-sm opacity-70">
            This lock stops children tapping out of kid mode. It is not strong security: it is stored
            on this phone only.
          </p>
          <div className="flex gap-3">
            <button type="submit" className="touch-target hud-button rounded-lg px-6 font-bold flex-1">
              {pinMode === "set" ? "Save and start" : "Unlock"}
            </button>
            <button
              type="button"
              onClick={() => setPinMode(null)}
              className="touch-target hud-button rounded-lg px-6 font-bold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col items-center gap-2">
        <div className="orb" data-state={orb} aria-hidden />
        <p role="status" aria-live="polite" className="hud-title font-bold tracking-widest uppercase">
          {ORB_LABEL[orb]}
        </p>
      </div>

      {!kid && (
        <>
          <div role="group" aria-label="Mode" className="w-full max-w-xl flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`touch-target hud-chip rounded-full px-4 font-bold ${
                  mode === m ? "is-active" : ""
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <p className="w-full max-w-xl text-sm opacity-80">{MODE_HINT[mode]}</p>

          <div className="w-full max-w-xl flex flex-col gap-2">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`hud-panel rounded-lg w-full aspect-video object-cover ${camOn ? "" : "hidden"}`}
              aria-label="Camera view"
            />
            <button
              type="button"
              onClick={camOn ? stopCamera : startCamera}
              aria-pressed={camOn}
              className="touch-target hud-button rounded-lg font-bold"
            >
              {camOn ? "Camera on: tap to turn off" : "Turn camera on"}
            </button>
            {camOn && (
              <p className="text-sm opacity-80">
                Each question you ask includes the current camera view. Photos go to the AI provider
                that answers, and free providers may keep them.
              </p>
            )}
            {camError && (
              <p role="alert" className="font-bold">
                {camError}
              </p>
            )}
          </div>
        </>
      )}

      {kid && (
        <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
          {KID_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              disabled={busy}
              onClick={() => void send(idea)}
              className="touch-target kid-card rounded-2xl p-4 text-lg font-bold text-left disabled:opacity-60"
            >
              {idea}
            </button>
          ))}
        </div>
      )}

      <section
        aria-label="Conversation"
        className="w-full max-w-xl flex flex-col gap-3 max-h-[40vh] overflow-y-auto"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            role={m.isError ? "alert" : undefined}
            className={`rounded-lg p-3 ${m.role === "user" ? "hud-user self-end" : "hud-panel"} ${
              m.isError ? "hud-error" : ""
            }`}
          >
            <p className="text-lg">{m.text}</p>
            {m.note && <p className="mt-1 text-xs opacity-70">{m.note}</p>}
          </div>
        ))}
        {busy && <p className="opacity-70">Working on it…</p>}
        <div ref={logEndRef} />
      </section>

      <form onSubmit={onSubmit} className="w-full max-w-xl flex flex-col gap-3 mt-auto">
        <label htmlFor="ask" className="sr-only">
          Ask SeeFar
        </label>
        <div className="flex gap-2">
          <input
            id="ask"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={kid ? "Type here or tap the mic" : "Type, or tap the mic"}
            className="hud-input flex-1 rounded-lg p-4 text-lg"
            enterKeyHint="send"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="touch-target hud-button rounded-lg px-5 font-bold disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <button
          type="button"
          onClick={toggleListen}
          disabled={!voiceOk || busy}
          aria-pressed={listening}
          className={`touch-target hud-mic rounded-lg text-xl font-bold disabled:opacity-50 ${
            listening ? "is-live" : ""
          }`}
        >
          {!voiceOk
            ? "Voice input needs Chrome"
            : listening
              ? "Listening… tap to stop"
              : "Tap and speak"}
        </button>
        {speaking && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setSpeaking(false);
            }}
            className="touch-target hud-button rounded-lg font-bold"
          >
            Stop talking
          </button>
        )}
      </form>
    </div>
  );
}

function localStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readHasPin(): boolean {
  return !!localStorageGet(PREF.pin);
}

// Exported for Settings: lets a parent clear the PIN only from outside kid mode.
export function clearParentPin() {
  removePref(PREF.pin);
}
