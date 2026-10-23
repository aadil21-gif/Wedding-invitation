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

export interface ChatOptions {
  /**
   * Epoch milliseconds after which the provider must stop trying. The route
   * has a hard time limit, so every adapter checks this between attempts.
   */
  deadline?: number;
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
 * One adapter per AI provider. Implementations throw RateLimitError when the
 * provider says 429, and ProviderUnavailableError for everything else, so the
 * registry can fall back to the next provider in the chain.
 */
export interface AIProvider {
  id: string;
  label: string;
  dataPolicy: DataPolicy;
  capabilities: ProviderCapabilities;
  modelId: string;
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
}

export class RateLimitError extends Error {
  constructor(providerId: string) {
    super(`${providerId} rate-limited (429)`);
    this.name = "RateLimitError";
  }
}

export type UnavailableReason = "no_key" | "busy" | "rate_limited" | "key_rejected" | "error";

export class ProviderUnavailableError extends Error {
  /** HTTP status from the provider, when it gave one. */
  readonly status?: number;

  constructor(providerId: string, cause?: unknown, status?: number) {
    super(`${providerId} unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ProviderUnavailableError";
    this.status = status;
  }
}
