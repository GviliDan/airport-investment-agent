import { LlmError, type LlmClient, type LlmMessage, type LlmRequest, type LlmResponse } from '../../../agent/llmClient';
import { OllamaResponseSchema, type OllamaRequest, type OllamaRequestMessage } from './dto';

export const OLLAMA_CLOUD_URL = 'https://ollama.com/api/chat';

type Fetch = typeof globalThis.fetch;

export interface OllamaLlmClientOptions {
  readonly apiKey: string;
  /** Selected by configuration; no model name is hard-coded. */
  readonly model: string;
  readonly timeoutMs: number;
  readonly url?: string;
  readonly fetch?: Fetch;
}

/**
 * LlmClient over the Ollama HTTP API (non-streaming). One attempt per call: no retries, so a failing model
 * can never multiply latency or spend. The API key is only ever sent in the Authorization header.
 */
export class OllamaLlmClient implements LlmClient {
  private readonly url: string;
  private readonly fetch: Fetch;

  constructor(private readonly options: OllamaLlmClientOptions) {
    this.url = options.url ?? OLLAMA_CLOUD_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async chat({ messages, tools, signal }: LlmRequest): Promise<LlmResponse> {
    const body: OllamaRequest = {
      model: this.options.model,
      messages: messages.map(toOllamaMessage),
      ...(tools.length === 0
        ? {}
        : { tools: tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }),
      stream: false,
      // The model selects tools and explains results; it does not need creativity.
      options: { temperature: 0 },
    };

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const timedOut = (): LlmError => new LlmError('timeout', `the model did not answer within ${this.options.timeoutMs} ms`);

    let response: Response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch {
      if (timeout.aborted) throw timedOut();
      if (signal?.aborted) throw new LlmError('aborted', 'the request was aborted');
      throw new LlmError('network', 'the model service could not be reached');
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) throw new LlmError('rate-limited', 'the model service is rate limiting requests', 429);
      if (response.status === 401 || response.status === 403) throw new LlmError('unauthorized', 'the model service rejected the credentials', response.status);
      throw new LlmError('http-status', `the model service answered HTTP ${response.status}`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timeout.aborted) throw timedOut();
      throw new LlmError('invalid-response', 'the model service returned a body that is not JSON');
    }
    const parsed = OllamaResponseSchema.safeParse(payload);
    if (!parsed.success) throw new LlmError('invalid-response', 'the model service response did not have the expected shape');

    const { content, tool_calls } = parsed.data.message;
    return {
      content,
      toolCalls: (tool_calls ?? []).map((call) => ({ name: call.function.name, arguments: parseArguments(call.function.arguments) })),
    };
  }
}

/** Some models emit arguments as a JSON string. Anything that is not valid JSON is passed on as-is and fails validation. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toOllamaMessage(message: LlmMessage): OllamaRequestMessage {
  switch (message.role) {
    case 'tool':
      return { role: 'tool', tool_name: message.toolName, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? { tool_calls: message.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    default:
      return { role: message.role, content: message.content };
  }
}
