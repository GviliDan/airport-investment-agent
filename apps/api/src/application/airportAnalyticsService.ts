import { buildCandidateSet, type CandidateSetResult } from '../analytics/candidateSet/candidateSet';
import { NEW_ENGLAND_STATES } from '../analytics/assumptions';
import { summarizeDelays, type AirportDelaySummary } from '../analytics/congestion/delaySummary';
import { computeLongHaulShare, type LongHaulShareResult } from '../analytics/longHaul/longHaul';
import { computeTrafficTrend, deriveComparableWindows, type TrafficTrendResult } from '../analytics/traffic/trafficTrend';
import { rankTerminalExpansion, type TerminalExpansionRanking } from '../scoring/terminalExpansion';
import { scoreDemandPressure, type DemandPressureResult } from '../scoring/demandPressure';
import type { Airport } from '../domain/airport';
import type { AirportCode } from '../domain/codes';
import { recentLocalWindow } from '../domain/timezone';
import type { Provenance } from '../domain/provenance';
import type { Period } from '../domain/period';
import { AirportNotFoundError, AnalysisUnavailableError } from './errors';
import type { AirportDelayProvider, AirportDirectory, DelayWindowQuery, RouteNetworkProvider, TrafficProvider } from './ports';

export interface AirportAnalyticsPorts {
  readonly airports: AirportDirectory;
  readonly traffic: TrafficProvider;
  /** AeroDataBox-backed ports are absent when no API key is configured. */
  readonly routes: RouteNetworkProvider | undefined;
  readonly delays: AirportDelayProvider | undefined;
}

export type DelayWindow = Pick<DelayWindowQuery, 'from' | 'to'>;

/** Hours of recent history used when no delay window is given. The source allows at most 12 per request. */
export const DEFAULT_DELAY_WINDOW_HOURS = 12;
/** Most candidates returned for a text reference. */
const MAX_RESOLVED_CANDIDATES = 8;
const SEARCH_FETCH_LIMIT = 200;

/**
 * References that are ambiguous in a text search but have one obvious meaning for this product ("LA" matches dozens
 * of cities). They resolve to a fixed airport; every other reference keeps the normal ambiguity behavior.
 */
const AIRPORT_ALIASES: Readonly<Record<string, AirportCode>> = {
  LA: 'LAX' as AirportCode,
  'LOS ANGELES': 'LAX' as AirportCode,
  'LOS ANGELES AIRPORT': 'LAX' as AirportCode,
  'LA AIRPORT': 'LAX' as AirportCode,
};

export interface AirportResolution {
  readonly query: string;
  /** "exact-code" when the text is a known airport code; "text" when it was matched against city and facility names. */
  readonly matchType: 'exact-code' | 'alias' | 'text' | 'none';
  /** More than one plausible airport: the caller must pick one or ask, never guess. */
  readonly ambiguous: boolean;
  /** More airports matched than are listed. */
  readonly truncated: boolean;
  /** Whether matches were limited to airports with scheduled air-carrier service. */
  readonly scheduledServiceOnly: boolean;
  readonly candidates: readonly Airport[];
  readonly provenance: Provenance;
}

export interface AirportProfile {
  readonly airport: Airport;
  readonly traffic: TrafficTrendResult;
  readonly provenance: readonly Provenance[];
}

export interface CongestionSide {
  readonly airport: Airport;
  /** The window requested, in the airport's local time. */
  readonly requestedWindow: DelayWindow;
  readonly summary: AirportDelaySummary;
}

export interface CongestionComparison {
  readonly sides: readonly [CongestionSide, CongestionSide];
}

/**
 * Fetches only what an analysis needs from the providers and hands it to the pure analytics. Nothing is
 * fetched in advance, so AeroDataBox quota is spent only when a route or delay analysis is requested.
 */
