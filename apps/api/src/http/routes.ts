import type { Express } from 'express';
import { ChatRequestSchema } from '@airport/shared';
import type { ChatAgent } from '../agent/ports';
import { problem } from './errors';
import { healthReport, type ProviderStatus } from './health';
import type { Logger } from './logger';

interface RouteDeps {
  agent: ChatAgent;
  providers: ProviderStatus;
  llm: 'configured' | 'not-configured';
  log: Logger;
}

export function registerRoutes(app: Express, { agent, providers, llm, log }: RouteDeps): void {
  app.get('/health', (_req, res) => {
    res.json(healthReport(providers, llm));
  });

  app.post('/v1/chat', async (req, res) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      res.status(400).json(problem(res, 'INVALID_REQUEST', message));
      return;
    }
    res.json(await agent.respond(parsed.data.messages, log));
  });
}
