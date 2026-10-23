"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "hud";
export type TextSize = "normal" | "large" | "x-large" | "xx-large";

const THEME_KEY = "seefar:theme";
const TEXT_SIZE_KEY = "seefar:text-size";

interface SettingsContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Settings live on <html>'s data-theme/data-text-size attributes, already
 * set pre-paint by NO_FLASH_SCRIPT (which also applies the system-theme
 * fallback) — so the attribute, not localStorage, is the single source of
 * truth. useSyncExternalStore reads it without the setState-in-effect
 * anti-pattern, and getServerSnapshot keeps SSR/hydration consistent.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readAttr<T extends string>(name: string, fallback: T): T {
  return (document.documentElement.getAttribute(name) as T | null) ?? fallback;
}

function writeAttr(name: string, value: string, storageKey: string) {
  document.documentElement.setAttribute(name, value);
  window.localStorage.setItem(storageKey, value);
  listeners.forEach((l) => l());
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribe,
    () => readAttr<Theme>("data-theme", "hud"),
    () => "hud" as Theme
  );
  const textSize = useSyncExternalStore(
    subscribe,
    () => readAttr<TextSize>("data-text-size", "normal"),
    () => "normal" as TextSize
  );

  const setTheme = useCallback((next: Theme) => writeAttr("data-theme", next, THEME_KEY), []);
  const setTextSize = useCallback(
    (next: TextSize) => writeAttr("data-text-size", next, TEXT_SIZE_KEY),
    []
  );

  return (
    <SettingsContext.Provider value={{ theme, setTheme, textSize, setTextSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

/** Inlined into <head> as a blocking script — see layout.tsx. */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem("${THEME_KEY}");
    if (!theme) theme = "hud";
    var size = localStorage.getItem("${TEXT_SIZE_KEY}") || "normal";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-text-size", size);
  } catch (e) {}
})();
`;
