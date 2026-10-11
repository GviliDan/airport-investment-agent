import type { Airport } from '../domain/airport';
import type { AirportCode, StateCode } from '../domain/codes';
import type { AirportDelaySnapshot } from '../domain/delays';
import type { Period } from '../domain/period';
import type { Sourced } from '../domain/provenance';
import type { RouteFrequency } from '../domain/routes';
import type { AirportMonthlyTraffic } from '../domain/traffic';

/**
 * What the application needs from the outside world. Each port has one real implementation (a public API client in
 * `infrastructure/`); the seam exists so the analytics service can be tested with fakes and no network.
 */

export interface AirportsInStates {
  readonly states: readonly StateCode[];
  /** Restrict to airports open to the public. Candidate discovery normally wants this. */
  readonly publicUseOnly: boolean;
}

export interface AirportTextSearch {
  /** Free text: a code, a city or part of a facility name. */
  readonly text: string;
  /** Restrict to airports with scheduled air-carrier service (FAA Part 139 scheduled). */
  readonly scheduledServiceOnly: boolean;
  readonly limit: number;
}

/** Airport metadata: identity, state, coordinates and facility classification. */
export interface AirportDirectory {
  /** Airports with the given codes; codes the directory does not know are simply not returned. */
  airportsByCode(codes: readonly AirportCode[]): Promise<Sourced<readonly Airport[]>>;
  /** Every airport (site type "airport") in the given states, ordered by state then code. */
  airportsInStates(query: AirportsInStates): Promise<Sourced<readonly Airport[]>>;
  /**
   * Public-use airports whose code, city or name match the text. At most `limit` + 1 are returned so a caller can
   * tell that more matched; order is not by relevance.
   */
  searchAirports(query: AirportTextSearch): Promise<Sourced<readonly Airport[]>>;
}

export interface TrafficQuery {
  readonly airports: readonly AirportCode[];
  readonly period: Period;
}

/** Historical monthly passengers, seats and departures per origin airport. */
export interface TrafficProvider {
  /** The first and last months the source currently publishes. */
  availablePeriod(): Promise<Sourced<Period>>;
  /**
   * Records for the requested airports and months, ordered by airport then month. An airport-month the
   * source does not report is simply absent; it is never filled in with zeros.
   */
  monthlyTraffic(query: TrafficQuery): Promise<Sourced<readonly AirportMonthlyTraffic[]>>;
}

/** Where an airport's scheduled flights go and how often. */
export interface RouteNetworkProvider {
  /** Routes departing `origin` with average daily scheduled flights over a recent period. */
  dailyRoutes(origin: AirportCode): Promise<Sourced<readonly RouteFrequency[]>>;
}

/** Local date-time at the airport, formatted `YYYY-MM-DDTHH:mm`. */
type LocalDateTime = string;

export interface DelayWindowQuery {
  readonly airport: AirportCode;
  readonly from: LocalDateTime;
  /** Must be after `from` and at most 12 hours later, the source's limit for one request. */
  readonly to: LocalDateTime;
}

/** Delay and cancellation statistics for an airport over a short window. */
export interface AirportDelayProvider {
  delaySnapshots(query: DelayWindowQuery): Promise<Sourced<readonly AirportDelaySnapshot[]>>;
}
