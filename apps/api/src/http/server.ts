import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { ChatAgent } from '../agent/ports';
import { errorHandler, notFoundHandler } from './errors';
import type { ProviderStatus } from './health';
import type { Logger } from './logger';
import { registerRoutes } from './routes';

interface ServerDeps {
  agent: ChatAgent;
  providers: ProviderStatus;
  llm: 'configured' | 'not-configured';
  log: Logger;
}

export function buildServer({ agent, providers, llm, log }: ServerDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Always generate the ID server-side; never trust a client-supplied one.
  app.use((_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });
  app.use(express.json());

  registerRoutes(app, { agent, providers, llm, log });
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
