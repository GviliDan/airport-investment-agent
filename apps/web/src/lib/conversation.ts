import { MAX_MESSAGES, MAX_TOTAL_CHARS, totalChars, type ChatMessage } from '@airport/shared';

/** The warning shows once the conversation uses this share of either limit. */
const WARN_AT = 0.8;

export interface ConversationBudget {
  /** Messages the request would carry, including the draft. */
  readonly messages: number;
  readonly characters: number;
  readonly canSend: boolean;
  readonly warning: string | null;
}

/** The backend rejects over-long histories rather than truncating them, so the UI refuses to send them. */
export function conversationBudget(history: readonly ChatMessage[], draft: string): ConversationBudget {
  const text = draft.trim();
  const messages = history.length + 1;
  const characters = totalChars(history) + text.length;
  const fits = messages <= MAX_MESSAGES && characters <= MAX_TOTAL_CHARS;
  let warning: string | null = null;
  if (!fits) {
    warning = 'This conversation is at its length limit. Start a new conversation to continue.';
  } else if (messages >= MAX_MESSAGES * WARN_AT || characters >= MAX_TOTAL_CHARS * WARN_AT) {
    warning = `This conversation is nearing its limit (${messages} of ${MAX_MESSAGES} messages, ${characters.toLocaleString('en-US')} of ${MAX_TOTAL_CHARS.toLocaleString('en-US')} characters). Start a new conversation soon.`;
  }
  return { messages, characters, canSend: fits && text.length > 0, warning };
}
