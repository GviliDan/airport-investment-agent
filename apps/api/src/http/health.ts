type ProviderConfiguration = 'configured' | 'not-configured';

export interface ProviderStatus {
  readonly bts: ProviderConfiguration;
  readonly faa: ProviderConfiguration;
  readonly aerodatabox: ProviderConfiguration;
}

/**
 * Liveness plus which data providers are set up. It deliberately makes no outbound calls: /health is hit
 * by container healthchecks and must never consume provider quota or model inference or depend on a third party being up.
 */
export function healthReport(providers: ProviderStatus, llm: 'configured' | 'not-configured') {
  return { status: 'ok' as const, providers, llm };
}
