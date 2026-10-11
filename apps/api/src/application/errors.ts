import type { DataSource } from '../domain/provenance';

type ProviderErrorKind =
  /** The request could not be sent or the connection failed. */
  | 'network'
  | 'timeout'
  /** The provider answered with a non-success HTTP status. */
  | 'http-status'
  | 'rate-limited'
  /** The provider's answer was not JSON, or did not have the shape this application relies on. */
  | 'invalid-response'
  /** The caller asked for something the provider cannot serve; nothing was sent. */
  | 'invalid-request';

/**
 * A public data API failed or returned data we cannot trust. Messages never contain credentials.
 * Providers throw this instead of returning partial or zero-filled data.
 */
export class ProviderError extends Error {
  constructor(
    readonly source: DataSource,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`${source}: ${message}`, options);
    this.name = 'ProviderError';
  }
}

/** The FAA directory has no record of the requested airport. */
export class AirportNotFoundError extends Error {
  constructor(readonly airport: string) {
    super(`Airport ${airport} was not found in the FAA directory`);
    this.name = 'AirportNotFoundError';
  }
}

/** An analysis cannot be produced for a reason that is not a provider failure (missing configuration, too little history). */
export class AnalysisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisUnavailableError';
  }
}
