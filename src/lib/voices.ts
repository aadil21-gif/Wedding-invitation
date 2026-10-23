import { CHARACTERS, type CharacterId } from "./characters";

/**
 * Voice styles for the AI voice. Shared: the client names a style, the server
 * looks up the voice and acting direction, so the client cannot inject text
 * into the voice prompt.
 */
export type VoiceStyleId =
  | "natural"
  | "robot"
  | "pierre"
  | "frslow"
  | CharacterId;

export interface VoiceSpec {
  voice: string;
  direction: string;
  robotFx: boolean;
  fallback: { pitch: number; rate: number };
}

export const VOICE_SPECS: Record<VoiceStyleId, VoiceSpec> = {
  natural: {
    voice: "Charon",
    direction: "Speak in a calm, clear, friendly, natural voice at a steady pace",
    robotFx: false,
    fallback: { pitch: 1, rate: 1 },
  },
  robot: {
    voice: "Algenib",
    direction: "Speak in a flat, precise, slightly mechanical voice like a calm ship's computer",
    robotFx: true,
    fallback: { pitch: 0.8, rate: 0.95 },
  },
  pierre: {
    voice: "Fenrir",
    direction:
      "Speak English with a strong, theatrical Parisian French accent, like a snobby but secretly caring French teacher who enjoys teasing. Pronounce every French word perfectly",
    robotFx: false,
    fallback: { pitch: 0.9, rate: 1 },
  },
  frslow: {
    voice: "Kore",
    direction:
      "Say this French phrase slowly and very clearly, with perfect native Parisian pronunciation, like a language teacher modelling it for a student",
    robotFx: false,
    fallback: { pitch: 1, rate: 0.75 },
  },
  zippy: pick("zippy"),
  pickle: pick("pickle"),
  luna: pick("luna"),
  hoot: pick("hoot"),
  roary: pick("roary"),
};

function pick(id: CharacterId): VoiceSpec {
  const c = CHARACTERS[id];
  return { voice: c.voice, direction: c.direction, robotFx: c.robotFx, fallback: c.fallback };
}

export function isVoiceStyle(v: unknown): v is VoiceStyleId {
  return typeof v === "string" && v in VOICE_SPECS;
}
