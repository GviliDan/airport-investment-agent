import { z } from 'zod';
import { ArtifactSchema } from './artifacts';

export const MAX_MESSAGES = 20;
export const MAX_TOTAL_CHARS = 20_000;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const ChatRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
  })
  .superRefine((req, ctx) => {
    const last = req.messages[req.messages.length - 1];
    if (last?.role !== 'user') {
      ctx.addIssue({ code: 'custom', path: ['messages'], message: 'The last message must be from the user.' });
    }
    if (totalChars(req.messages) > MAX_TOTAL_CHARS) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages'],
        message: `Conversation exceeds ${MAX_TOTAL_CHARS} characters.`,
      });
    }
  });

export const ChatResponseSchema = z.object({
  message: z.string(),
  artifacts: z.array(ArtifactSchema),
  meta: z.object({
    toolCalls: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});

export const ProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type Problem = z.infer<typeof ProblemSchema>;

export function totalChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}
