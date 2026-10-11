import type { Artifact, ChatMessage, ChatResponse } from '@airport/shared';
import { AgentError, agentErrorFrom } from './errors';
import { LlmError, type LlmClient, type LlmMessage, type ToolCall } from './llmClient';
import type { AgentLog, ChatAgent } from './ports';
import { buildSystemPrompt } from './systemPrompt';
import { toToolDefinition, toToolError, type AgentTool, type ToolError } from './tools/tool';

/** Calls beyond this in one model step are refused with a tool error rather than executed. */
const MAX_TOOL_CALLS_PER_STEP = 4;

export interface ToolCallingAgentOptions {
  readonly llm: LlmClient;
  readonly tools: readonly AgentTool[];
  /** Upper bound on model calls per turn. */
  readonly maxSteps: number;
  /** Upper bound on the whole turn (model calls and tools), in milliseconds. */
  readonly deadlineMs: number;
  readonly now?: () => Date;
}

interface ExecutedCall {
  readonly name: string;
  readonly content: string;
  readonly artifacts: readonly Artifact[];
  readonly error: ToolError | undefined;
}

const SILENT: AgentLog = { info: () => undefined, warn: () => undefined };

/**
 * A bounded tool-calling loop. The model chooses tools and explains their results; every number it can quote
 * comes from a deterministic tool. Each pass is one model call; tool calls requested in one pass run together.
 */
export class ToolCallingAgent implements ChatAgent {
  private readonly byName: Map<string, AgentTool>;
  private readonly definitions;

  constructor(private readonly options: ToolCallingAgentOptions) {
    this.byName = new Map(options.tools.map((t) => [t.name, t]));
    this.definitions = options.tools.map(toToolDefinition);
  }

  async respond(history: readonly ChatMessage[], log: AgentLog = SILENT): Promise<ChatResponse> {
    const { llm, maxSteps, deadlineMs, now = () => new Date() } = this.options;
    const deadline = AbortSignal.timeout(deadlineMs);
    const conversation: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(now().toISOString().slice(0, 10)) },
      ...history.map((m): LlmMessage => ({ role: m.role, content: m.content })),
    ];
    const artifacts: Artifact[] = [];
    const toolNames: string[] = [];
    const warnings: string[] = [];
    const finish = (message: string): ChatResponse => ({ message, artifacts: dedupe(artifacts), meta: { toolCalls: toolNames, warnings } });

    for (let step = 1; step <= maxSteps; step += 1) {
      if (deadline.aborted) {
        warnings.push('time-limit-reached');
        return finish(INCOMPLETE_MESSAGE);
      }
      let reply;
      try {
        reply = await llm.chat({ messages: conversation, tools: this.definitions, signal: deadline });
      } catch (error) {
        if (error instanceof LlmError) {
          log.warn({ step, kind: error.kind }, 'model request failed');
          throw agentErrorFrom(error);
        }
        throw error;
      }

      if (reply.toolCalls.length === 0) {
        const text = reply.content.trim();
        if (text.length === 0) throw new AgentError('llm-invalid-response', 'The language model returned neither text nor a tool call.');
        return finish(text);
      }

      conversation.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
      const executed = await Promise.all(reply.toolCalls.map((call, index) => this.execute(call, index, log)));
      for (const call of executed) {
        conversation.push({ role: 'tool', toolName: call.name, content: call.content });
        toolNames.push(call.name);
        artifacts.push(...call.artifacts);
        if (call.error) warnings.push(`${call.name}: ${call.error.kind}`);
      }
    }

    warnings.push('step-limit-reached');
    log.warn({ maxSteps }, 'step limit reached');
    return finish(INCOMPLETE_MESSAGE);
  }

  /** Never throws: every failure becomes a structured error the model can read and explain. */
  private async execute(call: ToolCall, index: number, log: AgentLog): Promise<ExecutedCall> {
    const failed = (error: ToolError): ExecutedCall => ({ name: call.name, content: JSON.stringify({ error }), artifacts: [], error });
    if (index >= MAX_TOOL_CALLS_PER_STEP) {
      return failed({ kind: 'invalid-arguments', message: `At most ${MAX_TOOL_CALLS_PER_STEP} tool calls are run per step; call this tool again.` });
    }
    const tool = this.byName.get(call.name);
    if (!tool) return failed({ kind: 'unknown-tool', message: `There is no tool named "${call.name}". Available tools: ${[...this.byName.keys()].join(', ')}.` });

    const started = Date.now();
    try {
      const args = tool.input.parse(call.arguments ?? {});
      const outcome = await tool.execute(args);
      log.info({ tool: call.name, ms: Date.now() - started }, 'tool completed');
      return { name: call.name, content: JSON.stringify(outcome.result), artifacts: outcome.artifacts, error: undefined };
    } catch (error) {
      const toolError = toToolError(error);
      log.warn({ tool: call.name, kind: toolError.kind, ms: Date.now() - started }, 'tool failed');
      return failed(toolError);
    }
  }
}

const INCOMPLETE_MESSAGE =
  'I could not finish this analysis within the allowed number of steps or time. The results gathered so far are attached; please try a narrower question.';

function dedupe(artifacts: readonly Artifact[]): Artifact[] {
  const seen = new Set<string>();
  return artifacts.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
