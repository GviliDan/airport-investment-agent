import { describe, expect, it, vi } from 'vitest';
import { LlmError, type LlmRequest } from '../../../agent/llmClient';
import { OLLAMA_CLOUD_URL, OllamaLlmClient } from './ollamaLlmClient';

const SECRET = 'ollama-secret-key-123';
const reply = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const request: LlmRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ name: 'echo', description: 'echoes', parameters: { type: 'object', properties: { text: { type: 'string' } } } }],
};

function client(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return new OllamaLlmClient({ apiKey: SECRET, model: 'test-model', timeoutMs, fetch: fetchImpl });
}

describe('OllamaLlmClient', () => {
  it('sends the model, messages and tools to the cloud endpoint with a bearer key, non-streaming', async () => {
    const fetchMock = vi.fn(async () => reply({ message: { role: 'assistant', content: 'hello' } }));
    await client(fetchMock as unknown as typeof fetch).chat(request);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OLLAMA_CLOUD_URL);
    expect(OLLAMA_CLOUD_URL).toBe('https://ollama.com/api/chat');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'test-model', stream: false, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'echo' } }] });
    expect(init.body).not.toContain(SECRET);
  });

  it('returns assistant text', async () => {
    const result = await client((async () => reply({ message: { role: 'assistant', content: 'The answer.' } })) as typeof fetch).chat(request);
    expect(result).toEqual({ content: 'The answer.', toolCalls: [] });
  });

  it('returns one tool call with object arguments', async () => {
    const payload = { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { text: 'x' } } }] } };
    const result = await client((async () => reply(payload)) as typeof fetch).chat(request);
    expect(result.toolCalls).toEqual([{ name: 'echo', arguments: { text: 'x' } }]);
  });

  it('returns several tool calls in order', async () => {
    const payload = {
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: { n: 1 } } }, { function: { name: 'b', arguments: { n: 2 } } }] },
    };
    const result = await client((async () => reply(payload)) as typeof fetch).chat(request);
    expect(result.toolCalls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('parses string-encoded arguments and passes unparseable ones on for validation to reject', async () => {
    const payload = {
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: '{"n":1}' } }, { function: { name: 'b', arguments: '{oops' } }] },
    };
    const result = await client((async () => reply(payload)) as typeof fetch).chat(request);
    expect(result.toolCalls).toEqual([{ name: 'a', arguments: { n: 1 } }, { name: 'b', arguments: '{oops' }]);
  });

  it('echoes assistant tool calls and tool results back in the Ollama shape', async () => {
    const fetchMock = vi.fn(async () => reply({ message: { role: 'assistant', content: 'done' } }));
    await client(fetchMock as unknown as typeof fetch).chat({
      tools: [],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ name: 'echo', arguments: { text: 'x' } }] },
        { role: 'tool', toolName: 'echo', content: '{"ok":true}' },
      ],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools).toBeUndefined();
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { text: 'x' } } }] });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_name: 'echo', content: '{"ok":true}' });
  });

  it.each([
    [429, 'rate-limited'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, 'http-status'],
    [404, 'http-status'],
  ])('maps HTTP %i to %s without leaking the body or key', async (status, kind) => {
    const failing = (async () => new Response(`upstream said: key ${SECRET} is bad`, { status })) as typeof fetch;
    const error = await client(failing).chat(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe(kind);
    expect((error as LlmError).message).not.toContain(SECRET);
    expect((error as LlmError).message).not.toContain('upstream said');
  });

  it('times out', async () => {
    const hanging = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const error = await client(hanging, 20).chat(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'timeout' });
  });

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController();
    const hanging = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const pending = client(hanging, 5000).chat({ ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps a connection failure to network without echoing the cause', async () => {
    const error = await client((async () => { throw new TypeError(`connect failed for ${SECRET}`); }) as typeof fetch).chat(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('rejects a body that is not JSON', async () => {
    const error = await client((async () => new Response('<html>', { status: 200 })) as typeof fetch).chat(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'invalid-response' });
  });

  it.each([
    ['no message', {}],
    ['wrong role', { message: { role: 'user', content: 'x' } }],
    ['tool call without a name', { message: { role: 'assistant', content: '', tool_calls: [{ function: { arguments: {} } }] } }],
  ])('rejects a response with the wrong shape: %s', async (_label, payload) => {
    const error = await client((async () => reply(payload)) as typeof fetch).chat(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'invalid-response' });
  });

  it('returns an empty result (for the agent to judge) when the model sends neither text nor tool calls', async () => {
    const result = await client((async () => reply({ message: { role: 'assistant', content: '' } })) as typeof fetch).chat(request);
    expect(result).toEqual({ content: '', toolCalls: [] });
  });

  it('makes exactly one attempt on failure (no retries)', async () => {
    const fetchMock = vi.fn(async () => new Response('x', { status: 503 }));
    await client(fetchMock as unknown as typeof fetch).chat(request).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
