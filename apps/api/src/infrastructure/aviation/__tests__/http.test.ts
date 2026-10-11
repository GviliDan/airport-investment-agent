import { describe, expect, it } from 'vitest';
import { getJson } from '../http';
import { expectProviderError, jsonResponse, mockFetch } from './support';

const url = new URL('https://example.gov/data.json');
const request = (fetch: Parameters<typeof getJson>[0]['fetch']) => getJson({ source: 'bts-socrata', url, fetch });

describe('getJson', () => {
  it('returns the parsed body of a successful response', async () => {
    const { fetch } = mockFetch(jsonResponse({ ok: true }));
    await expect(request(fetch)).resolves.toEqual({ ok: true });
  });

  it('sends the accept header and a timeout signal, plus any extra headers', async () => {
    const { fetch } = mockFetch(jsonResponse([]));
    await getJson({ source: 'aerodatabox', url, fetch, headers: { 'x-extra': '1' } });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ accept: 'application/json', 'x-extra': '1' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a non-success status with the status code and a short detail', async () => {
    const { fetch } = mockFetch(new Response('Service down', { status: 503 }));
    const error = await expectProviderError(request(fetch), { kind: 'http-status', status: 503 });
    expect(error.message).toContain('HTTP 503: Service down');
  });

  it('reports 429 as rate-limited', async () => {
    const { fetch } = mockFetch(new Response('slow down', { status: 429 }));
    await expectProviderError(request(fetch), { kind: 'rate-limited', status: 429 });
  });

  it('reports a timeout', async () => {
    const { fetch } = mockFetch(new DOMException('timed out', 'TimeoutError'));
    await expectProviderError(request(fetch), { kind: 'timeout' });
  });

  it('reports a network failure', async () => {
    const { fetch } = mockFetch(new TypeError('fetch failed'));
    await expectProviderError(request(fetch), { kind: 'network' });
  });

  it('reports a body that is not JSON', async () => {
    const { fetch } = mockFetch(new Response('<html>oops</html>', { status: 200 }));
    await expectProviderError(request(fetch), { kind: 'invalid-response' });
  });

  it('makes exactly one attempt', async () => {
    const { fetch } = mockFetch(new Response('boom', { status: 500 }), jsonResponse({ ok: true }));
    await expect(request(fetch)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
