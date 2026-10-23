"use client";

import { MOODS } from "@/lib/robot";
import {
  beep,
  connectRobot,
  dance,
  disconnectRobot,
  drive,
  robotSupported,
  setFace,
  setLed,
  setSpeedCap,
  stopDriving,
  useRobot,
} from "@/lib/robot";

const PAD: { label: string; l: number; r: number; area: string }[] = [
  { label: "▲", l: 70, r: 70, area: "up" },
  { label: "◀", l: -60, r: 60, area: "left" },
  { label: "▶", l: 60, r: -60, area: "right" },
  { label: "▼", l: -60, r: -60, area: "down" },
];

const COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Cyan", rgb: [0, 200, 255] },
  { name: "Green", rgb: [0, 220, 90] },
  { name: "Amber", rgb: [255, 150, 0] },
  { name: "Pink", rgb: [255, 60, 190] },
  { name: "White", rgb: [200, 200, 200] },
];

export function RobotPanel() {
  const robot = useRobot();
  const on = robot.status === "on";
  const t = robot.telemetry;
  const supported = robotSupported();

  return (
    <section aria-label="Robot" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="hud-label">LINK · {on ? robot.name.toUpperCase() : robot.status.toUpperCase()}</p>
        {!supported && (
          <p role="alert" className="font-bold">
            Robot control needs Chrome on an Android phone (Web Bluetooth). It does not work on iPhone.
          </p>
        )}
        {robot.error && <p role="alert">{robot.error}</p>}
        {on ? (
          <button type="button" onClick={disconnectRobot} className="touch-target hud-chip rounded font-bold">
            DISCONNECT
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connectRobot()}
            disabled={!supported || robot.status === "connecting"}
            className="touch-target hud-cta font-bold disabled:opacity-50"
          >
            {robot.status === "connecting" ? "CONNECTING…" : "CONNECT TO ROBOT"}
          </button>
        )}
        <p className="text-sm opacity-70">
          Power the robot, then tap Connect and pick the device named “SeeFar…”. If it is not listed,
          check the robot&apos;s screen says it is waiting.
        </p>
      </div>

      {on && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="AHEAD" value={t?.distanceCm != null ? `${t.distanceCm} cm` : "clear"} />
            <Stat label="BATTERY" value={t?.battery != null ? `${t.battery}%` : "?"} />
            <Stat label="EDGE" value={t?.cliff ? "CLIFF!" : "ok"} warn={!!t?.cliff} />
            <Stat label="LIFTED" value={t?.lifted ? "YES" : "no"} warn={!!t?.lifted} />
          </div>

          <div className="flex flex-col items-center gap-2">
            <p className="hud-label">DRIVE · HOLD TO MOVE, RELEASE TO STOP</p>
            <div
              className="grid gap-2"
              style={{
                gridTemplateAreas: '". up ." "left stop right" ". down ."',
                gridTemplateColumns: "repeat(3, 76px)",
              }}
            >
              {PAD.map((b) => (
                <button
                  key={b.area}
                  type="button"
                  aria-label={b.area}
                  style={{ gridArea: b.area, height: 76, touchAction: "none" }}
                  className="hud-chip rounded text-3xl font-bold select-none"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drive(b.l, b.r);
                  }}
                  onPointerUp={stopDriving}
                  onPointerCancel={stopDriving}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {b.label}
                </button>
              ))}
              <button
                type="button"
                onClick={stopDriving}
                style={{ gridArea: "stop", height: 76, background: "#c1121f", color: "#fff", border: "2px solid #fff" }}
                className="rounded font-bold"
              >
                STOP
              </button>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="hud-label">SPEED LIMIT · {robot.speedCap}%</span>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={robot.speedCap}
              onChange={(e) => setSpeedCap(Number(e.target.value))}
            />
            <span className="text-sm opacity-70">Keep it low around children and pets. Start at 40–50%.</span>
          </label>

          <div className="flex flex-col gap-2">
            <p className="hud-label">FACE</p>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} type="button" onClick={() => setFace(m)} className="hud-chip rounded px-3 py-2 text-sm font-bold">
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="hud-label">LIGHTS AND SOUND</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c.name} type="button" onClick={() => setLed(...c.rgb)} className="hud-chip rounded px-3 py-2 text-sm font-bold">
                  {c.name}
                </button>
              ))}
              <button type="button" onClick={() => beep(2)} className="hud-chip rounded px-3 py-2 text-sm font-bold">
                CHIRP
              </button>
              <button type="button" onClick={() => dance()} className="hud-cta px-4 py-2 text-sm font-bold">
                DANCE
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="hud-cell text-center" style={warn ? { borderColor: "var(--accent-2)" } : undefined}>
      <div className="hud-label">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
