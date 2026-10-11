import { ToolCallingAgent } from './agent/toolCallingAgent';
import { buildTools } from './agent/tools/airportTools';
import { AgentError } from './agent/errors';
import type { ChatAgent } from './agent/ports';
import { AirportAnalyticsService } from './application/airportAnalyticsService';
import type { AppConfig } from './config/env';
import type { ProviderStatus } from './http/health';
import { createAeroDataBoxGet } from './infrastructure/aviation/aerodatabox/client';
import { AeroDataBoxDelayProvider } from './infrastructure/aviation/aerodatabox/aeroDataBoxDelayProvider';
import { AeroDataBoxRouteNetworkProvider } from './infrastructure/aviation/aerodatabox/aeroDataBoxRouteNetworkProvider';
import { BtsTrafficProvider } from './infrastructure/aviation/bts/btsTrafficProvider';
import { FaaAirportDirectory } from './infrastructure/aviation/faa/faaAirportDirectory';
import type { Fetch } from './infrastructure/aviation/http';
import { OllamaLlmClient } from './infrastructure/llm/ollama/ollamaLlmClient';

/** Upper bound for one whole chat turn (model calls and tools). Kept below the web proxy's timeout. */
export const AGENT_TURN_DEADLINE_MS = 80_000;

/** Used when no model is configured: the API still starts and /health works, but chat reports itself unavailable. */
const unconfiguredAgent: ChatAgent = {
  respond: () => Promise.reject(new AgentError('not-configured', 'Chat is not configured: set OLLAMA_API_KEY and LLM_MODEL.')),
};

export interface Application {
  readonly analytics: AirportAnalyticsService;
  /** Which providers were set up, derived from what was actually constructed. */
  readonly providers: ProviderStatus;
  readonly agent: ChatAgent;
  readonly llm: 'configured' | 'not-configured';
}

/**
 * Wires concrete providers into the analytics service. Constructing providers makes no network calls:
 * data is fetched only when an analysis is requested, so AeroDataBox quota is untouched at startup.
 * BTS and FAA are public and need no key; AeroDataBox is wired only when its key is configured.
 */
export function composeApplication(
  config: Pick<AppConfig, 'AERODATABOX_API_KEY'> &
    Partial<Pick<AppConfig, 'OLLAMA_API_KEY' | 'LLM_MODEL' | 'LLM_TIMEOUT_MS' | 'AGENT_MAX_STEPS'>>,
  fetch: Fetch = globalThis.fetch,
): Application {
  const aeroDataBox = config.AERODATABOX_API_KEY
    ? createAeroDataBoxGet({ apiKey: config.AERODATABOX_API_KEY, fetch })
    : undefined;

  const analytics = new AirportAnalyticsService({
      airports: new FaaAirportDirectory({ fetch }),
      traffic: new BtsTrafficProvider({ fetch }),
      routes: aeroDataBox && new AeroDataBoxRouteNetworkProvider(aeroDataBox),
      delays: aeroDataBox && new AeroDataBoxDelayProvider(aeroDataBox),
  });

  // The model is optional: without a key and a model name the agent reports itself unavailable. Nothing is called here.
  const { OLLAMA_API_KEY: apiKey, LLM_MODEL: model } = config;
  const agent =
    apiKey && model
      ? new ToolCallingAgent({
          llm: new OllamaLlmClient({ apiKey, model, timeoutMs: config.LLM_TIMEOUT_MS ?? 30_000, fetch }),
          tools: buildTools(analytics),
          maxSteps: config.AGENT_MAX_STEPS ?? 6,
          deadlineMs: AGENT_TURN_DEADLINE_MS,
        })
      : unconfiguredAgent;

  return {
    analytics,
    agent,
    llm: apiKey && model ? 'configured' : 'not-configured',
    providers: { bts: 'configured', faa: 'configured', aerodatabox: aeroDataBox ? 'configured' : 'not-configured' },
  };
}
