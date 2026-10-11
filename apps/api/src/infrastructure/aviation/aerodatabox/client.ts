import { getJson, type Fetch } from '../http';

export const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';

export interface AeroDataBoxClientOptions {
  /** RapidAPI key. Sent only as a request header; never logged, never put in a URL or an error message. */
  readonly apiKey: string;
  readonly fetch: Fetch;
  readonly timeoutMs?: number;
}

/** Performs an authenticated GET against AeroDataBox (via RapidAPI) and returns the parsed JSON. */
export type AeroDataBoxGet = (path: string) => Promise<unknown>;

export function createAeroDataBoxGet({ apiKey, fetch, timeoutMs }: AeroDataBoxClientOptions): AeroDataBoxGet {
  const headers = { 'x-rapidapi-host': AERODATABOX_HOST, 'x-rapidapi-key': apiKey };
  return (path) =>
    getJson({
      source: 'aerodatabox',
      url: new URL(path, `https://${AERODATABOX_HOST}`),
      fetch,
      headers,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
}
