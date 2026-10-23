import type { DataPolicy, ProviderCapabilities } from "./types";

/**
 * Provider and model policy, kept in one file so nothing is hard-coded
 * elsewhere. Sources and the date each entry was checked sit next to it.
 * Re-verify before trusting an old entry: terms, limits and model names
 * change, and several free tiers say so themselves.
 */

type Env = Record<string, string | undefined>;

export interface ProviderConfig {
  id: string;
  label: string;
  /** Environment variables that must all be set for this provider to run. */
  envVars: string[];
  /**
   * Models to try in order. When the first is overloaded (503) or rate
   * limited (429), the next one is tried on the same key.
   */
  modelIds: string[];
  dataPolicy: DataPolicy;
  capabilities: ProviderCapabilities;
  /** Where this entry's modelIds/dataPolicy/capabilities were confirmed. */
  source: string;
  verifiedOn: string;
}

export const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    envVars: ["GEMINI_API_KEY"],
    // All three are listed Stable on the models page and "Free of charge" on
    // the pricing page. Flash-Lite's image-input support is NOT stated in
    // the docs: check it before relying on it for vision.
    modelIds: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
    // Pricing page: "Used to improve our products: Yes" on the free tier.
    dataPolicy: "may_train",
    capabilities: { vision: true, streaming: true, toolCalling: true, jsonMode: true },
    source:
      "https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/models",
    verifiedOn: "2026-10-23",
  },
};

/**
 * Providers that speak the OpenAI "chat completions" protocol. Adding one
 * is one entry here plus a line in FEATURE_PROVIDER_ORDER: no new code.
 */
export interface CompatProviderConfig {
  id: string;
  label: string;
  /** Environment variables that must all be set. The first one is the API key. */
  envVars: string[];
  baseUrl: (env: Env) => string;
  /**
   * Model IDs to prefer, in order. Used only if the provider's own model
   * list (GET {baseUrl}/models) contains them, so a retired model is skipped
   * instead of failing every request.
   */
  preferredModels: string[];
  /** Env var that replaces the model list with one ID, for quick fixes. */
  modelOverrideEnv?: string;
  /**
   * "openai-list": use the provider's /models list, preferring preferredModels.
   * "openrouter-free": use only models OpenRouter prices at zero.
   * "none": no model list available; trust preferredModels.
   */
  discovery: "openai-list" | "openrouter-free" | "none";
  /**
   * "never": image requests are never sent here (support not verified).
   * "discovered": only models the provider says accept images are used.
   */
  vision: "never" | "discovered";
  extraHeaders?: Record<string, string>;
  dataPolicy: DataPolicy;
  /** What to know before relying on this one, shown in Settings. */
  notes: string;
  source: string;
  verifiedOn: string;
}

export const COMPAT_PROVIDERS: Record<string, CompatProviderConfig> = {
  groq: {
    id: "groq",
    label: "Groq",
    envVars: ["GROQ_API_KEY"],
    baseUrl: () => "https://api.groq.com/openai/v1",
    // From a third-party summary of Groq's free-plan limits (30 requests a
    // minute, 1,000 a day on each). The /models list confirms at runtime.
    preferredModels: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    modelOverrideEnv: "GROQ_MODEL",
    discovery: "openai-list",
    vision: "never",
    // Data policy not verified: treated as may_train until it is.
    dataPolicy: "may_train",
    notes: "Fast. About 30 requests a minute and 1,000 a day on the free plan (third-party summary; Groq's own page is the authority).",
    source: "https://console.groq.com/docs/openai (base URL); free limits from developersdigest.tech/rate-limits/groq",
    verifiedOn: "2026-10-23",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (free models)",
    envVars: ["OPENROUTER_API_KEY"],
    baseUrl: () => "https://openrouter.ai/api/v1",
    preferredModels: [],
    modelOverrideEnv: "OPENROUTER_MODEL",
    discovery: "openrouter-free",
    vision: "discovered",
    extraHeaders: { "X-OpenRouter-Title": "SeeFar" },
    // OpenRouter keeps separate training settings for free models and says
    // some providers it routes to may train on prompts.
    dataPolicy: "may_train",
    notes: "Many free models, picked automatically each time. Daily cap depends on credits you have bought. Some free models' hosts may train on prompts.",
    source: "https://openrouter.ai/docs/quickstart and https://openrouter.ai/docs/features/privacy-and-logging",
    verifiedOn: "2026-10-23",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    envVars: ["MISTRAL_API_KEY"],
    baseUrl: () => "https://api.mistral.ai/v1",
    preferredModels: ["mistral-small-latest"],
    modelOverrideEnv: "MISTRAL_MODEL",
    discovery: "openai-list",
    vision: "never",
    // Mistral says Experiment-plan requests may be used to train its models.
    dataPolicy: "may_train",
    notes: "Free Experiment plan needs a verified phone number, no card. Requests may be used to train Mistral's models.",
    source: "https://docs.mistral.ai/api and https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan",
    verifiedOn: "2026-10-23",
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    envVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    baseUrl: (env) =>
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID ?? ""}/ai/v1`,
    // The documented example model. Set CLOUDFLARE_MODEL to use a larger one.
    preferredModels: ["@cf/meta/llama-3.1-8b-instruct"],
    modelOverrideEnv: "CLOUDFLARE_MODEL",
    discovery: "none",
    vision: "never",
    dataPolicy: "may_train",
    notes: "Needs an account ID and an API token. Free allowance reported as 10,000 neurons a day (third-party list, unverified). Small default model.",
    source: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    verifiedOn: "2026-10-23",
  },
};

/**
 * Feature -> ordered provider fallback chain. Providers without a key are
 * skipped silently, so this list can name providers you have not set up.
 *
 * Not included on purpose:
 *  - GitHub Models: GitHub's docs say it was fully retired on 2026-07-30.
 *  - Cerebras: its API has no standing free tier (a one-time trial credit
 *    that needs a payment method). Its terms say it does not train on your
 *    content, which makes it the best future fit for health features.
 */
export const FEATURE_PROVIDER_ORDER: Record<string, string[]> = {
  // Only providers whose image support is confirmed at runtime appear here.
  vision: ["gemini", "openrouter"],
  chat: ["gemini", "groq", "openrouter", "mistral", "cloudflare"],
  // Health features must only use no_train providers unless the user opts
  // in via Settings, enforced in src/lib/ai/registry.ts, not here.
  health: [],
};
