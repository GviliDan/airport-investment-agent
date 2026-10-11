import { ProviderError } from '../../../application/errors';
import type { TrafficProvider, TrafficQuery } from '../../../application/ports';
import { monthsInPeriod, type Period } from '../../../domain/period';
import type { Provenance, Sourced } from '../../../domain/provenance';
import type { AirportMonthlyTraffic } from '../../../domain/traffic';
import { getJson, type Fetch } from '../http';
import { mapAvailablePeriod, mapTrafficRows, TRAFFIC_SELECT } from './dto';

export const BTS_TRAFFIC_URL = 'https://data.bts.gov/resource/r495-tyji.json';
const DATASET = 'BTS T-100 Segment Summary By Origin Airport (data.bts.gov r495-tyji)';
/** Socrata's maximum page size for a single request. */
const MAX_ROWS = 50_000;

export interface BtsTrafficProviderOptions {
  readonly fetch: Fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

const monthStart = (month: string): string => `${month}-01T00:00:00`;

/** Builds the SoQL request for the requested airports and months only; nothing else is downloaded. */
export function buildTrafficUrl(baseUrl: string, { airports, period }: TrafficQuery): URL {
  const unique = [...new Set(airports)].sort();
  const rows = unique.length * monthsInPeriod(period).length;
  if (rows > MAX_ROWS) {
    throw new ProviderError('bts-socrata', 'invalid-request', `request would return ${rows} rows; the limit is ${MAX_ROWS}`);
  }
  const codes = unique.map((code) => `'${code}'`).join(',');
  const url = new URL(baseUrl);
  url.searchParams.set('$select', TRAFFIC_SELECT);
  url.searchParams.set(
    '$where',
    `origin_airport_code in(${codes}) AND reporting_month >= '${monthStart(period.start)}' AND reporting_month <= '${monthStart(period.end)}'`,
  );
  url.searchParams.set('$order', 'origin_airport_code,reporting_month');
  url.searchParams.set('$limit', String(rows));
  return url;
}

export function buildAvailablePeriodUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.searchParams.set('$select', 'min(reporting_month) as min_reporting_month,max(reporting_month) as max_reporting_month');
  return url;
}

/** TrafficProvider backed by the public BTS Socrata API. No key is required. */
export class BtsTrafficProvider implements TrafficProvider {
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: BtsTrafficProviderOptions) {
    this.baseUrl = options.baseUrl ?? BTS_TRAFFIC_URL;
    this.now = options.now ?? (() => new Date());
  }

  async availablePeriod(): Promise<Sourced<Period>> {
    const period = mapAvailablePeriod(await this.get(buildAvailablePeriodUrl(this.baseUrl)));
    return { data: period, provenance: this.provenance(period) };
  }

  async monthlyTraffic(query: TrafficQuery): Promise<Sourced<readonly AirportMonthlyTraffic[]>> {
    if (query.airports.length === 0) return { data: [], provenance: this.provenance(query.period) };
    const rows = mapTrafficRows(await this.get(buildTrafficUrl(this.baseUrl, query)));
    assertExpected(rows, query);
    return { data: rows, provenance: this.provenance(query.period) };
  }

  private get(url: URL): Promise<unknown> {
    const { fetch, timeoutMs } = this.options;
    return getJson({ source: 'bts-socrata', url, fetch, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  }

  private provenance(period: Period): Provenance {
    return { source: 'bts-socrata', dataset: DATASET, retrievedAt: this.now().toISOString(), period };
  }
}

/** The server filters, but we verify: rows outside the request, or duplicated, would corrupt later totals. */
function assertExpected(rows: readonly AirportMonthlyTraffic[], { airports, period }: TrafficQuery): void {
  const requested = new Set<string>(airports);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!requested.has(row.airport) || row.month < period.start || row.month > period.end) {
      throw new ProviderError('bts-socrata', 'invalid-response', `returned a row outside the request (${row.airport} ${row.month})`);
    }
    const key = `${row.airport}|${row.month}`;
    if (seen.has(key)) throw new ProviderError('bts-socrata', 'invalid-response', `returned duplicate rows for ${row.airport} ${row.month}`);
    seen.add(key);
  }
}
