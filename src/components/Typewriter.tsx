"use client";

import { useEffect, useState } from "react";

/** Reveals text like a terminal. Skips straight to the end if animations are off. */
export function Typewriter({
  text,
  instant,
  onTick,
}: {
  text: string;
  instant: boolean;
  onTick?: () => void;
}) {
  const [count, setCount] = useState(0);
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = instant || reduce;

  useEffect(() => {
    if (show) return;
    const step = Math.max(1, Math.ceil(text.length / 160));
    const id = setInterval(() => {
      setCount((c) => {
        const next = Math.min(text.length, c + step);
        if (next >= text.length) clearInterval(id);
        return next;
      });
      onTick?.();
    }, 18);
    return () => clearInterval(id);
  }, [text, show, onTick]);

  return <>{show ? text : text.slice(0, count)}</>;
}
