import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AirportNotFoundError, ProviderError } from '../application/errors';
import { AgentError } from './errors';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './llmClient';
import { ToolCallingAgent } from './toolCallingAgent';
import { defineTool } from './tools/tool';

/** A model that plays back a fixed script and records what it was shown. */
function scripted(...steps: (LlmResponse | Error | ((request: LlmRequest) => LlmResponse))[]) {
  const seen: LlmRequest[] = [];
  const llm: LlmClient = {
    async chat(request) {
      seen.push({ ...request, messages: [...request.messages] });
      const step = steps[seen.length - 1];
      if (!step) throw new Error('script exhausted');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(request) : step;
    },
  };
  return { llm, seen };
}

const text = (content: string): LlmResponse => ({ content, toolCalls: [] });
const call = (name: string, args: unknown = {}): LlmResponse => ({ content: '', toolCalls: [{ name, arguments: args }] });

/** Any valid artifact will do: these tests are about the loop, not the artifact. */
const artifactFor = (code: string) => ({
  type: 'airport-profile' as const,
  airport: { code, name: 'n', city: 'c', state: 'CA' },
  period: { start: '2025-05', end: '2026-04' },
  previousPeriod: { start: '2024-05', end: '2025-04' },
  passengers: null,
  seats: null,
  departures: null,
  loadFactorPercent: null,
  passengerGrowthPercent: null,
  seatGrowthPercent: null,
  departureGrowthPercent: null,
  missing: [],
  assumptions: [],
  sources: [],
});

const echo = defineTool({
  name: 'echo',
  description: 'echoes text',
  input: z.object({ text: z.string().min(1) }),
  async execute({ text: value }) {
    return { result: { echoed: value }, artifacts: [artifactFor(value)] };
  },
});

const agentWith = (llm: LlmClient, tools = [echo], maxSteps = 4) => new ToolCallingAgent({ llm, tools: tools as never, maxSteps, deadlineMs: 5000 });
const user = (content: string) => ({ role: 'user' as const, content });

