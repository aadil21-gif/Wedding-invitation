"use client";

import { useEffect, useRef } from "react";
import { useSettings } from "./SettingsProvider";

export type OrbState = "standby" | "listening" | "thinking" | "speaking";

/**
 * The "arc reactor": rotating rings, tick marks, a radial waveform and a
 * glowing core, drawn on a canvas. State changes speed and amplitude; state
 * is also shown as a text label elsewhere, never by colour alone.
 */
export function HudCore({
  state,
  motion,
  kid,
  compact = false,
}: {
  state: OrbState;
  motion: boolean;
  kid: boolean;
  compact?: boolean;
}) {
  const size = 300; // drawing resolution; CSS scales it to fit the screen
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const { theme } = useSettings();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#00e5ff";
    const accent2 = css.getPropertyValue("--accent-2").trim() || "#ff9f1c";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = motion && !reduce;

    const c = size / 2;
    const R = size / 2 - 4;
    const BARS = 72;
    let t = 0;
    let level = 0;
    let raf = 0;

    const draw = () => {
      const s = stateRef.current;
      const speed = s === "thinking" ? 2.4 : s === "listening" ? 1 : s === "speaking" ? 1.2 : 0.35;
      t += 0.016 * speed;
      const target = s === "listening" ? 0.55 : s === "speaking" ? 0.85 : s === "thinking" ? 0.22 : 0.07;
      level += (target - level) * 0.08;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(c, c);

      // soft glow behind everything
      const glow = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
      glow.addColorStop(0, accent + "55");
      glow.addColorStop(0.55, accent + "14");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();

      // outer dashed ring
      ctx.save();
      ctx.rotate(t * 0.25);
      ctx.strokeStyle = accent + "99";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.98, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // tick ring
      ctx.save();
      ctx.rotate(-t * 0.18);
      ctx.strokeStyle = accent;
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        const long = i % 5 === 0;
        const r1 = R * 0.9;
        const r2 = r1 - (long ? 11 : 5);
        ctx.lineWidth = long ? 2 : 1;
        ctx.globalAlpha = long ? 0.95 : 0.45;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // three bright arcs
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = s === "thinking" ? accent2 : accent;
      for (let k = 0; k < 3; k++) {
        const start = t * (0.9 + k * 0.35) * (k % 2 ? -1 : 1) + (k * Math.PI * 2) / 3;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.76, start, start + 0.9);
        ctx.stroke();
      }
      ctx.restore();

      // thin inner ring + secondary accent ring
      ctx.strokeStyle = accent2;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.setLineDash([14, 6]);
      ctx.save();
      ctx.rotate(t * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // radial waveform
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        let amp = 3 + level * R * 0.16 * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.9 + t * 7) * Math.cos(i * 0.37 - t * 4)));
        let alpha = 0.55 + level * 0.45;
        if (s === "thinking") {
          // a bright sweep travelling round the ring
          const sweep = (t * 1.6) % (Math.PI * 2);
          const diff = Math.abs(((a + Math.PI / 2 - sweep + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          const near = Math.max(0, 1 - Math.abs(diff - Math.PI) / 0.9);
          amp += near * R * 0.1;
          alpha = 0.35 + near * 0.65;
        }
        const r1 = R * 0.47;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * (r1 + amp), Math.sin(a) * (r1 + amp));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // core
      const pulse = 1 + 0.05 * Math.sin(t * 3) + level * 0.12;
      const core = ctx.createRadialGradient(-R * 0.05, -R * 0.06, 2, 0, 0, R * 0.34 * pulse);
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.3, accent);
      core.addColorStop(1, accent + "00");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.34 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      if (animate) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
    // theme/kid change the CSS colour variables, so redraw from scratch.
  }, [motion, theme, kid]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="hud-core"
      style={{
        width: compact ? "min(46vw, 20dvh, 200px)" : "min(72vw, 32dvh, 300px)",
        height: compact ? "min(46vw, 20dvh, 200px)" : "min(72vw, 32dvh, 300px)",
      }}
    />
  );
}
