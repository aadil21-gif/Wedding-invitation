"use client";

import { useEffect, useState } from "react";
import type { Mode } from "@/lib/assistant";

interface BriefData {
  weather: { temp: number; summary: string; hi: number; lo: number; rain: number } | null;
  prayers: Record<string, string> | null;
}

export interface BriefAction {
  icon: string;
  label: string;
  /** Sent straight to the assistant. */
  say?: string;
  /** Put in the text box for the user to finish. */
  fill?: string;
  /** Switch to a camera mode. */
  mode?: Mode;
  open?: "french" | "kid" | "robot";
}

export const BRIEF_ACTIONS: BriefAction[] = [
  { icon: "⏱️", label: "Timer", say: "Set a timer for 10 minutes" },
  { icon: "⏰", label: "Remind me", fill: "Remind me to " },
  { icon: "🧭", label: "Take me to", fill: "Take me to " },
  { icon: "📞", label: "Call", fill: "Call " },
  { icon: "📖", label: "Read this", mode: "read" },
  { icon: "💊", label: "Medicine", mode: "medicine" },
  { icon: "📝", label: "Note", fill: "Take a note: " },
  { icon: "🛒", label: "Shopping list", say: "What is on my shopping list?" },
  { icon: "🕌", label: "Prayer times", say: "What are today's prayer times?" },
  { icon: "💱", label: "USD to PKR", say: "How much is 100 dollars in rupees?" },
  { icon: "🇫🇷", label: "French", open: "french" },
  { icon: "🧒", label: "Kids", open: "kid" },
];

function nextPrayer(prayers: Record<string, string>, now: number): { name: string; mins: number } | null {
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const list = Object.entries(prayers)
    .map(([name, t]) => {
      const [h, m] = t.split(":").map(Number);
      return { name, at: h * 60 + m };
    })
    .sort((a, b) => a.at - b.at);
  const next = list.find((p) => p.at > cur) ?? { ...list[0], at: list[0].at + 24 * 60 };
  return { name: next.name, mins: next.at - cur };
}

/** Assistant home: what matters now, and one-tap actions. No chat history. */
export function Briefing({
  now,
  lat,
  lon,
  timers,
  reminders,
  onAction,
}: {
  now: number;
  lat?: number;
  lon?: number;
  timers: { id: string; label: string; endsAt: number }[];
  reminders: { id: string; text: string; at: number }[];
  onAction: (a: BriefAction) => void;
}) {
  const [data, setData] = useState<BriefData | null>(null);

  useEffect(() => {
    const qs = lat !== undefined && lon !== undefined ? `?lat=${lat}&lon=${lon}` : "";
    let live = true;
    fetch(`/api/brief${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lat, lon]);

  const hour = new Date(now).getHours();
  const greet = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const np = data?.prayers ? nextPrayer(data.prayers, now) : null;
  const upcoming = reminders.filter((r) => r.at > now).sort((a, b) => a.at - b.at).slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-3 flex flex-col gap-2">
        <p className="text-lg font-bold">{greet}, Aadil.</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {data?.weather && (
            <span className="hud-tag">
              🌤 {data.weather.temp}° {data.weather.summary} · {data.weather.lo}–{data.weather.hi}°
              {data.weather.rain >= 30 ? ` · ${data.weather.rain}% rain` : ""}
            </span>
          )}
          {np && (
            <span className="hud-tag">
              🕌 {np.name} in {Math.floor(np.mins / 60) > 0 ? `${Math.floor(np.mins / 60)}h ` : ""}
              {np.mins % 60}m
            </span>
          )}
          {timers.map((t) => (
            <span key={t.id} className="hud-tag">
              ⏱ {t.label} {Math.max(0, Math.ceil((t.endsAt - now) / 60000))}m
            </span>
          ))}
        </div>
        {upcoming.length > 0 ? (
          <ul className="text-sm">
            {upcoming.map((r) => (
              <li key={r.id}>
                ⏰ {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-70">No reminders today. Tap the mic and tell me what to remember.</p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick actions">
        {BRIEF_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onAction(a)}
            className="hud-chip rounded flex flex-col items-center justify-center gap-1 py-3 px-1 min-h-[72px]"
          >
            <span className="text-2xl" aria-hidden>
              {a.icon}
            </span>
            <span className="text-xs font-bold leading-tight text-center">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
