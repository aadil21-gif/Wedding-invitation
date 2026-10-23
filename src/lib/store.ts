"use client";

import { useSyncExternalStore } from "react";

/**
 * Everything the assistant remembers lives in this phone's localStorage:
 * notes, lists, facts, timers and reminders. Nothing is stored on the server.
 * (Facts, lists and notes ARE sent to the AI provider each turn so the
 * assistant can use them; see Settings.)
 */
export interface DataStore {
  notes: { id: string; text: string; at: number }[];
  lists: Record<string, string[]>;
  facts: string[];
  reminders: { id: string; at: number; text: string; fired: boolean }[];
  timers: { id: string; endsAt: number; len: number; label: string; fired: boolean }[];
}

const KEY = "seefar:data:v1";
const EMPTY: DataStore = { notes: [], lists: {}, facts: [], reminders: [], timers: [] };

const listeners = new Set<() => void>();
let cacheRaw: string | null = null;
let cacheValue: DataStore = EMPTY;

function read(): DataStore {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cacheValue;
  }
  if (raw === cacheRaw) return cacheValue;
  cacheRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    cacheValue = { ...EMPTY, ...parsed };
  } catch {
    cacheValue = EMPTY;
  }
  return cacheValue;
}

function write(next: DataStore) {
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Storage blocked: keep it in memory for this session only.
  }
  cacheRaw = raw;
  cacheValue = next;
  listeners.forEach((l) => l());
}

export function useData(): DataStore {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY
  );
}

export function getData(): DataStore {
  return read();
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const dataOps = {
  addNote(text: string) {
    const d = read();
    write({ ...d, notes: [{ id: uid(), text, at: Date.now() }, ...d.notes].slice(0, 50) });
  },
  deleteNote(id: string) {
    const d = read();
    write({ ...d, notes: d.notes.filter((n) => n.id !== id) });
  },
  addToList(list: string, item: string) {
    const d = read();
    const existing = d.lists[list] ?? [];
    if (existing.some((x) => x.toLowerCase() === item.toLowerCase())) return;
    write({ ...d, lists: { ...d.lists, [list]: [...existing, item].slice(0, 50) } });
  },
  removeFromList(list: string, item: string) {
    const d = read();
    const next = (d.lists[list] ?? []).filter((x) => x !== item);
    const lists = { ...d.lists, [list]: next };
    if (next.length === 0) delete lists[list];
    write({ ...d, lists });
  },
  remember(fact: string) {
    const d = read();
    if (d.facts.some((f) => f.toLowerCase() === fact.toLowerCase())) return;
    write({ ...d, facts: [...d.facts, fact].slice(-30) });
  },
  forget(fact: string) {
    const d = read();
    write({ ...d, facts: d.facts.filter((f) => f !== fact) });
  },
  addTimer(seconds: number, label: string) {
    const d = read();
    write({
      ...d,
      timers: [
        ...d.timers,
        { id: uid(), endsAt: Date.now() + seconds * 1000, len: seconds, label, fired: false },
      ].slice(-10),
    });
  },
  addReminder(at: number, text: string) {
    const d = read();
    write({ ...d, reminders: [...d.reminders, { id: uid(), at, text, fired: false }].slice(-30) });
  },
  markFired(kind: "timers" | "reminders", id: string) {
    const d = read();
    write({ ...d, [kind]: d[kind].map((x) => (x.id === id ? { ...x, fired: true } : x)) });
  },
  cancelTimer(id: string) {
    const d = read();
    write({ ...d, timers: d.timers.filter((t) => t.id !== id) });
  },
  prune() {
    // Drop things that already went off more than a day ago.
    const d = read();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    write({
      ...d,
      timers: d.timers.filter((t) => !t.fired || t.endsAt > cutoff),
      reminders: d.reminders.filter((r) => !r.fired || r.at > cutoff),
    });
  },
  clearAll() {
    write(EMPTY);
  },
};
