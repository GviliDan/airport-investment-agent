import type { ChatMessage, ChatResponse } from '@airport/shared';

/** The slice of a logger the agent needs. The HTTP layer's logger satisfies it. */
export interface AgentLog {
  info(obj: Record<string, unknown>, message: string): void;
  warn(obj: Record<string, unknown>, message: string): void;
}

/**
 * What the HTTP layer needs from the agent. The route depends on this seam only. The agent throws
 * AgentError for model-service failures and never returns provider details.
 */
export interface ChatAgent {
  respond(messages: readonly ChatMessage[], log?: AgentLog): Promise<ChatResponse>;
}
