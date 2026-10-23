"use client";

import { FormEvent, useState } from "react";

interface ChatResult {
  text: string;
  providerId: string;
  modelId: string;
}

/**
 * M0's "hello" proof: type a question, get an answer from Gemini through
 * our own /api/chat route. Voice in/out, memory and tools are M1-M3.
 */
export function ChatDemo() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ChatResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="Ask SeeFar a question" className="flex flex-col gap-4 w-full max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="question" className="font-bold text-lg">
          Ask a question
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          className="rounded-lg border-2 border-[var(--border)] bg-transparent p-4 text-lg"
          placeholder="e.g. What is low vision?"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="touch-target rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] font-bold text-lg disabled:opacity-50"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-red-600 font-bold">
          {error}
        </p>
      )}

      {result && (
        <div
          role="status"
          className="rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <p className="text-lg">{result.text}</p>
          <p className="mt-2 text-sm opacity-70">
            Answered by {result.providerId} ({result.modelId})
          </p>
        </div>
      )}
    </section>
  );
}
