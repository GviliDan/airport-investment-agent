import type { Period } from './period';

/** Which public API supplied the data. */
export type DataSource = 'bts-socrata' | 'faa-arcgis' | 'aerodatabox';

/**
 * Where a result came from and when, so downstream results can state their sources and observation
 * period without anyone reconstructing them. Built by our own providers, never parsed from outside.
 */
export interface Provenance {
  readonly source: DataSource;
  readonly dataset: string;
  /** ISO timestamp of the request that produced the data. */
  readonly retrievedAt: string;
  /** The months the data describes, when the source is a monthly series. */
  readonly period?: Period;
  /** Date the source states its data is effective as of (YYYY-MM-DD), when it states one. */
  readonly effectiveDate?: string;
}

/** A provider result together with its provenance. */
export interface Sourced<T> {
  readonly data: T;
  readonly provenance: Provenance;
}
