import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatBody } from './fixtures';
import { renderChat } from './renderChat';

/** A stand-in for the browser's SpeechRecognition that tests can drive by hand. */
class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = '';
  continuous = true;
  interimResults = true;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  abort() {
    this.started = false;
  }
  say(transcript: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal })] });
  }
}

const fetchMock = vi.fn();
const composer = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const mic = () => screen.getByRole('button', { name: /voice input/i }) as HTMLButtonElement;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  FakeRecognition.last = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe('voice input', () => {
  it('is disabled with a message when the browser has no speech recognition, and text chat still works', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(chatBody([], 'Typed answer.')), { status: 200 })));
    renderChat();
    expect(mic().disabled).toBe(true);
    expect(screen.getByText('Voice input is not supported in this browser.')).toBeTruthy();
    fireEvent.change(composer(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Typed answer.')).toBeTruthy();
  });

  describe('in a supported browser', () => {
    beforeEach(() => vi.stubGlobal('webkitSpeechRecognition', FakeRecognition));

    it('starts listening in English and stops when clicked again, keeping the composer text', () => {
      renderChat();
      fireEvent.change(composer(), { target: { value: 'draft' } });
      expect(mic().getAttribute('aria-label')).toBe('Start voice input');
      fireEvent.click(mic());
      expect(FakeRecognition.last?.started).toBe(true);
      expect(FakeRecognition.last?.lang).toBe('en-US');
      expect(mic().getAttribute('aria-label')).toBe('Stop voice input');
      fireEvent.click(mic());
      expect(mic().getAttribute('aria-label')).toBe('Start voice input');
      expect(composer().value).toBe('draft');
    });

    it('puts the final transcript in the composer, appends to existing text, and never sends by itself', () => {
      renderChat();
      fireEvent.click(mic());
      act(() => FakeRecognition.last?.say('compare LA and Santa Ana', false)); // interim results are ignored
      expect(composer().value).toBe('');
      act(() => FakeRecognition.last?.say('compare LA and Santa Ana'));
      expect(composer().value).toBe('compare LA and Santa Ana');
      act(() => FakeRecognition.last?.say('congestion'));
      expect(composer().value).toBe('compare LA and Santa Ana congestion');
      fireEvent.change(composer(), { target: { value: 'edited by hand' } }); // still editable
      expect(composer().value).toBe('edited by hand');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops listening when the question is sent, and releases the microphone when the chat goes away', () => {
      fetchMock.mockImplementation(() => new Promise(() => undefined));
      const { unmount } = renderChat();
      fireEvent.click(mic());
      const session = FakeRecognition.last;
      act(() => session?.say('hello'));
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(session?.started).toBe(false);
      fireEvent.click(mic()); // disabled while the request runs
      expect(FakeRecognition.last).toBe(session);
      fireEvent.click(mic());
      unmount();
      expect(session?.started).toBe(false);
    });

    it('shows a friendly message on a recognition error without touching the text or text chat', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(chatBody([], 'Still works.')), { status: 200 })));
      renderChat();
      fireEvent.change(composer(), { target: { value: 'keep me' } });
      fireEvent.click(mic());
      act(() => FakeRecognition.last?.onerror?.({ error: 'not-allowed' }));
      expect(screen.getByText(/Microphone access was blocked/)).toBeTruthy();
      expect(composer().value).toBe('keep me');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Still works.')).toBeTruthy();
    });
  });
});
