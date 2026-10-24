"use client";

import type { Action } from "./agent/types";
import { dance, moveFor, robotConnected, setFace, stopDriving } from "./robot";
import { dataOps } from "./store";

export interface LaunchLink {
  label: string;
  sub?: string;
  href: string;
}

export interface ActionOutcome {
  /** Short confirmations shown as status chips. */
  chips: string[];
  /** Buttons that leave the app (maps, phone, WhatsApp, music). Always user-tapped. */
  links: LaunchLink[];
  wantsCamera: boolean;
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Next occurrence of a local HH:MM, today or tomorrow. */
export function nextClockTime(hhmm: string, now = new Date()): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Runs the validated actions the assistant proposed. Anything that would
 * leave the app or contact someone becomes a button the user must tap:
 * a misheard number should never place a call on its own.
 */
export function executeActions(actions: Action[]): ActionOutcome {
  const out: ActionOutcome = { chips: [], links: [], wantsCamera: false };
  for (const a of actions) {
    switch (a.type) {
      case "timer":
        dataOps.addTimer(a.seconds, a.label);
        out.chips.push(`TIMER ${fmtDuration(a.seconds)} · ${a.label}`);
        break;
      case "reminder": {
        const at = a.at ? nextClockTime(a.at).getTime() : Date.now() + (a.inSeconds ?? 0) * 1000;
        dataOps.addReminder(at, a.text);
        out.chips.push(
          `REMINDER ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${a.text}`
        );
        break;
      }
      case "note":
        dataOps.addNote(a.text);
        out.chips.push("NOTE SAVED");
        break;
      case "list_add":
        dataOps.addToList(a.list, a.item);
        out.chips.push(`${a.list.toUpperCase()} + ${a.item}`);
        break;
      case "remember":
        dataOps.remember(a.fact);
        out.chips.push("MEMORY UPDATED");
        break;
      case "camera":
        out.wantsCamera = true;
        break;
      case "navigate":
        out.links.push({
          label: "OPEN MAPS",
          sub: `${a.destination} · ${a.mode}`,
          href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.destination)}&travelmode=${a.mode}`,
        });
        break;
      case "call":
        if (a.number) out.links.push({ label: "CALL", sub: a.number, href: `tel:${a.number}` });
        break;
      case "whatsapp": {
        if (!a.number) break;
        out.links.push({
          label: "OPEN WHATSAPP",
          sub: `${a.number}${a.text ? ` · "${a.text.slice(0, 40)}"` : ""}`,
          href: `https://wa.me/${a.number.replace(/\D/g, "")}${a.text ? `?text=${encodeURIComponent(a.text)}` : ""}`,
        });
        break;
      }
      case "music":
        out.links.push({
          label: "PLAY MUSIC",
          sub: a.query,
          href: `https://music.youtube.com/search?q=${encodeURIComponent(a.query)}`,
        });
        break;
      case "robot": {
        if (!robotConnected()) {
          out.chips.push("ROBOT NOT CONNECTED");
          break;
        }
        if (a.mood) setFace(a.mood);
        if (a.cmd === "stop") stopDriving();
        else if (a.cmd === "dance") dance();
        else if (a.cmd !== "face") moveFor(a.cmd, a.seconds);
        out.chips.push(`ROBOT · ${a.cmd.toUpperCase()}${a.cmd === "face" ? "" : a.cmd === "stop" || a.cmd === "dance" ? "" : ` ${a.seconds}s`}`);
        break;
      }
      case "open":
        out.links.push({ label: "OPEN LINK", sub: new URL(a.url).host, href: a.url });
        break;
    }
  }
  return out;
}
