"use client";

import { PREF, useBoolPref, usePref } from "@/lib/prefs";
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
          {(["hud", "dark", "light"] as Theme[]).map((option) => (
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
              {option === "hud" ? "Sci-fi" : option}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold mb-1">Experience</legend>
        <Toggle label="Sounds" prefKey={PREF.sound} />
        <Toggle label="Animations" prefKey={PREF.motion} />
        <Toggle label="Speak answers aloud" prefKey={PREF.speak} />
        <Toggle label="Always listen for “Hey SeeFar”" prefKey={PREF.handsfree} def={false} />
        <p className="text-sm opacity-70">
          Only works while SeeFar is open with the screen on. It uses the mic continuously, drains
          battery, and Chrome on some phones beeps each time listening restarts.
        </p>
        <Toggle label="Share rough location (weather, nearby)" prefKey={PREF.loc} />
        <AlertsButton />
        <LanguagePick />
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

function Toggle({ label, prefKey, def = true }: { label: string; prefKey: string; def?: boolean }) {
  const [on, setOn] = useBoolPref(prefKey, def);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn(!on)}
      className="touch-target rounded-lg border-2 border-[var(--border)] px-4 font-bold flex justify-between items-center"
    >
      <span>{label}</span>
      <span>{on ? "On" : "Off"}</span>
    </button>
  );
}

function LanguagePick() {
  const [lang, setLang] = usePref(PREF.lang, "en");
  return (
    <div className="flex gap-3" role="group" aria-label="Voice language">
      {[
        ["en", "English"],
        ["ur", "اردو (Urdu)"],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={lang === value}
          onClick={() => setLang(value)}
          className={`touch-target flex-1 rounded-lg border-2 px-3 font-bold ${
            lang === value
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
              : "border-[var(--border)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AlertsButton() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={!supported}
        onClick={() => void Notification.requestPermission()}
        className="touch-target rounded-lg border-2 border-[var(--border)] px-4 font-bold"
      >
        Allow alert notifications
      </button>
      <p className="text-sm opacity-70">
        Timers and reminders always ring inside the app. Notifications help only while SeeFar is open
        in the background. For an alarm that must wake you, use the phone&apos;s Clock app.
      </p>
    </div>
  );
}
