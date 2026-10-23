"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  label: string;
  configured: boolean;
  missing: string[];
  dataPolicy: string;
  notes: string;
}

const STATUS_TEXT: Record<string, string> = {
  ok: "Working",
  no_key: "No key set",
  busy: "Overloaded right now",
  rate_limited: "Free limit reached for now",
  key_rejected: "Key rejected: check it in Vercel",
  error: "Request failed",
};

export function ProviderStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setRows(j.providers))
      .catch(() => setLoadError(true));
  }, []);

  async function test(id: string) {
    setResults((prev) => ({ ...prev, [id]: "Testing…" }));
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      setResults((prev) => ({ ...prev, [id]: STATUS_TEXT[json.status] ?? "Request failed" }));
    } catch {
      setResults((prev) => ({ ...prev, [id]: "Could not reach the server" }));
    }
  }

  return (
    <section aria-label="AI providers" className="flex flex-col gap-3">
      <h2 className="font-bold">AI providers</h2>
      <p className="text-sm opacity-80">
        SeeFar tries these in order and moves to the next when one is busy or out of free quota.
        Keys live in Vercel, never here.
      </p>
      {loadError && <p role="alert">Could not load provider status.</p>}
      <ul className="flex flex-col gap-2">
        {rows?.map((row) => (
          <li key={row.id} className="rounded-lg border-2 border-[var(--border)] p-3 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{row.label}</span>
              <span>{row.configured ? "Key set" : "Not set up"}</span>
            </div>
            {!row.configured && (
              <span className="text-sm">Add in Vercel: {row.missing.join(", ")}</span>
            )}
            <span className="text-sm opacity-80">{row.notes}</span>
            {row.dataPolicy === "may_train" && (
              <span className="text-sm opacity-80">Prompts may be used to train models.</span>
            )}
            {row.configured && (
              <div className="flex items-center gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => test(row.id)}
                  className="touch-target rounded-lg border-2 border-[var(--border)] px-3 font-bold"
                >
                  Test
                </button>
                <span aria-live="polite">{results[row.id]}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
