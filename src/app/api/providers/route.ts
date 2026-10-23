import { NextRequest, NextResponse } from "next/server";
import { COMPAT_PROVIDERS, FEATURE_PROVIDER_ORDER, PROVIDER_CONFIG } from "@/lib/ai/config";
import { buildProvider, reasonFor } from "@/lib/ai/registry";

export const maxDuration = 30;

interface Row {
  id: string;
  label: string;
  configured: boolean;
  missing: string[];
  dataPolicy: string;
  inChat: boolean;
  inVision: boolean;
  notes: string;
}

function rows(): Row[] {
  const out: Row[] = [];
  for (const cfg of Object.values(PROVIDER_CONFIG)) {
    const missing = cfg.envVars.filter((v) => !process.env[v]);
    out.push({
      id: cfg.id,
      label: cfg.label,
      configured: missing.length === 0,
      missing,
      dataPolicy: cfg.dataPolicy,
      inChat: FEATURE_PROVIDER_ORDER.chat.includes(cfg.id),
      inVision: FEATURE_PROVIDER_ORDER.vision.includes(cfg.id),
      notes: "Free tier content may be used by Google to improve its products.",
    });
  }
  for (const cfg of Object.values(COMPAT_PROVIDERS)) {
    const missing = cfg.envVars.filter((v) => !process.env[v]);
    out.push({
      id: cfg.id,
      label: cfg.label,
      configured: missing.length === 0,
      missing,
      dataPolicy: cfg.dataPolicy,
      inChat: FEATURE_PROVIDER_ORDER.chat.includes(cfg.id),
      inVision: FEATURE_PROVIDER_ORDER.vision.includes(cfg.id),
      notes: cfg.notes,
    });
  }
  return out;
}

/** Which providers have keys. Never returns key values, only variable names. */
export async function GET() {
  return NextResponse.json({ providers: rows() });
}

/** Sends one tiny request to one provider so a bad key shows up in Settings. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const provider = buildProvider(id);
  if (!provider) {
    return NextResponse.json({ id, ok: false, status: "no_key" });
  }
  try {
    const result = await provider.chat(
      { messages: [{ role: "user", content: "Reply with the single word: ready" }] },
      { deadline: Date.now() + 20_000 }
    );
    return NextResponse.json({ id, ok: true, status: "ok", modelId: result.modelId });
  } catch (err) {
    return NextResponse.json({ id, ok: false, status: reasonFor(err) });
  }
}
