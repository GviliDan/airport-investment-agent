/** A provider-independent view of a tool-calling chat model. The rest of the application depends on this, not on any vendor. */

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema object describing the arguments. */
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly name: string;
  /** Exactly what the model produced. It is untrusted and validated by the tool before use. */
  readonly arguments: unknown;
}

export type LlmMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly toolName: string; readonly content: string };

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly ToolDefinition[];
  /** Aborts the request; the client also enforces its own per-request timeout. */
  readonly signal?: AbortSignal;
}

export interface LlmResponse {
  /** Assistant text; may be empty when the model only calls tools. */
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
}

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind = 'timeout' | 'rate-limited' | 'unauthorized' | 'http-status' | 'network' | 'invalid-response' | 'aborted';

/** The model service failed. Messages never contain credentials or response bodies. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
