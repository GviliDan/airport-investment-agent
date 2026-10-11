import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { Problem } from '@airport/shared';
import { AgentError, type AgentErrorKind } from '../agent/errors';
import type { Logger } from './logger';

export function problem(res: Response, code: string, message: string): Problem {
  return { code, message, requestId: res.locals.requestId as string };
}

const AGENT_FAILURES: Record<AgentErrorKind, { status: number; code: string; message: string }> = {
  'not-configured': { status: 503, code: 'CHAT_NOT_CONFIGURED', message: 'Chat is not configured on this server.' },
  'llm-timeout': { status: 504, code: 'LLM_TIMEOUT', message: 'The language model took too long to answer. Please try again.' },
  'llm-rate-limited': { status: 503, code: 'LLM_RATE_LIMITED', message: 'The language model service is busy. Please try again shortly.' },
  'llm-unavailable': { status: 502, code: 'LLM_UNAVAILABLE', message: 'The language model service is unavailable.' },
  'llm-invalid-response': { status: 502, code: 'LLM_INVALID_RESPONSE', message: 'The language model returned an unusable response. Please try again.' },
};

function clientStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(problem(res, 'NOT_FOUND', 'Route not found.'));
};

/**
 * Agent failures map to safe 5xx problems. Client errors raised by Express itself (malformed JSON, ...) keep their 4xx status.
 * Everything else is logged and answered with a generic 500: internals never reach the client.
 */
export const errorHandler =
  (log: Logger): ErrorRequestHandler =>
  // Express recognizes an error handler by its four parameters, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (error, _req, res, _next) => {
    const requestId = res.locals.requestId as string;
    if (error instanceof AgentError) {
      const failure = AGENT_FAILURES[error.kind];
      log.warn({ requestId, kind: error.kind }, 'agent failure');
      res.status(failure.status).json(problem(res, failure.code, failure.message));
      return;
    }
    const status = clientStatus(error);
    if (status) {
      res.status(status).json(problem(res, 'INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid request.'));
      return;
    }
    log.error({ requestId, err: error }, 'unhandled error');
    res.status(500).json(problem(res, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
  };
