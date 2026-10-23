import type { DataPolicy, ProviderCapabilities } from "./types";

/**
 * Model IDs and provider policy, kept in one file so nothing is hard-coded
 * elsewhere. Checked against each provider's own docs at build time —
 * sources and dates are recorded next to every entry. Re-verify before
 * assuming any of this is still current.
 */
export interface ProviderConfig {
  id: string;
  modelId: string;
  dataPolicy: DataPolicy;
  capabilities: ProviderCapabilities;
  /** Where this entry's modelId/dataPolicy/capabilities were confirmed. */
  source: string;
  verifiedOn: string;
}

export const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  gemini: {
    id: "gemini",
    // "Model code: gemini-3.8-flash", listed as the current stable,
    // vision-capable, free-tier model for new projects.
    modelId: "gemini-3.8-flash",
    // Free-tier pricing page: "Used to improve our products: Yes" for this
    // model. Paid tier would be no_train — this app never uses the paid tier.
    dataPolicy: "may_train",
    capabilities: {
      vision: true,
      streaming: true,
      toolCalling: true,
      jsonMode: true,
    },
    source: "https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
    verifiedOn: "2026-10-23",
  },
};

/**
 * Feature -> ordered provider fallback chain. M0 ships Gemini only; Groq,
 * OpenRouter and Anthropic adapters are added in M1/M3 and will be appended
 * here, never hard-coded into call sites.
 */
export const FEATURE_PROVIDER_ORDER: Record<string, string[]> = {
  vision: ["gemini"],
  chat: ["gemini"],
  // Health features must only use no_train providers unless the user opts
  // in via Settings — enforced in src/lib/ai/registry.ts, not here.
  health: [],
};
