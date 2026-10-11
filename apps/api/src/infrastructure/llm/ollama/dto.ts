import { z } from 'zod';

/** Ollama `/api/chat` wire shapes. They stay in this file; the rest of the application sees the LlmClient port. */

export interface OllamaRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
}

export interface OllamaRequest {
  model: string;
  messages: OllamaRequestMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  stream: false;
  options: { temperature: number };
}

/** Unknown extra fields (thinking, timings, ids) are ignored. Arguments are kept raw: validating them is the tool's job. */
export const OllamaResponseSchema = z.object({
  message: z.object({
    role: z.literal('assistant'),
    content: z.string().default(''),
    tool_calls: z.array(z.object({ function: z.object({ name: z.string().min(1), arguments: z.unknown() }) })).optional(),
  }),
});
