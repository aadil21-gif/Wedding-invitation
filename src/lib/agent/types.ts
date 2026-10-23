/** Things the assistant shows on screen as "holographic" cards. */
export type Card =
  | {
      type: "weather";
      place: string;
      temp: number;
      feels: number;
      humidity: number;
      wind: number;
      summary: string;
      days: { label: string; min: number; max: number; rain: number }[];
    }
  | { type: "prayer"; city: string; date: string; times: Record<string, string> }
  | { type: "currency"; from: string; to: string; amount: number; result: number; rate: number }
  | { type: "wiki"; title: string; extract: string; url: string }
  | { type: "calc"; expression: string; result: string }
  | { type: "search"; query: string; results: { title: string; url: string; snippet: string }[] };

/** Things the phone itself does. Validated on the server, executed in the browser. */
export type Action =
  | { type: "timer"; seconds: number; label: string }
  | { type: "reminder"; inSeconds?: number; at?: string; text: string }
  | { type: "navigate"; destination: string; mode: "driving" | "walking" | "transit" | "bicycling" }
  | { type: "call"; number: string }
  | { type: "whatsapp"; number: string; text: string }
  | { type: "music"; query: string }
  | { type: "note"; text: string }
  | { type: "list_add"; list: string; item: string }
  | { type: "remember"; fact: string }
  | { type: "camera" }
  | { type: "open"; url: string }
  | {
      type: "robot";
      cmd: "forward" | "back" | "left" | "right" | "spin" | "stop" | "dance" | "face";
      seconds: number;
      mood?: Mood;
    };

export type Mood =
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "sad"
  | "surprised"
  | "sleepy"
  | "love";

/** What the phone tells the server about itself each turn. */
export interface DeviceContext {
  nowIso: string;
  timeZone: string;
  lat?: number;
  lon?: number;
  facts: string[];
  lists: Record<string, string[]>;
  notes: string[];
  timers: { label: string; secondsLeft: number }[];
  reminders: { text: string; at: string }[];
  /** Present only when the robot body is connected. */
  robot?: { distanceCm: number | null; cliff: boolean; lifted: boolean };
}

export interface AgentReply {
  say: string;
  actions: Action[];
  cards: Card[];
  /** Facial expression for the on-screen face and the robot's own screen. */
  mood?: Mood;
}