describe('ToolCallingAgent', () => {
  it('answers directly when the model calls no tool', async () => {
    const { llm, seen } = scripted(text('Hello.'));
    const response = await agentWith(llm).respond([user('hi')]);
    expect(response).toEqual({ message: 'Hello.', artifacts: [], meta: { toolCalls: [], warnings: [] } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.messages[0]).toMatchObject({ role: 'system' });
    expect(seen[0]?.tools.map((t) => t.name)).toEqual(['echo']);
  });

  it('runs one tool round, feeds the structured result back and returns the final answer with the artifacts', async () => {
    const { llm, seen } = scripted(call('echo', { text: 'abc' }), text('Done: abc'));
    const response = await agentWith(llm).respond([user('say abc')]);
    expect(response.message).toBe('Done: abc');
    expect(response.meta.toolCalls).toEqual(['echo']);
    expect(response.artifacts).toEqual([artifactFor('abc')]);
    const second = seen[1]?.messages ?? [];
    expect(second.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'echo', arguments: { text: 'abc' } }] });
    expect(second.at(-1)).toEqual({ role: 'tool', toolName: 'echo', content: JSON.stringify({ echoed: 'abc' }) });
  });

  it('supports several sequential tool rounds', async () => {
    const { llm, seen } = scripted(call('echo', { text: 'one' }), call('echo', { text: 'two' }), text('both'));
    const response = await agentWith(llm).respond([user('q')]);
    expect(response.meta.toolCalls).toEqual(['echo', 'echo']);
    expect(response.artifacts).toHaveLength(2);
    expect(seen).toHaveLength(3);
  });

  it('runs several tool calls from one step together and returns their results in order', async () => {
    const { llm, seen } = scripted({ content: '', toolCalls: [{ name: 'echo', arguments: { text: 'a' } }, { name: 'echo', arguments: { text: 'b' } }] }, text('ok'));
    await agentWith(llm).respond([user('q')]);
    const tools = (seen[1]?.messages ?? []).filter((m) => m.role === 'tool').map((m) => m.content);
    expect(tools).toEqual([JSON.stringify({ echoed: 'a' }), JSON.stringify({ echoed: 'b' })]);
  });

  it('preserves the conversation history sent by the client', async () => {
    const { llm, seen } = scripted(text('ok'));
    await agentWith(llm).respond([user('first'), { role: 'assistant', content: 'second' }, user('third')]);
    expect(seen[0]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
  });

  it('stops at the step limit with a safe message instead of looping', async () => {
    const { llm, seen } = scripted(call('echo', { text: 'x' }), call('echo', { text: 'y' }), call('echo', { text: 'z' }));
    const response = await agentWith(llm, [echo], 2).respond([user('q')]);
    expect(seen).toHaveLength(2);
    expect(response.message).toMatch(/could not finish/i);
    expect(response.meta.warnings).toContain('step-limit-reached');
    expect(response.artifacts).toHaveLength(2);
  });

  it('turns an unknown tool into a structured error the model can read', async () => {
    const { llm, seen } = scripted(call('rm_rf'), text('Sorry.'));
    const response = await agentWith(llm).respond([user('q')]);
    const toolMessage = seen[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({ role: 'tool', toolName: 'rm_rf' });
    expect(JSON.parse((toolMessage as { content: string }).content)).toEqual({ error: { kind: 'unknown-tool', message: expect.stringContaining('echo') } });
    expect(response.meta.warnings).toEqual(['rm_rf: unknown-tool']);
    expect(response.message).toBe('Sorry.');
  });

  it.each([
    ['missing field', {}],
    ['wrong type', { text: 5 }],
    ['not an object', 'text=abc'],
  ])('turns invalid arguments (%s) into a structured error and does not execute the tool', async (_label, args) => {
    const execute = vi.fn();
    const guarded = defineTool({ name: 'echo', description: '', input: z.object({ text: z.string().min(1) }), execute });
    const { llm, seen } = scripted(call('echo', args), text('ok'));
    const response = await agentWith(llm, [guarded as never]).respond([user('q')]);
    expect(execute).not.toHaveBeenCalled();
    const content = (seen[1]?.messages.at(-1) as { content: string }).content;
    expect(JSON.parse(content).error.kind).toBe('invalid-arguments');
    expect(response.meta.warnings).toEqual(['echo: invalid-arguments']);
  });

  it.each([
    [new AirportNotFoundError('ZZZ'), 'airport-not-found'],
    [new ProviderError('aerodatabox', 'rate-limited', 'HTTP 429 body: secret-token-abc', 429), 'rate-limited'],
    [new ProviderError('bts-socrata', 'network', 'boom https://data.bts.gov/?$$app_token=secret-token-abc'), 'provider-unavailable'],
    [new Error('stack: C:\\secret\\path'), 'internal-error'],
  ])('maps a tool exception to a safe structured error (%#)', async (thrown, kind) => {
    const failing = defineTool({ name: 'echo', description: '', input: z.object({}), execute: async () => { throw thrown; } });
    const { llm, seen } = scripted(call('echo'), text('ok'));
    await agentWith(llm, [failing as never]).respond([user('q')]);
    const content = (seen[1]?.messages.at(-1) as { content: string }).content;
    expect(JSON.parse(content).error.kind).toBe(kind);
    expect(content).not.toContain('secret');
  });

  it('refuses tool calls beyond the per-step cap without running them', async () => {
    const execute = vi.fn(async () => ({ result: {}, artifacts: [] }));
    const counted = defineTool({ name: 'echo', description: '', input: z.object({}), execute });
    const many = { content: '', toolCalls: Array.from({ length: 6 }, () => ({ name: 'echo', arguments: {} })) };
    await agentWith(scripted(many, text('ok')).llm, [counted as never]).respond([user('q')]);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('fails clearly when the model returns neither text nor a tool call', async () => {
    await expect(agentWith(scripted(text('  ')).llm).respond([user('q')])).rejects.toMatchObject({ kind: 'llm-invalid-response' });
  });

  it.each([
    ['timeout', 'llm-timeout'],
    ['aborted', 'llm-timeout'],
    ['rate-limited', 'llm-rate-limited'],
    ['unauthorized', 'llm-unavailable'],
    ['http-status', 'llm-unavailable'],
    ['network', 'llm-unavailable'],
    ['invalid-response', 'llm-invalid-response'],
  ] as const)('maps the model failure %s to AgentError %s', async (llmKind, agentKind) => {
    const failure = agentWith(scripted(new LlmError(llmKind, 'internal detail with sk-secret')).llm).respond([user('q')]);
    await expect(failure).rejects.toBeInstanceOf(AgentError);
    await expect(failure).rejects.toMatchObject({ kind: agentKind });
    await expect(failure).rejects.not.toThrow(/sk-secret/);
  });

  it('does not swallow unexpected errors from the model client', async () => {
    await expect(agentWith(scripted(new TypeError('bug')).llm).respond([user('q')])).rejects.toThrow('bug');
  });

  it('stops with a safe message, keeping gathered results, when the turn deadline passes during a tool', async () => {
    const slow = defineTool({
      name: 'echo',
      description: '',
      input: z.object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { result: {}, artifacts: [artifactFor('t')] };
      },
    });
    const { llm, seen } = scripted(call('echo'), text('too late'));
    const agent = new ToolCallingAgent({ llm, tools: [slow as never], maxSteps: 3, deadlineMs: 10 });
    const response = await agent.respond([user('q')]);
    expect(seen).toHaveLength(1);
    expect(response.meta.warnings).toContain('time-limit-reached');
    expect(response.artifacts).toHaveLength(1);
  });
});
