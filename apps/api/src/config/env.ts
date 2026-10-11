import { z } from 'zod';

/** Empty strings (e.g. `KEY=` in .env) count as "not set". */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Ollama Cloud. Server-side only. Not required to start: without both of these /health works and chat reports itself unavailable.
  OLLAMA_API_KEY: optionalString,
  /** The model is configuration only; no model name appears in code. */
  LLM_MODEL: optionalString,
  /** Upper bound for one LLM request, in milliseconds. */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(6),
  // Server-side only. Optional so the API starts (and /health works) without it; AeroDataBox features then report as not configured.
  AERODATABOX_API_KEY: optionalString,
});

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** The only place that reads process.env. Fails with every problem listed at once. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
