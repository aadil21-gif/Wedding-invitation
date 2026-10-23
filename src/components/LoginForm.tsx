"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Wrong passcode.");
        return;
      }

      const next = searchParams.get("next") ?? "/";
      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <label htmlFor="passcode" className="font-bold text-lg">
        Enter passcode
      </label>
      <input
        id="passcode"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        className="touch-target rounded-lg border-2 border-[var(--border)] bg-transparent px-4 text-lg"
        aria-describedby={error ? "passcode-error" : undefined}
        autoFocus
      />
      {error && (
        <p id="passcode-error" role="alert" className="text-red-600 font-bold">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || passcode.length === 0}
        className="touch-target rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] font-bold text-lg disabled:opacity-50"
      >
        {submitting ? "Checking…" : "Unlock SeeFar"}
      </button>
    </form>
  );
}
