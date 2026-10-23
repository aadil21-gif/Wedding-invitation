"use client";

import { ProviderStatus } from "./ProviderStatus";
import { TextSize, Theme, useSettings } from "./SettingsProvider";

const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "x-large", label: "X-Large" },
  { value: "xx-large", label: "Very large" },
];

export function SettingsPanel() {
  const { theme, setTheme, textSize, setTextSize } = useSettings();

  return (
    <section aria-label="Display settings" className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold mb-1">Theme</legend>
        <div className="flex gap-3">
          {(["light", "dark"] as Theme[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
              className={`touch-target flex-1 rounded-lg border-2 px-4 font-bold capitalize ${
                theme === option
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold mb-1">Text size</legend>
        <div className="grid grid-cols-2 gap-3">
          {TEXT_SIZES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={textSize === option.value}
              onClick={() => setTextSize(option.value)}
              className={`touch-target rounded-lg border-2 px-3 font-bold ${
                textSize === option.value
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <ProviderStatus />
    </section>
  );
}
