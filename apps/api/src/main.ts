import { composeApplication } from './composition';
import { loadConfig } from './config/env';
import { createLogger } from './http/logger';
import { buildServer } from './http/server';

// Must stay below the compose stop_grace_period (20s).
const SHUTDOWN_DEADLINE_MS = 15_000;

/** Composition root: the only place that wires concrete implementations together. */
function main(): void {
  const config = loadConfig();
  const { agent, providers, llm } = composeApplication(config);
  const log = createLogger(config.LOG_LEVEL);
  const app = buildServer({ agent, providers, llm, log });

  const server = app.listen(config.PORT, '0.0.0.0', () => log.info({ port: config.PORT }, 'listening'));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
    // close() stops accepting connections and waits for in-flight requests.
    server.close((err) => {
      if (err) log.error({ err }, 'error during shutdown');
      process.exit(err ? 1 : 0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