export class AirportAnalyticsService {
  constructor(
    private readonly ports: AirportAnalyticsPorts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Turns a natural-language reference into FAA airports. An exact code resolves directly; otherwise city and
   * facility names are searched, preferring airports with scheduled air-carrier service. Several candidates are
   * returned as ambiguous rather than choosing one. Free (FAA only).
   */
  async resolveAirports(text: string): Promise<AirportResolution> {
    const query = text.trim();
    const base = { query, truncated: false, scheduledServiceOnly: false };
    const aliased = AIRPORT_ALIASES[query.toUpperCase().replace(/\s+/g, ' ')];
    if (aliased) {
      const direct = await this.ports.airports.airportsByCode([aliased]);
      const [match] = direct.data;
      if (match) return { ...base, matchType: 'alias', ambiguous: false, candidates: [match], provenance: direct.provenance };
    }
    if (/^[A-Za-z0-9]{3}$/.test(query)) {
      const exact = await this.ports.airports.airportsByCode([query.toUpperCase() as AirportCode]);
      const [match] = exact.data;
      if (match) return { ...base, matchType: 'exact-code', ambiguous: false, candidates: [match], provenance: exact.provenance };
    }
    let found = await this.ports.airports.searchAirports({ text: query, scheduledServiceOnly: true, limit: SEARCH_FETCH_LIMIT });
    let scheduledServiceOnly = true;
    if (found.data.length === 0) {
      found = await this.ports.airports.searchAirports({ text: query, scheduledServiceOnly: false, limit: SEARCH_FETCH_LIMIT });
      scheduledServiceOnly = false;
    }
    const needle = query.toUpperCase();
    const rank = (a: Airport): number => (a.city === needle ? 0 : a.city.startsWith(needle) || a.name.startsWith(needle) ? 1 : 2);
    const sorted = [...found.data].sort(
      (a, b) => rank(a) - rank(b) || Number(b.part139?.service === 'scheduled') - Number(a.part139?.service === 'scheduled') || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
    return {
      query,
      matchType: sorted.length === 0 ? 'none' : 'text',
      ambiguous: sorted.length > 1,
      truncated: sorted.length > MAX_RESOLVED_CANDIDATES,
      scheduledServiceOnly,
      candidates: sorted.slice(0, MAX_RESOLVED_CANDIDATES),
      provenance: found.provenance,
    };
  }

  /** One FAA airport by code. Free. */
  async lookupAirport(code: AirportCode): Promise<Airport> {
    const [airport] = (await this.ports.airports.airportsByCode([code])).data;
    if (!airport) throw new AirportNotFoundError(code);
    return airport;
  }

  /** Descriptive FAA identity plus the BTS traffic trend. No AeroDataBox. */
  async airportProfile(code: AirportCode): Promise<AirportProfile> {
    const [airport, traffic] = await Promise.all([this.lookupAirport(code), this.trafficTrend(code)]);
    return { airport, traffic, provenance: traffic.provenance };
  }

  /** The most recent hours in the airport's local time, for an airport whose state is known. */
  async recentDelayWindow(code: AirportCode): Promise<DelayWindow> {
    return this.recentWindowFor(await this.lookupAirport(code));
  }

  /**
   * Delay summaries of two airports side by side. Without a window each airport gets the most recent
   * 12 hours in its own local time. Two AeroDataBox requests; no ranking or winner is computed.
   */
  async compareCongestion(first: AirportCode, second: AirportCode, window?: DelayWindow): Promise<CongestionComparison> {
    if (!this.ports.delays) throw new AnalysisUnavailableError('Delay analysis needs AeroDataBox, which is not configured (set AERODATABOX_API_KEY)');
    if (first === second) throw new AnalysisUnavailableError('Two different airports are needed for a comparison');
    const airports = await this.ports.airports.airportsByCode([first, second]);
    const find = (code: AirportCode): Airport => {
      const airport = airports.data.find((a) => a.code === code);
      if (!airport) throw new AirportNotFoundError(code);
      return airport;
    };
    // Resolve everything that can fail (unknown airports, unknown time zone) before spending any AeroDataBox quota.
    const targets = [find(first), find(second)].map((airport) => ({ airport, requestedWindow: window ?? this.recentWindowFor(airport) }));
    const [a, b] = await Promise.all(targets.map(async ({ airport, requestedWindow }): Promise<CongestionSide> => ({ airport, requestedWindow, summary: await this.delaySummary(airport.code, requestedWindow) })));
    if (!a || !b) throw new AnalysisUnavailableError('Two airports are needed for a comparison');
    return { sides: [a, b] };
  }

  private recentWindowFor(airport: Airport): DelayWindow {
    const window = recentLocalWindow(airport.state, this.now(), DEFAULT_DELAY_WINDOW_HOURS);
    if (!window) throw new AnalysisUnavailableError(`No local time zone is known for state ${airport.state}; give an explicit window`);
    return window;
  }

  /** BTS passengers/seats/departures for the latest complete 12 months against the 12 before them. One BTS request. */
  async trafficTrend(airport: AirportCode): Promise<TrafficTrendResult> {
    const { current, previous } = await this.comparableWindows();
    const traffic = await this.ports.traffic.monthlyTraffic({ airports: [airport], period: { start: previous.start, end: current.end } });
    return computeTrafficTrend({ airport, currentPeriod: current, previousPeriod: previous, rows: traffic.data, provenance: traffic.provenance });
  }

  /** Share of scheduled departures on routes of at least the threshold distance. One FAA and one AeroDataBox request. */
  async longHaulShare(airport: AirportCode, options: { thresholdMiles?: number } = {}): Promise<LongHaulShareResult> {
    const routesPort = this.ports.routes;
    if (!routesPort) throw new AnalysisUnavailableError('Route analysis needs AeroDataBox, which is not configured (set AERODATABOX_API_KEY)');
    const [origin] = (await this.ports.airports.airportsByCode([airport])).data;
    if (!origin) throw new AirportNotFoundError(airport);
    const routes = await routesPort.dailyRoutes(airport);
    return computeLongHaulShare({
      origin: { code: origin.code, location: origin.location },
      routes: routes.data,
      provenance: routes.provenance,
      ...(options.thresholdMiles === undefined ? {} : { thresholdMiles: options.thresholdMiles }),
    });
  }

  /** Delay and cancellation summary for one window of at most 12 hours. One AeroDataBox request. */
  async delaySummary(airport: AirportCode, window: DelayWindow): Promise<AirportDelaySummary> {
    const delaysPort = this.ports.delays;
    if (!delaysPort) throw new AnalysisUnavailableError('Delay analysis needs AeroDataBox, which is not configured (set AERODATABOX_API_KEY)');
    const snapshots = await delaysPort.delaySnapshots({ airport, ...window });
    return summarizeDelays({ airport, snapshots: snapshots.data, provenance: snapshots.provenance });
  }

  /**
   * The deterministic New England terminal-expansion ranking. FAA and BTS only: three BTS requests (period,
   * candidate activity, 24-month traffic of the eligible airports) and one FAA request; AeroDataBox is never called.
   */
  async rankNewEnglandTerminalExpansion(): Promise<TerminalExpansionRanking> {
    const windows = await this.comparableWindows();
    const candidates = await this.candidates(windows);
    const codes = candidates.eligible.map((c) => c.airport.code);
    const traffic = codes.length === 0 ? undefined : await this.ports.traffic.monthlyTraffic({ airports: codes, period: { start: windows.previous.start, end: windows.current.end } });
    const trends = traffic
      ? codes.map((airport) => computeTrafficTrend({ airport, currentPeriod: windows.current, previousPeriod: windows.previous, rows: traffic.data, provenance: traffic.provenance }))
      : [];
    return rankTerminalExpansion({ candidates, trends, regionName: 'New England', windows, trafficProvenance: traffic ? [traffic.provenance] : [] });
  }

  /**
   * The Unmet Demand Pressure Proxy for one airport. The score comes from BTS alone; the AeroDataBox delay
   * window is fetched (and shown as context) only if one is given.
   */
  async unmetDemandPressure(airport: AirportCode, delayWindow?: DelayWindow | 'recent'): Promise<DemandPressureResult> {
    const window = delayWindow === 'recent' ? await this.recentDelayWindow(airport) : delayWindow;
    const traffic = await this.trafficTrend(airport);
    const delay = window ? await this.delaySummary(airport, window) : undefined;
    return scoreDemandPressure(traffic, delay);
  }

  private async candidates(windows: { current: Period; previous: Period }): Promise<CandidateSetResult> {
    const directory = await this.ports.airports.airportsInStates({ states: NEW_ENGLAND_STATES, publicUseOnly: true });
    const traffic = await this.ports.traffic.monthlyTraffic({ airports: directory.data.map((a) => a.code), period: windows.current });
    return buildCandidateSet({
      airports: directory.data,
      traffic: traffic.data,
      period: windows.current,
      provenance: [directory.provenance, traffic.provenance],
    });
  }

  private async comparableWindows(): Promise<{ current: Period; previous: Period }> {
    const available = await this.ports.traffic.availablePeriod();
    const windows = deriveComparableWindows(available.data);
    if (!windows) {
      throw new AnalysisUnavailableError(`BTS history ${available.data.start}..${available.data.end} is too short for two comparable 12-month windows`);
    }
    return windows;
  }
}
