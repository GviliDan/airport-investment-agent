import type { Problem } from '@airport/shared';
import { getApiUrl } from './apiConfig';

// Slightly above the API's LLM timeout so the API gets to answer with its own error first.
const CHAT_TIMEOUT_MS = 90_000;

export interface UpstreamResponse {
  readonly status: number;
  readonly body: string;
  readonly requestId: string | undefined;
}

/** Forwards the raw chat body; validation and error semantics belong to the API. */
export async function forwardChat(body: string): Promise<UpstreamResponse> {
  try {
    const res = await fetch(`${getApiUrl()}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text(), requestId: res.headers.get('x-request-id') ?? undefined };
  } catch {
    const problem: Problem = { code: 'UPSTREAM_UNAVAILABLE', message: 'The analysis service is unavailable.' };
    return { status: 502, body: JSON.stringify(problem), requestId: undefined };
  }
}
