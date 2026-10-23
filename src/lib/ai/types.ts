export type AIFeature = "vision" | "chat" | "health";

export type DataPolicy = "may_train" | "no_train";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Base64-encoded images (no data: prefix), vision-capable providers only. */
  images?: string[];
  /** Ask the provider to return JSON (used for tool-call fallback and structured answers). */
  json?: boolean;
  stream?: boolean;
}

export interface ChatResponse {
  text: string;
  /** Which provider actually answered, e.g. "gemini". Shown to the user on fallback. */
  providerId: string;
  /** Model id that answered, for debugging/README reference. */
  modelId: string;
}

export interface ProviderCapabilities {
  vision: boolean;
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
}

/**
 * One adapter per AI provider (Gemini, Groq, OpenRouter, Anthropic).
 * Implementations must throw RateLimitError on HTTP 429 so the registry
 * can fall back to the next provider in the chain.
 */
export interface AIProvider {
  id: string;
  dataPolicy: DataPolicy;
  capabilities: ProviderCapabilities;
  modelId: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class RateLimitError extends Error {
  constructor(providerId: string) {
    super(`${providerId} rate-limited (429)`);
    this.name = "RateLimitError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string, cause?: unknown) {
    super(`${providerId} unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ProviderUnavailableError";
  }
}
