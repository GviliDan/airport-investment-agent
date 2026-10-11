import type { AppConfig } from '../config/env';

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const SEVERITY = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity } as const;

/** One JSON line per event on stdout, filtered by LOG_LEVEL. Enough for this service; no logging dependency. */
export function createLogger(level: AppConfig['LOG_LEVEL']): Logger {
  const write =
    (name: 'info' | 'warn' | 'error') =>
    (fields: Record<string, unknown>, message: string): void => {
      if (SEVERITY[name] < SEVERITY[level]) return;
      const { err, ...rest } = fields;
      console.log(JSON.stringify({ level: name, time: new Date().toISOString(), msg: message, ...rest, ...(err instanceof Error ? { err: err.message } : {}) }));
    };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
