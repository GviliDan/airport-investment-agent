import { vi } from 'vitest';
import { ProviderError } from '../../../application/errors';
import { AirportCodeSchema } from '../../../domain/codes';
import { PeriodSchema } from '../../../domain/period';
import type { Fetch } from '../http';

export const code = (value: string) => AirportCodeSchema.parse(value);
export const period = (start: string, end: string) => PeriodSchema.parse({ start, end });

export const FIXED_NOW = () => new Date('2026-10-07T12:00:00.000Z');

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch stand-in that returns the given responses in order and records each request. */
export function mockFetch(...responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetch = vi.fn<Fetch>();
  fetch.mockImplementation(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const urls = (): URL[] => fetch.mock.calls.map(([url]) => new URL(String(url)));
  return { fetch, urls };
}

export async function expectProviderError(promise: Promise<unknown>, expected: { kind: ProviderError['kind']; status?: number }): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ProviderError)) throw new Error(`expected a ProviderError, got ${String(error)}`);
  if (error.kind !== expected.kind) throw new Error(`expected kind ${expected.kind}, got ${error.kind}: ${error.message}`);
  if (expected.status !== undefined && error.status !== expected.status) throw new Error(`expected status ${expected.status}, got ${String(error.status)}`);
  return error;
}
