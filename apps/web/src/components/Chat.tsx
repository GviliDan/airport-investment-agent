'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatMessage } from '@airport/shared';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { sendChat, type AssistantReply } from '../lib/chatClient';
import { conversationBudget } from '../lib/conversation';
import { ArtifactList } from './artifacts/ArtifactList';
import { Prose } from './Prose';

export const STARTER_PROMPTS = [
  'Which airports in New England are strong candidates for terminal expansion?',
  'Compare LAX and SNA congestion.',
  'What percentage of flights out of Anchorage are long haul?',
  'What is the unmet demand pressure at SFO?',
] as const;

/** A completed exchange. Only the two message texts go back to the API as history; artifacts are display-only. */
interface Turn {
  readonly user: string;
  readonly reply: AssistantReply;
}

const toHistory = (turns: readonly Turn[]): ChatMessage[] =>
  turns.flatMap<ChatMessage>((t) => [{ role: 'user', content: t.user }, { role: 'assistant', content: t.reply.message }]);

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Speech only fills the composer; the user edits it and presses Send as usual. Existing text is kept.
  const voice = useSpeechRecognition((text) => setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text)));

  // Mutations are not retried by default, which is right here: a retried chat request would run the whole analysis twice.
  const chat = useMutation({ mutationFn: sendChat });

  const history = toHistory(turns);
  const budget = conversationBudget(history, draft);
  const canSubmit = budget.canSend && !chat.isPending;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, chat.isPending, chat.error]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    const text = draft.trim();
    voice.stop(); // a transcript must not arrive after the question has been sent
    setDraft('');
    chat.mutate([...history, { role: 'user', content: text }], {
      onSuccess: (reply) => setTurns((current) => [...current, { user: text, reply }]),
      onError: () => setDraft(text), // nothing was lost: the question goes back to the composer
      onSettled: () => inputRef.current?.focus(),
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function reset() {
    setTurns([]);
    chat.reset();
    setDraft('');
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <div>
          <h1>Airport Investment Intelligence Agent</h1>
          <p className="subtitle">Ask questions about US airport investment opportunities.</p>
          <p className="muted note">Scores and metrics are calculated deterministically from aviation data.</p>
        </div>
        {turns.length > 0 ? (
          <button type="button" className="secondary" onClick={reset} disabled={chat.isPending}>
            New conversation
          </button>
        ) : null}
      </header>

      <div className="thread" role="log" aria-live="polite" aria-label="Conversation">
        {turns.length === 0 && !chat.isPending ? (
          <section className="empty" aria-label="Examples">
            <p>Try one of these, or ask your own question. Nothing is sent until you press Send.</p>
            <ul className="starters">
              {STARTER_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(prompt);
                      inputRef.current?.focus();
                    }}
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
            <div className="empty-hint">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 16.5 21 10a1.6 1.6 0 0 0-.2-3.1L16 8 8.5 4 6.5 5l4 4.5-5 1.8L3 10l-1 1 3 3.5Z" />
                <path d="M3 20h18" />
              </svg>
              <p>Ask about airport expansion, congestion, route mix, or demand pressure.</p>
            </div>
          </section>
        ) : null}

        {turns.map((turn, index) => (
          <div key={index} className="turn">
            <div className="msg user">
              <span className="who">You</span>
              <p>{turn.user}</p>
            </div>
            <div className="msg assistant">
              <span className="who">Assistant</span>
              <Prose text={turn.reply.message} dropTables={turn.reply.artifacts.length > 0} />
              <ArtifactList artifacts={turn.reply.artifacts} />
            </div>
          </div>
        ))}

        {chat.isPending ? (
          <div className="turn">
            <div className="msg user">
              <span className="who">You</span>
              <p>{chat.variables.at(-1)?.content}</p>
            </div>
            <div className="msg assistant loading" role="status">
              <span className="who">Assistant</span>
              <p>
                <span className="spinner" aria-hidden="true" /> Analyzing airport data&hellip;
              </p>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {chat.error ? (
        <p className="error" role="alert">
          {chat.error.message}
        </p>
      ) : null}
      {voice.error ? (
        <p className="warning" role="status">
          {voice.error}
        </p>
      ) : null}
      {budget.warning ? (
        <p className="warning" role="status">
          {budget.warning}
        </p>
      ) : null}

      <form className="composer" onSubmit={submit}>
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          ref={inputRef}
          value={draft}
          rows={2}
          placeholder="Ask about an airport, a region, or a comparison"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={chat.isPending}
        />
        <button
          type="button"
          className="mic"
          data-listening={voice.listening}
          aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
          title={voice.supported ? undefined : 'Voice input is not supported in this browser.'}
          disabled={!voice.supported || chat.isPending}
          onClick={voice.toggle}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {voice.listening ? (
              <rect x="6" y="6" width="12" height="12" rx="2" />
            ) : (
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z" />
            )}
          </svg>
          <span>{voice.listening ? 'Listening…' : 'Voice'}</span>
        </button>
        <button type="submit" disabled={!canSubmit}>
          {chat.isPending ? 'Analyzing…' : 'Send'}
        </button>
      </form>
      {!voice.supported ? <p className="muted voice-note">Voice input is not supported in this browser.</p> : null}
    </div>
  );
}
