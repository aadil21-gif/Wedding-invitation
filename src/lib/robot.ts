"use client";

import { useSyncExternalStore } from "react";

/**
 * Talks to the SeeFar robot body (an ESP32) over Bluetooth Low Energy using
 * the Web Bluetooth API. Works in Chrome on Android over HTTPS; it does not
 * work on iPhone. The wire protocol is short ASCII lines so it can also be
 * tested with a generic BLE terminal app (it uses the Nordic UART UUIDs).
 *
 *   to robot : M,<left>,<right>  S  F,<face>  L,<r>,<g>,<b>  B,<beep>  X,<cap>  P
 *   from robot: T,<cm>,<cliff>,<lifted>,<light>,<battery%>,<touch>   E,<event>
 */

const SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // app writes here
const TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // robot notifies here

export type Mood =
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "sad"
  | "surprised"
  | "sleepy"
  | "love";

export const MOODS: Mood[] = ["neutral", "happy", "excited", "curious", "sad", "surprised", "sleepy", "love"];
const FACE_INDEX: Record<Mood, number> = Object.fromEntries(MOODS.map((m, i) => [m, i])) as Record<Mood, number>;

export type RobotEvent = "near" | "cliff" | "lift" | "touch";

export interface Telemetry {
  distanceCm: number | null;
  cliff: boolean;
  lifted: boolean;
  light: number;
  battery: number | null;
  touch: boolean;
  at: number;
}

export interface RobotState {
  status: "off" | "connecting" | "on";
  name: string;
  error: string | null;
  telemetry: Telemetry | null;
  speedCap: number;
}

// Minimal Web Bluetooth typings (not part of TypeScript's DOM lib).
interface BleChar extends EventTarget {
  value?: DataView;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
  startNotifications(): Promise<BleChar>;
}
interface BleService {
  getCharacteristic(uuid: string): Promise<BleChar>;
}
interface BleServer {
  connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleService>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: BleServer;
}
interface BleApi {
  requestDevice(opts: {
    filters: { namePrefix?: string; services?: string[] }[];
    optionalServices: string[];
  }): Promise<BleDevice>;
}

const bluetooth = (): BleApi | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as unknown as { bluetooth?: BleApi }).bluetooth;

export function robotSupported(): boolean {
  return !!bluetooth();
}

const OFF: RobotState = { status: "off", name: "", error: null, telemetry: null, speedCap: 50 };
let state: RobotState = OFF;
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(e: RobotEvent) => void>();

function setState(patch: Partial<RobotState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
}

let device: BleDevice | null = null;
let rx: BleChar | null = null;
let queue: Promise<void> = Promise.resolve();
let driveTimer: ReturnType<typeof setInterval> | null = null;
let driveStop: ReturnType<typeof setTimeout> | null = null;

export function useRobot(): RobotState {
  return useSyncExternalStore(
    (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    () => state,
    () => OFF
  );
}

export function onRobotEvent(cb: (e: RobotEvent) => void): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}

export function robotConnected(): boolean {
  return state.status === "on";
}

function write(line: string): Promise<void> {
  const ch = rx;
  if (!ch) return Promise.resolve();
  const data = new TextEncoder().encode(line);
  // One write at a time: Web Bluetooth rejects overlapping GATT operations.
  queue = queue
    .then(() => (ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(data) : ch.writeValue(data)))
    .catch(() => {});
  return queue;
}

function parseTelemetry(line: string) {
  const p = line.split(",");
  if (p[0] === "T" && p.length >= 7) {
    const cm = Number(p[1]);
    setState({
      telemetry: {
        distanceCm: cm > 0 && cm < 400 ? cm : null,
        cliff: p[2] !== "0",
        lifted: p[3] !== "0",
        light: Number(p[4]) || 0,
        battery: Number(p[5]) >= 0 ? Number(p[5]) : null,
        touch: p[6] !== "0",
        at: Date.now(),
      },
    });
  } else if (p[0] === "E") {
    const e = p[1]?.trim() as RobotEvent;
    if (e === "near" || e === "cliff" || e === "lift" || e === "touch") eventListeners.forEach((l) => l(e));
  }
}

