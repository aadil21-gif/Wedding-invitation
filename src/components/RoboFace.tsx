"use client";

import { useEffect, useRef } from "react";
import type { Mood } from "@/lib/agent/types";
import type { OrbState } from "./HudCore";
import { useSettings } from "./SettingsProvider";

/**
 * An animated cartoon robot face (blinking eyes, talking mouth, moods) drawn
 * on a canvas. The physical robot's small screen shows the same set of moods.
 */
export function RoboFace({
  state,
  mood,
  motion,
  kid,
  compact = false,
}: {
  state: OrbState;
  mood: Mood;
  motion: boolean;
  kid: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, mood });
  const { theme } = useSettings();

  useEffect(() => {
    live.current = { state, mood };
  }, [state, mood]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = 320;
    const H = 260;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#00e5ff";
    const accent2 = css.getPropertyValue("--accent-2").trim() || "#ff9f1c";
    const bg = css.getPropertyValue("--background").trim() || "#02060f";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = motion && !reduce;

    let t = 0;
    let raf = 0;
    let blinkAt = 2;
    let blink = 0;
    let lookX = 0;
    let lookTarget = 0;
    let lookAt = 3;

    const heart = (x: number, y: number, s: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.35);
      ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.2, y - s * 0.9, x, y - s * 0.3);
      ctx.bezierCurveTo(x + s * 0.2, y - s * 0.9, x + s, y - s * 0.4, x, y + s * 0.35);
      ctx.fill();
    };

    const draw = () => {
      const { state: st, mood: md0 } = live.current;
      // the face reacts to what the assistant is doing, unless a mood was set
      const md: Mood = st === "listening" && md0 === "neutral" ? "curious" : md0;
      t += 0.016;
      if (t > blinkAt) {
        blink = 1;
        blinkAt = t + 2 + Math.random() * 3;
      }
      blink = Math.max(0, blink - 0.12);
      if (t > lookAt) {
        lookTarget = (Math.random() - 0.5) * 22;
        lookAt = t + 1.5 + Math.random() * 2.5;
      }
      lookX += (lookTarget - lookX) * 0.08;
      if (st === "thinking") lookX += (18 - lookX) * 0.1;

      ctx.clearRect(0, 0, W, H);

      // head
      ctx.fillStyle = bg;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(24, 34, W - 48, H - 50, 46);
      ctx.fill();
      ctx.stroke();

      // antenna with a light that pulses while listening
      ctx.beginPath();
      ctx.moveTo(W / 2, 34);
      ctx.lineTo(W / 2, 12);
      ctx.stroke();
      ctx.fillStyle = st === "listening" || st === "speaking" ? accent2 : accent;
      ctx.globalAlpha = st === "standby" ? 0.7 : 0.6 + 0.4 * Math.sin(t * 8);
      ctx.beginPath();
      ctx.arc(W / 2, 10, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // ears
      ctx.fillStyle = accent;
      ctx.fillRect(10, 110, 14, 50);
      ctx.fillRect(W - 24, 110, 14, 50);

      const ex = [W / 2 - 62 + lookX, W / 2 + 62 + lookX];
      const ey = 120;
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";

      const lid = 1 - blink * 0.92;
      const eye = (x: number, h = 46, w = 40) => {
        ctx.beginPath();
        ctx.roundRect(x - w / 2, ey - (h * lid) / 2, w, Math.max(4, h * lid), 16);
        ctx.fill();
      };
      const arc = (x: number, up: boolean) => {
        ctx.beginPath();
        ctx.arc(x, ey + (up ? 14 : -4), 22, up ? Math.PI * 1.1 : Math.PI * 0.1, up ? Math.PI * 1.9 : Math.PI * 0.9);
        ctx.stroke();
      };

      switch (md) {
        case "happy":
          ex.forEach((x) => arc(x, true));
          break;
        case "excited":
          ex.forEach((x) => eye(x, 58, 48));
          ctx.fillStyle = bg;
          ex.forEach((x) => {
            ctx.beginPath();
            ctx.arc(x + 6, ey - 8, 9, 0, Math.PI * 2);
            ctx.fill();
          });
          break;
        case "curious":
          eye(ex[0], 38, 34);
          eye(ex[1], 60, 46);
          break;
        case "sad":
          ex.forEach((x) => eye(x, 38, 36));
          ctx.strokeStyle = accent2;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(ex[0] - 22, ey - 40);
          ctx.lineTo(ex[0] + 18, ey - 28);
          ctx.moveTo(ex[1] + 22, ey - 40);
          ctx.lineTo(ex[1] - 18, ey - 28);
          ctx.stroke();
          break;
        case "surprised":
          ctx.lineWidth = 7;
          ex.forEach((x) => {
            ctx.beginPath();
            ctx.arc(x, ey, 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, ey, 8, 0, Math.PI * 2);
            ctx.fill();
          });
          break;
        case "sleepy":
          ctx.lineWidth = 8;
          ex.forEach((x) => {
            ctx.beginPath();
            ctx.moveTo(x - 22, ey);
            ctx.lineTo(x + 22, ey);
            ctx.stroke();
          });
          ctx.fillStyle = accent2;
          ctx.font = "bold 22px sans-serif";
          ctx.fillText("z", W - 70, 70 + Math.sin(t * 2) * 4);
          ctx.fillText("Z", W - 52, 54 + Math.sin(t * 2 + 1) * 4);
          break;
        case "love":
          ctx.fillStyle = accent2;
          ex.forEach((x) => heart(x, ey, 34 + Math.sin(t * 6) * 3));
          break;
        default:
          ex.forEach((x) => eye(x));
      }

      // cheeks
      if (md === "happy" || md === "love" || md === "excited") {
        ctx.fillStyle = accent2;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.ellipse(W / 2 - 100, 170, 16, 9, 0, 0, Math.PI * 2);
        ctx.ellipse(W / 2 + 100, 170, 16, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // mouth
      const my = 202;
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 8;
      if (st === "speaking") {
        const open = 8 + Math.abs(Math.sin(t * 13)) * 22;
        ctx.beginPath();
        ctx.ellipse(W / 2, my, 34, open / 2 + 4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (st === "thinking") {
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 6 - i));
          ctx.beginPath();
          ctx.arc(W / 2 - 24 + i * 24, my, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (md === "surprised") {
        ctx.beginPath();
        ctx.ellipse(W / 2, my, 16, 20, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (md === "sad") {
        ctx.beginPath();
        ctx.arc(W / 2, my + 22, 34, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (md === "sleepy" || md === "neutral") {
        ctx.beginPath();
        ctx.moveTo(W / 2 - 22, my);
        ctx.lineTo(W / 2 + 22, my);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(W / 2, my - 18, 40, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }

      if (animate) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [motion, theme, kid]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="hud-core"
      style={{
        width: compact ? "min(50vw, 20dvh, 210px)" : "min(78vw, 34dvh, 320px)",
        aspectRatio: "320 / 260",
      }}
    />
  );
}
