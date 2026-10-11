import type { z } from 'zod';
import { ProviderError } from '../../application/errors';
import type { DataSource } from '../../domain/provenance';

export type Fetch = typeof globalThis.fetch;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_CHARS = 200;
const MAX_REPORTED_ISSUES = 5;

interface JsonRequest {
  readonly source: DataSource;
  readonly url: URL;
  readonly fetch: Fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/**
 * GET a URL and return its parsed JSON body, or throw a ProviderError. One attempt only: no retries.
 * Request headers (which may carry credentials) are never copied into error messages.
 */
export async function getJson({ source, url, fetch, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }: JsonRequest): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ProviderError(
      source,
      timedOut ? 'timeout' : 'network',
      timedOut ? `request timed out after ${timeoutMs} ms` : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      { cause: error },
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS).trim();
    throw new ProviderError(
      source,
      response.status === 429 ? 'rate-limited' : 'http-status',
      `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new ProviderError(source, 'invalid-response', 'response body is not valid JSON', response.status, { cause: error });
  }
}

/** Validates an external payload at the provider boundary. Only the fields the schema names are read. */
export function parseResponse<S extends z.ZodType>(source: DataSource, schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(response)'}: ${i.message}`)
    .join('; ');
  throw new ProviderError(source, 'invalid-response', `unexpected ${what}: ${issues}`);
}
