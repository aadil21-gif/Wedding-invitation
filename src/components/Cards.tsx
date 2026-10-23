"use client";

import type { Card } from "@/lib/agent/types";
import { fmtDuration } from "@/lib/actions";

export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case "weather":
      return (
        <div className="panel p-3">
          <p className="hud-label">WEATHER · {card.place.toUpperCase()}</p>
          <p className="flex items-baseline gap-3">
            <span className="hud-big">{card.temp}°</span>
            <span className="text-lg capitalize">{card.summary}</span>
          </p>
          <p className="text-sm opacity-80">
            Feels {card.feels}° · Humidity {card.humidity}% · Wind {card.wind} km/h
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
            {card.days.map((d) => (
              <div key={d.label} className="hud-cell">
                <div className="hud-label">{d.label.toUpperCase()}</div>
                <div>
                  {d.min}° / {d.max}°
                </div>
                <div className="opacity-70">{d.rain}% rain</div>
              </div>
            ))}
          </div>
        </div>
      );
    case "prayer":
      return (
        <div className="panel p-3">
          <p className="hud-label">PRAYER TIMES · {card.city.toUpperCase()}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {Object.entries(card.times).map(([k, v]) => (
              <div key={k} className="hud-cell">
                <div className="hud-label">{k.toUpperCase()}</div>
                <div className="text-lg font-bold">{v}</div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs opacity-60">Karachi University method · {card.date}</p>
        </div>
      );
    case "currency":
      return (
        <div className="panel p-3">
          <p className="hud-label">EXCHANGE · INDICATIVE RATE</p>
          <p className="text-lg">
            {card.amount.toLocaleString()} {card.from} ={" "}
            <span className="hud-big">{card.result.toLocaleString()}</span> {card.to}
          </p>
          <p className="text-sm opacity-70">
            1 {card.from} = {card.rate} {card.to}
          </p>
        </div>
      );
    case "calc":
      return (
        <div className="panel p-3">
          <p className="hud-label">CALCULATION</p>
          <p className="opacity-80">{card.expression}</p>
          <p className="hud-big">= {card.result}</p>
        </div>
      );
    case "wiki":
      return (
        <div className="panel p-3">
          <p className="hud-label">KNOWLEDGE BASE · {card.title.toUpperCase()}</p>
          <p className="text-sm">{card.extract}</p>
          <a className="hud-link text-sm" href={card.url} target="_blank" rel="noreferrer">
            Wikipedia ↗
          </a>
        </div>
      );
    case "search":
      return (
        <div className="panel p-3">
          <p className="hud-label">WEB · {card.query.toUpperCase()}</p>
          <ul className="flex flex-col gap-2 text-sm">
            {card.results.map((r) => (
              <li key={r.url}>
                <a className="hud-link font-bold" href={r.url} target="_blank" rel="noreferrer">
                  {r.title} ↗
                </a>
                <div className="opacity-80">{r.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

/** A live countdown ring. `now` comes from the parent's one-second clock. */
export function TimerRing({
  label,
  endsAt,
  startedLen,
  now,
  onCancel,
}: {
  label: string;
  endsAt: number;
  startedLen: number;
  now: number;
  onCancel: () => void;
}) {
  const left = Math.max(0, (endsAt - now) / 1000);
  const frac = startedLen > 0 ? Math.min(1, left / startedLen) : 0;
  const C = 2 * Math.PI * 22;
  return (
    <div className="panel flex items-center gap-3 p-2 pr-3">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeOpacity="0.3" strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r="22"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
        />
      </svg>
      <div className="flex-1">
        <div className="hud-label">{label.toUpperCase()}</div>
        <div className="hud-big" style={{ fontSize: "1.5rem" }}>
          {fmtDuration(left)}
        </div>
      </div>
      <button type="button" onClick={onCancel} className="hud-chip rounded px-3 py-2 text-sm font-bold">
        Cancel
      </button>
    </div>
  );
}
