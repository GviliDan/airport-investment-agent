import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatResponseSchema, MAX_MESSAGES, MAX_TOTAL_CHARS } from '@airport/shared';
import type { ChatAgent } from '../agent/ports';
import { AgentError } from '../agent/errors';
import type { ProviderStatus } from './health';
import { createLogger } from './logger';
import { buildServer } from './server';

const allConfigured: ProviderStatus = { bts: 'configured', faa: 'configured', aerodatabox: 'configured' };

const answering: ChatAgent = {
  respond: async () => ({ message: 'ok', artifacts: [], meta: { toolCalls: [], warnings: [] } }),
};
const servers: Array<{ close(): void }> = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

interface Reply {
  statusCode: number;
  body: string;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: assertions read arbitrary fields
  json(): any;
}

/** Starts the real app on a free port and returns a small `inject`-style caller. */
const build = (agent: ChatAgent = answering, providers: ProviderStatus = allConfigured, llm: 'configured' | 'not-configured' = 'configured') => {
  const app = buildServer({ agent, providers, llm, log: createLogger('silent') });
  const server = app.listen(0);
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return {
    async inject(request: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<Reply> {
      const hasBody = request.payload !== undefined;
      const res = await fetch(`http://127.0.0.1:${port}${request.url}`, {
        method: request.method,
        headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...request.headers },
        ...(hasBody ? { body: typeof request.payload === 'string' ? request.payload : JSON.stringify(request.payload) } : {}),
      });
      const body = await res.text();
      return { statusCode: res.status, body, headers: res.headers, json: () => JSON.parse(body) };
    },
  };
};

const userMessage = (content: string) => ({ role: 'user', content });

describe('GET /health', () => {
  it('reports ok and the configured providers', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', providers: { bts: 'configured', faa: 'configured', aerodatabox: 'configured' }, llm: 'configured' });
  });

  it('reports AeroDataBox as not configured without failing', async () => {
    const res = await build(answering, { ...allConfigured, aerodatabox: 'not-configured' }, 'not-configured').inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().providers.aerodatabox).toBe('not-configured');
    expect(res.json().llm).toBe('not-configured');
  });
});

describe('POST /v1/chat', () => {
  it('returns a valid ChatResponse for a valid request', async () => {
    const res = await build().inject({ method: 'POST', url: '/v1/chat', payload: { messages: [userMessage('hi')] } });
    expect(res.statusCode).toBe(200);
    expect(ChatResponseSchema.safeParse(res.json()).success).toBe(true);
  });

  it('rejects an empty conversation with 400 and a request ID', async () => {
    const res = await build().inject({ method: 'POST', url: '/v1/chat', payload: { messages: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST', requestId: expect.any(String) });
    expect(res.headers.get('x-request-id')).toBe(res.json().requestId);
  });

  it('rejects more than the maximum number of messages with 400', async () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => userMessage('q'));
    const res = await build().inject({ method: 'POST', url: '/v1/chat', payload: { messages } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized conversation with 400', async () => {
    const payload = { messages: [userMessage('x'.repeat(MAX_TOTAL_CHARS + 1))] };
    const res = await build().inject({ method: 'POST', url: '/v1/chat', payload });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_REQUEST');
  });

  it('answers unexpected failures with a generic 500 that leaks nothing', async () => {
    const failing: ChatAgent = {
      respond: () => Promise.reject(new Error('secret database password is hunter2')),
    };
    const res = await build(failing).inject({ method: 'POST', url: '/v1/chat', payload: { messages: [userMessage('hi')] } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR', requestId: expect.any(String) });
  });
});

describe('model failures', () => {
  const failWith = (kind: ConstructorParameters<typeof AgentError>[0]): ChatAgent => ({
    respond: () => Promise.reject(new AgentError(kind, 'internal detail: token sk-secret')),
  });
  const chat = (agent: ChatAgent) => build(agent).inject({ method: 'POST', url: '/v1/chat', payload: { messages: [userMessage('hi')] } });

  it.each([
    ['not-configured', 503, 'CHAT_NOT_CONFIGURED'],
    ['llm-timeout', 504, 'LLM_TIMEOUT'],
    ['llm-rate-limited', 503, 'LLM_RATE_LIMITED'],
    ['llm-unavailable', 502, 'LLM_UNAVAILABLE'],
    ['llm-invalid-response', 502, 'LLM_INVALID_RESPONSE'],
  ] as const)('maps %s to a safe %i problem', async (kind, status, code) => {
    const res = await chat(failWith(kind));
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ code, requestId: expect.any(String) });
    expect(res.body).not.toContain('sk-secret');
  });
});

describe('unknown routes', () => {
  it('return a 404 problem', async () => {
    const res = await build().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
