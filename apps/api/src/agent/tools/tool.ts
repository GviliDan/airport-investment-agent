import { z } from 'zod';
import type { Artifact } from '@airport/shared';
import { AirportNotFoundError, AnalysisUnavailableError, ProviderError } from '../../application/errors';
import type { ToolDefinition } from '../llmClient';

/** What a tool hands back: the JSON the model reads, and the UI artifacts built from that same data. */
export interface ToolOutcome {
  readonly result: unknown;
  readonly artifacts: readonly Artifact[];
}

export interface AgentTool<Input = unknown> {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<Input, unknown>;
  execute(input: Input): Promise<ToolOutcome>;
}

export function defineTool<Input>(tool: AgentTool<Input>): AgentTool<Input> {
  return tool;
}

/** The JSON Schema shown to the model. The Zod schema stays the single source of truth. */
export function toToolDefinition(tool: AgentTool): ToolDefinition {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
  delete (schema as Record<string, unknown>)['$schema'];
  return { name: tool.name, description: tool.description, parameters: schema };
}

export type ToolErrorKind =
  | 'unknown-tool'
  | 'invalid-arguments'
  | 'airport-not-found'
  | 'analysis-unavailable'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'internal-error';

export interface ToolError {
  readonly kind: ToolErrorKind;
  /** Safe to show to the model: no provider response bodies, stack traces or credentials. */
  readonly message: string;
}

export function toToolError(error: unknown): ToolError {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ');
    return { kind: 'invalid-arguments', message: `The arguments were rejected: ${issues}` };
  }
  if (error instanceof AirportNotFoundError) return { kind: 'airport-not-found', message: `Airport ${error.airport} was not found in the FAA directory. Use resolve_airports to find the right code.` };
  if (error instanceof AnalysisUnavailableError) return { kind: 'analysis-unavailable', message: error.message };
  if (error instanceof ProviderError) {
    const source = { 'bts-socrata': 'BTS traffic data', 'faa-arcgis': 'FAA airport directory', aerodatabox: 'AeroDataBox schedule data' }[error.source];
    if (error.kind === 'rate-limited') return { kind: 'rate-limited', message: `${source} is rate limiting requests (quota may be exhausted). Try again later.` };
    if (error.kind === 'invalid-request') return { kind: 'analysis-unavailable', message: `The request cannot be served by ${source}.` };
    return { kind: 'provider-unavailable', message: `${source} is unavailable or returned unusable data.` };
  }
  return { kind: 'internal-error', message: 'The tool failed unexpectedly.' };
}
