import type { LlmError } from './llmClient';

export type AgentErrorKind = 'not-configured' | 'llm-timeout' | 'llm-rate-limited' | 'llm-unavailable' | 'llm-invalid-response';

/** The agent could not produce an answer for a reason outside the user's control. The HTTP layer maps it to a safe response. */
export class AgentError extends Error {
  constructor(
    readonly kind: AgentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export function agentErrorFrom(error: LlmError): AgentError {
  switch (error.kind) {
    case 'timeout':
    case 'aborted':
      return new AgentError('llm-timeout', 'The language model took too long to answer.');
    case 'rate-limited':
      return new AgentError('llm-rate-limited', 'The language model service is rate limiting requests.');
    case 'invalid-response':
      return new AgentError('llm-invalid-response', 'The language model returned an unusable response.');
    default:
      return new AgentError('llm-unavailable', 'The language model service is unavailable.');
  }
}
