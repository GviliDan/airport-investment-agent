import { ProviderError } from '../../../application/errors';
import type { AirportDirectory, AirportsInStates, AirportTextSearch } from '../../../application/ports';
import type { Airport } from '../../../domain/airport';
import { AirportCodeSchema, StateCodeSchema, type AirportCode } from '../../../domain/codes';
import type { Provenance, Sourced } from '../../../domain/provenance';
import { getJson, type Fetch } from '../http';
import { FACILITY_OUT_FIELDS, mapFacilityPage } from './dto';

export const FAA_FACILITIES_URL =
  'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Aviation_Facilities/FeatureServer/0/query';
const DATASET = 'FAA Aviation Facilities (NTAD, ArcGIS FeatureServer)';
/** The layer's page size; larger results are fetched page by page, up to MAX_PAGES. */
const PAGE_SIZE = 2_000;
const MAX_PAGES = 10;
const MAX_CODES_PER_REQUEST = 300;
const MAX_SEARCH_RECORDS = 200;

export interface FaaAirportDirectoryOptions {
  readonly fetch: Fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/** Builds a query for site type "airport" with a server-side filter; every value is validated before use. */
export function buildFacilitiesUrl(baseUrl: string, filter: string, offset: number, pageSize: number = PAGE_SIZE): URL {
  const url = new URL(baseUrl);
  url.searchParams.set('where', `SITE_TYPE_CODE='A' AND ${filter}`);
  url.searchParams.set('outFields', FACILITY_OUT_FIELDS);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('orderByFields', 'STATE_CODE,ARPT_ID');
  url.searchParams.set('resultRecordCount', String(pageSize));
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('f', 'json');
  return url;
}

export const codesFilter = (codes: readonly AirportCode[]): string => `ARPT_ID IN (${quoted(codes)})`;

export function statesFilter({ states, publicUseOnly }: AirportsInStates): string {
  const validStates = states.map((s) => StateCodeSchema.parse(s));
  return `STATE_CODE IN (${quoted(validStates)})${publicUseOnly ? " AND FACILITY_USE_CODE='PU'" : ''}`;
}

/**
 * A filter for free text. The text is reduced to letters, digits and a few name characters, so it cannot change the
 * query; quotes are doubled. Undefined when nothing searchable remains.
 */
export function searchFilter({ text, scheduledServiceOnly }: Pick<AirportTextSearch, 'text' | 'scheduledServiceOnly'>): string | undefined {
  const term = text.toUpperCase().replace(/[^A-Z0-9 .'&/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replaceAll("'", "''");
  if (term.length === 0) return undefined;
  const namePattern = term.length >= 4 ? `%${term}%` : `${term}%`;
  const matches = [`CITY LIKE '${term}%'`, `ARPT_NAME LIKE '${namePattern}'`, ...(/^[A-Z0-9]{3}$/.test(term) ? [`ARPT_ID='${term}'`] : [])];
  return `FACILITY_USE_CODE='PU' AND (${matches.join(' OR ')})${scheduledServiceOnly ? " AND FAR_139_CARRIER_SER_CODE='S'" : ''}`;
}

const quoted = (values: readonly string[]): string => [...new Set(values)].sort().map((v) => `'${v}'`).join(',');

/**
 * AirportDirectory backed by the public FAA ArcGIS REST API. No key is required. The layer is the FAA's
 * facility register, not a commercial-service list: use Part 139 data and traffic data to judge service.
 */
export class FaaAirportDirectory implements AirportDirectory {
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: FaaAirportDirectoryOptions) {
    this.baseUrl = options.baseUrl ?? FAA_FACILITIES_URL;
    this.now = options.now ?? (() => new Date());
  }

  async airportsByCode(codes: readonly AirportCode[]): Promise<Sourced<readonly Airport[]>> {
    if (codes.length === 0) return { data: [], provenance: this.provenance(undefined) };
    if (codes.length > MAX_CODES_PER_REQUEST) {
      throw new ProviderError('faa-arcgis', 'invalid-request', `at most ${MAX_CODES_PER_REQUEST} codes per request, got ${codes.length}`);
    }
    return this.query(codesFilter(codes.map((c) => AirportCodeSchema.parse(c))));
  }

  async airportsInStates(query: AirportsInStates): Promise<Sourced<readonly Airport[]>> {
    if (query.states.length === 0) return { data: [], provenance: this.provenance(undefined) };
    return this.query(statesFilter(query));
  }

  async searchAirports({ text, scheduledServiceOnly, limit }: AirportTextSearch): Promise<Sourced<readonly Airport[]>> {
    const filter = searchFilter({ text, scheduledServiceOnly });
    if (!filter) return { data: [], provenance: this.provenance(undefined) };
    const { fetch, timeoutMs } = this.options;
    // One bounded page: a search that matches more than this is too broad to be useful and is reported as such by the caller.
    const result = mapFacilityPage(
      await getJson({ source: 'faa-arcgis', url: buildFacilitiesUrl(this.baseUrl, filter, 0, Math.min(Math.max(limit, 1), MAX_SEARCH_RECORDS) + 1), fetch, ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
    );
    return { data: assertUnique(result.airports), provenance: this.provenance(result.effectiveDate) };
  }

  private async query(filter: string): Promise<Sourced<readonly Airport[]>> {
    const airports: Airport[] = [];
    let effectiveDate: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { fetch, timeoutMs } = this.options;
      const result = mapFacilityPage(
        await getJson({ source: 'faa-arcgis', url: buildFacilitiesUrl(this.baseUrl, filter, page * PAGE_SIZE), fetch, ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
      );
      airports.push(...result.airports);
      if (result.effectiveDate && (!effectiveDate || result.effectiveDate > effectiveDate)) effectiveDate = result.effectiveDate;
      if (!result.exceededTransferLimit) return { data: assertUnique(airports), provenance: this.provenance(effectiveDate) };
    }
    throw new ProviderError('faa-arcgis', 'invalid-response', `result exceeds ${MAX_PAGES * PAGE_SIZE} facilities`);
  }

  private provenance(effectiveDate: string | undefined): Provenance {
    return {
      source: 'faa-arcgis',
      dataset: DATASET,
      retrievedAt: this.now().toISOString(),
      ...(effectiveDate === undefined ? {} : { effectiveDate }),
    };
  }
}

function assertUnique(airports: Airport[]): Airport[] {
  const seen = new Set<string>();
  for (const { code } of airports) {
    if (seen.has(code)) throw new ProviderError('faa-arcgis', 'invalid-response', `duplicate facility ${code}`);
    seen.add(code);
  }
  return airports;
}
