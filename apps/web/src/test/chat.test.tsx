import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_PROMPTS } from '../components/Chat';
import { parseChatResponse } from '../lib/chatClient';
import { conversationBudget } from '../lib/conversation';
import { formatMinutes, formatPeriod, formatPercent, formatWithUnit } from '../lib/format';
import { parseProse } from '../components/Prose';
import { chatBody, demandPressure, PRESSURE, ranking } from './fixtures';
import { renderChat } from './renderChat';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const type = (text: string) => fireEvent.change(screen.getByLabelText('Your question'), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }));

describe('chat', () => {
  it('shows starter prompts that fill the composer without sending', () => {
    renderChat();
    fireEvent.click(screen.getByRole('button', { name: STARTER_PROMPTS[1] }));
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe(STARTER_PROMPTS[1]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the question, shows prose and artifacts, and keeps only message text as history', async () => {
    fetchMock.mockImplementation(() => json(chatBody([demandPressure()], 'SFO shows **elevated** pressure.')));
    renderChat();
    type('What is the unmet demand pressure at SFO?');
    send();
    expect(await screen.findByText('Analyzing airport data…')).toBeTruthy();
    expect(await screen.findByText('57.6')).toBeTruthy();
    expect(screen.getByText('elevated').tagName).toBe('STRONG');
    expect(screen.getAllByText(PRESSURE)).toHaveLength(1);
    expect(screen.queryByText(/Analyzing airport data/)).toBeNull();

    fetchMock.mockImplementation(() => json(chatBody([], 'Second answer.')));
    type('And LAX?');
    send();
    await screen.findByText('Second answer.');
    const sent = JSON.parse(fetchMock.mock.calls[1]?.[1].body as string) as { messages: { role: string; content: string }[] };
    expect(sent.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent.messages[1]?.content).toBe('SFO shows **elevated** pressure.');
    expect(JSON.stringify(sent)).not.toContain('57.6');
  });

  it('prevents duplicate submissions while a request is active', async () => {
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    renderChat();
    type('Hello');
    send();
    await screen.findByRole('status');
    expect((screen.getByRole('button', { name: /Analyzing/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('Your question').closest('form') as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify(chatBody([], 'Done.')), { status: 200 }));
    await screen.findByText('Done.');
  });

  it.each([
    [504, 'LLM_TIMEOUT', /took too long/],
    [503, 'LLM_RATE_LIMITED', /busy/],
    [502, 'LLM_UNAVAILABLE', /temporarily unavailable/],
    [503, 'CHAT_NOT_CONFIGURED', /not configured/],
    [400, 'INVALID_REQUEST', /could not be processed/],
  ])('shows a concise message for %s %s and returns the question to the composer', async (status, code, expected) => {
    fetchMock.mockImplementation(() => json({ code, message: 'internal detail: stack at secret.ts', requestId: 'r1' }, status));
    renderChat();
    type('Question');
    send();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).not.toMatch(/stack|secret|internal detail/);
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('Question');
  });

  it('handles a network failure and a malformed response without rendering anything from them', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('boom')));
    renderChat();
    type('Q');
    send();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach/);

    fetchMock.mockImplementation(() => json({ message: 5, artifacts: 'nope' }));
    send();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/unexpected response/));
    expect(screen.queryByText('Assistant')).toBeNull();
  });
});

describe('response parsing', () => {
  it('rejects a malformed envelope', () => {
    expect(parseChatResponse({ nope: true })).toBeNull();
    expect(parseChatResponse({ message: 'x', artifacts: [], meta: { toolCalls: [] } })).toBeNull();
  });

  it('keeps the answer when one artifact is unknown or malformed', () => {
    const reply = parseChatResponse(chatBody([{ type: 'hologram' }, { ...ranking(), candidateCount: 'many' }, demandPressure()]));
    expect(reply?.artifacts.map((a) => a.type)).toEqual(['unsupported', 'unsupported', 'demand-pressure']);
  });
});

describe('prose', () => {
  it('drops markdown tables when structured results accompany the message, and keeps them as text otherwise', () => {
    const text = 'Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- point one\n- point two';
    expect(parseProse(text, true).map((b) => b.kind)).toEqual(['p', 'ul']);
    expect(parseProse(text, false).map((b) => b.kind)).toEqual(['p', 'p', 'p', 'ul']);
  });
});

describe('conversation limits', () => {
  const turn = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? ('user' as const) : ('assistant' as const), content: 'x' }));
  it('warns near the limit and refuses beyond it, never truncating', () => {
    expect(conversationBudget(turn(2), 'hi').warning).toBeNull();
    expect(conversationBudget(turn(16), 'hi').warning).toMatch(/nearing/);
    const full = conversationBudget(turn(20), 'hi');
    expect(full.canSend).toBe(false);
    expect(full.warning).toMatch(/length limit/);
    expect(conversationBudget([{ role: 'user', content: 'x'.repeat(19_990) }], 'y'.repeat(20)).canSend).toBe(false);
    expect(conversationBudget([], '   ').canSend).toBe(false);
  });
});

describe('formatting', () => {
  it('formats without changing meaning, and never turns a missing value into zero', () => {
    expect(formatPercent(null)).toBe('Unavailable');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(-3.29)).toBe('−3.29%');
    expect(formatMinutes(4.1)).toBe('4.1 min');
    expect(formatWithUnit(-0.02, 'percentage points')).toBe('−0.02 pp');
    expect(formatWithUnit(undefined, 'percent')).toBe('Unavailable');
    expect(formatPeriod({ start: '2025-05', end: '2026-04' })).toBe('May 2025 – Apr 2026');
  });
});
