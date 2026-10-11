import { z } from 'zod';
import { ArtifactSchema, ChatResponseSchema, ProblemSchema, type Artifact, type ChatMessage } from '@airport/shared';

/** An artifact that failed validation or has an unknown type. It is shown as a placeholder, never guessed at. */
export interface UnsupportedArtifact {
  readonly type: 'unsupported';
  readonly originalType: string;
}
export type RenderableArtifact = Artifact | UnsupportedArtifact;

export interface AssistantReply {
  readonly message: string;
  readonly artifacts: RenderableArtifact[];
  readonly warnings: string[];
}

// The envelope is validated with the shared schema; artifacts are validated one by one so a single unknown or
// malformed artifact does not discard the whole answer.
const EnvelopeSchema = ChatResponseSchema.extend({ artifacts: z.array(z.unknown()) });

const GENERIC = 'Something went wrong while analyzing. Please try again.';
const BY_CODE: Record<string, string> = {
  CHAT_NOT_CONFIGURED: 'The assistant is not configured on this server.',
  LLM_TIMEOUT: 'The analysis took too long. Please try again, or ask a narrower question.',
  LLM_RATE_LIMITED: 'The assistant is busy right now. Please try again in a moment.',
  LLM_UNAVAILABLE: 'The assistant is temporarily unavailable. Please try again later.',
  LLM_INVALID_RESPONSE: 'The assistant returned an unusable answer. Please try again.',
  UPSTREAM_UNAVAILABLE: 'The analysis service is unavailable. Please try again later.',
  INVALID_REQUEST: 'That message could not be processed. Shorten it or start a new conversation.',
};

function describeFailure(status: number, body: unknown): string {
  const problem = ProblemSchema.safeParse(body);
  const mapped = problem.success ? BY_CODE[problem.data.code] : undefined;
  if (mapped) return mapped;
  if (status === 400 || status === 413 || status === 422) return BY_CODE['INVALID_REQUEST'] ?? GENERIC;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) return 'The analysis service is temporarily unavailable. Please try again later.';
  return GENERIC;
}

export function parseChatResponse(body: unknown): AssistantReply | null {
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  const artifacts = envelope.data.artifacts.map<RenderableArtifact>((raw) => {
    const parsed = ArtifactSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const type = typeof raw === 'object' && raw !== null && 'type' in raw ? String((raw as { type: unknown }).type) : 'unknown';
    return { type: 'unsupported', originalType: type };
  });
  return { message: envelope.data.message, artifacts, warnings: envelope.data.meta.warnings };
}

/** Posts the conversation. Failures throw an Error whose message is safe to show to the user. */
export async function sendChat(messages: readonly ChatMessage[]): Promise<AssistantReply> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error('Could not reach the analysis service. Check your connection and try again.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new Error('The service returned an unreadable response.');
  }
  if (!response.ok) throw new Error(describeFailure(response.status, body));

  const reply = parseChatResponse(body);
  if (!reply) throw new Error('The service returned an unexpected response, so nothing is shown.');
  return reply;
}
