import { NextRequest, NextResponse } from "next/server";
import { VOICE_SPECS, isVoiceStyle } from "@/lib/voices";

export const maxDuration = 30;

/** Free-tier Gemini TTS models, best first (checked on the Gemini pricing page, 2026-10-23). */
// Lite first: it answers faster, and a late voice was the main complaint.
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
const MAX_CHARS = 320;
const cache = new Map<string, string>();

/** Finds the first base64 audio payload anywhere in the response. */
function findAudio(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (o.type === "audio" && typeof o.data === "string") return o.data;
  for (const v of Object.values(o)) {
    const hit = findAudio(v);
    if (hit) return hit;
  }
  return null;
}

async function synth(model: string, key: string, prompt: string, voice: string): Promise<string> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const audio = findAudio(await res.json());
  if (!audio) throw new Error("no audio in response");
  return audio;
}

/** Text to speech with a Gemini AI voice. Returns WAV. The app falls back to the phone's voice on any error. */
export async function POST(request: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const raw: unknown = body?.style;
  const style = isVoiceStyle(raw) ? raw : "natural";
  const spec = VOICE_SPECS[style];

  const cacheKey = `${style}|${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return audioResponse(cached);

  // Only the words to speak: any instruction text sent here gets read out loud.
  const prompt = text;
  let lastErr: unknown;
  for (const model of TTS_MODELS) {
    try {
      const b64 = await synth(model, key, prompt, spec.voice);
      if (cache.size > 80) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, b64);
      return audioResponse(b64);
    } catch (err) {
      lastErr = err;
      console.error(`[tts] ${model} failed`, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ error: "tts_failed", detail: String(lastErr).slice(0, 120) }, { status: 502 });
}

/** The API documents WAV for unary calls; if it ever returns bare 24 kHz 16-bit mono PCM, add the header. */
function toWav(buf: Buffer): Buffer {
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") return buf;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buf.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(buf.length, 40);
  return Buffer.concat([header, buf]);
}

function audioResponse(b64: string) {
  return new NextResponse(new Uint8Array(toWav(Buffer.from(b64, "base64"))), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" },
  });
}
