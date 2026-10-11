'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Optional voice input using the browser's own Speech Recognition API. It only turns speech into text: the caller
 * puts the transcript in the composer and the user sends it as usual. No audio leaves the browser through this app.
 */

// The DOM typings do not include SpeechRecognition, so only the small part used here is described.
interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string } | undefined;
}
interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;

/** Guarded so server rendering never touches `window`. */
function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser to use voice input.',
  'service-not-allowed': 'Microphone access was blocked. Allow it in the browser to use voice input.',
  'no-speech': 'No speech was heard. Try again.',
  'audio-capture': 'No microphone was found.',
};
const GENERIC_ERROR = 'Voice input did not work. You can keep typing.';

export interface SpeechInput {
  readonly supported: boolean;
  readonly listening: boolean;
  readonly error: string | null;
  readonly toggle: () => void;
  /** Stops listening if it is; does nothing otherwise. */
  readonly stop: () => void;
}

/** `onTranscript` receives each final transcript; it is never sent anywhere automatically. */
export function useSpeechRecognition(onTranscript: (text: string) => void): SpeechInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<RecognitionLike | null>(null);
  const handler = useRef(onTranscript);
  useEffect(() => {
    handler.current = onTranscript;
  }, [onTranscript]);

  // Decided after mount so the server and first client render agree. On unmount the microphone is released and
  // a late result can no longer reach the (gone) composer.
  useEffect(() => {
    setSupported(recognitionConstructor() !== undefined);
    return () => {
      const running = recognition.current;
      if (!running) return;
      running.onresult = null;
      running.onerror = null;
      running.onend = null;
      running.abort();
      recognition.current = null;
    };
  }, []);

  const stop = () => recognition.current?.stop();

  function toggle() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    const instance = new Recognition();
    instance.lang = 'en-US';
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) text += result[0]?.transcript ?? '';
      }
      if (text.trim()) handler.current(text.trim());
    };
    instance.onerror = (event) => {
      if (event.error !== 'aborted') setError(ERROR_MESSAGES[event.error] ?? GENERIC_ERROR);
    };
    instance.onend = () => {
      // Only the current session may reset the state; a stale one must not end a newer session.
      if (recognition.current === instance) recognition.current = null;
      setListening(false);
    };
    setError(null);
    try {
      instance.start();
      recognition.current = instance;
      setListening(true);
    } catch {
      setError(GENERIC_ERROR);
    }
  }

  return { supported, listening, error, toggle, stop };
}
