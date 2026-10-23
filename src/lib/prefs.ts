"use client";

import { useCallback, useSyncExternalStore } from "react";

/** localStorage keys for per-device preferences. */
export const PREF = {
  sound: "seefar:sound",
  motion: "seefar:motion",
  speak: "seefar:speak",
  lang: "seefar:lang",
  kid: "seefar:kid",
  pin: "seefar:parent-pin",
} as const;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference just won't persist.
  }
  listeners.forEach((l) => l());
}

export function removePref(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function usePref(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readPref(key, fallback),
    () => fallback
  );
  const set = useCallback((next: string) => writePref(key, next), [key]);
  return [value, set];
}

export function useBoolPref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, set] = usePref(key, fallback ? "1" : "0");
  return [value === "1", (next: boolean) => set(next ? "1" : "0")];
}
