import { describe, expect, it } from 'vitest';
import { ChatRequestSchema, MAX_MESSAGES, MAX_TOTAL_CHARS } from './chat';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });

describe('ChatRequestSchema', () => {
  it('accepts a single user message', () => {
    expect(ChatRequestSchema.safeParse({ messages: [user('hi')] }).success).toBe(true);
  });

  it('rejects more than the maximum number of messages', () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => (i % 2 === 0 ? user('q') : assistant('a')));
    expect(ChatRequestSchema.safeParse({ messages }).success).toBe(false);
  });

  it('rejects conversations over the character limit', () => {
    const big = 'x'.repeat(MAX_TOTAL_CHARS + 1);
    expect(ChatRequestSchema.safeParse({ messages: [user(big)] }).success).toBe(false);
  });

  it('accepts exactly the character limit', () => {
    const exact = 'x'.repeat(MAX_TOTAL_CHARS);
    expect(ChatRequestSchema.safeParse({ messages: [user(exact)] }).success).toBe(true);
  });

  it('requires the last message to come from the user', () => {
    expect(ChatRequestSchema.safeParse({ messages: [user('q'), assistant('a')] }).success).toBe(false);
  });
});