export async function connectRobot(): Promise<void> {
  const api = bluetooth();
  if (!api) {
    setState({ error: "Bluetooth control needs Chrome on Android." });
    return;
  }
  setState({ status: "connecting", error: null });
  try {
    device = await api.requestDevice({
      filters: [{ namePrefix: "SeeFar" }],
      optionalServices: [SERVICE],
    });
    device.addEventListener("gattserverdisconnected", () => {
      stopDriving();
      rx = null;
      setState({ status: "off", telemetry: null });
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE);
    rx = await service.getCharacteristic(RX);
    setState({ status: "on", name: device.name ?? "SeeFar robot" });

    // Telemetry is nice to have: control still works if notifications fail.
    try {
      const tx = await service.getCharacteristic(TX);
      await tx.startNotifications();
      let buffer = "";
      tx.addEventListener("characteristicvaluechanged", (ev) => {
        const value = (ev.target as unknown as BleChar).value;
        if (!value) return;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach((l) => parseTelemetry(l.trim()));
      });
    } catch {
      setState({ error: "Connected, but sensor readings are unavailable." });
    }

    await write(`X,${state.speedCap}\n`);
    await write("F,1\n");
  } catch (e) {
    const msg = (e as Error).name === "NotFoundError" ? null : "Could not connect to the robot.";
    setState({ status: "off", error: msg });
  }
}

export function disconnectRobot() {
  stopDriving();
  device?.gatt?.disconnect();
}

export function setSpeedCap(cap: number) {
  const c = Math.max(20, Math.min(100, Math.round(cap)));
  setState({ speedCap: c });
  void write(`X,${c}\n`);
}

/** Starts driving. The robot stops itself if it stops hearing from us (watchdog), so we repeat. */
export function drive(left: number, right: number) {
  if (!robotConnected()) return;
  const l = Math.max(-100, Math.min(100, Math.round(left)));
  const r = Math.max(-100, Math.min(100, Math.round(right)));
  if (driveTimer) clearInterval(driveTimer);
  void write(`M,${l},${r}\n`);
  driveTimer = setInterval(() => void write(`M,${l},${r}\n`), 250);
}

export function stopDriving() {
  if (driveTimer) clearInterval(driveTimer);
  if (driveStop) clearTimeout(driveStop);
  driveTimer = null;
  driveStop = null;
  void write("S\n");
}

const MOVES: Record<string, [number, number]> = {
  forward: [70, 70],
  back: [-60, -60],
  left: [-60, 60],
  right: [60, -60],
  spin: [70, -70],
};

/** Voice-commanded move: capped at 3 s, then stops. Returns false if not connected. */
export function moveFor(cmd: keyof typeof MOVES, seconds: number): boolean {
  if (!robotConnected()) return false;
  const [l, r] = MOVES[cmd];
  drive(l, r);
  if (driveStop) clearTimeout(driveStop);
  driveStop = setTimeout(stopDriving, Math.max(0.3, Math.min(3, seconds)) * 1000);
  return true;
}

export function dance(): boolean {
  if (!robotConnected()) return false;
  const steps: [number, number, number][] = [
    [70, -70, 500],
    [-70, 70, 500],
    [60, 60, 300],
    [-60, -60, 300],
    [70, -70, 900],
  ];
  setFace("excited");
  let at = 0;
  for (const [l, r, ms] of steps) {
    setTimeout(() => drive(l, r), at);
    at += ms;
  }
  setTimeout(() => {
    stopDriving();
    setFace("happy");
  }, at);
  return true;
}

export function setFace(mood: Mood) {
  if (robotConnected()) void write(`F,${FACE_INDEX[mood]}\n`);
}

export function setLed(r: number, g: number, b: number) {
  if (robotConnected()) void write(`L,${r | 0},${g | 0},${b | 0}\n`);
}

export function beep(pattern: 1 | 2 | 3 | 4) {
  if (robotConnected()) void write(`B,${pattern}\n`);
}
