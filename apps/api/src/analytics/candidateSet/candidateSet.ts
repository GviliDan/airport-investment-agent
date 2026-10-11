import type { Airport } from '../../domain/airport';
import type { StateCode } from '../../domain/codes';
import { monthsInPeriod, type Period } from '../../domain/period';
import type { Provenance } from '../../domain/provenance';
import type { AirportMonthlyTraffic } from '../../domain/traffic';
import { CANDIDATE_MIN_ANNUAL_PASSENGERS, NEW_ENGLAND_STATES } from '../assumptions';

export type ExclusionReason =
  | 'outside-region'
  | 'not-public-use'
  /** BTS has no record for the airport in the period (for most small general-aviation fields). */
  | 'no-traffic-data'
  | 'below-passenger-threshold'
  /** Under the threshold, but months are missing, so the airport cannot be proven to be below it. */
  | 'insufficient-traffic-data';

export interface CandidateActivity {
  /** Passengers over the months that have BTS data. */
  readonly passengers: number;
  readonly monthsWithData: number;
  readonly monthsExpected: number;
  readonly complete: boolean;
}

export interface EligibleCandidate {
  readonly airport: Airport;
  readonly activity: CandidateActivity;
}

export interface ExcludedAirport {
  readonly airport: Airport;
  readonly reason: ExclusionReason;
  readonly detail: string;
  /** Absent when BTS has no record for the airport. */
  readonly activity: CandidateActivity | undefined;
}

export interface CandidateSetResult {
  readonly states: readonly StateCode[];
  readonly period: Period;
  readonly minAnnualPassengers: number;
  readonly eligible: readonly EligibleCandidate[];
  readonly excluded: readonly ExcludedAirport[];
  readonly assumptions: readonly string[];
  readonly provenance: readonly Provenance[];
}

export const candidateAssumptions = (minAnnualPassengers: number): string[] => [
  'Candidates are public-use airports in CT, ME, MA, NH, RI and VT as listed by the FAA.',
  `An airport is an eligible commercial-activity candidate when BTS reports at least ${minAnnualPassengers} passengers over the period. Part 139 certification is not used to decide eligibility.`,
  'BTS passengers are those carried on flights departing the airport (segment data, connecting passengers included, cargo excluded). They approximate, and are not identical to, FAA enplanements, and the period is a rolling 12 months rather than a calendar year.',
  `The ${minAnnualPassengers}-passenger threshold borrows the FAA's annual-enplanement threshold for a primary commercial-service airport as an explicit approximation.`,
  'An airport with no BTS record is excluded as having no traffic data, never counted as zero passengers.',
  'Eligibility is not ranking: no ordering beyond the airport code is implied.',
];

export interface CandidateSetInput {
  /** Airports to classify, as discovered from the FAA. Anything outside the region or not public-use is excluded explicitly. */
  readonly airports: readonly Airport[];
  readonly traffic: readonly AirportMonthlyTraffic[];
  readonly period: Period;
  readonly provenance: readonly Provenance[];
  readonly states?: readonly StateCode[];
  readonly minAnnualPassengers?: number;
}

export function buildCandidateSet({
  airports,
  traffic,
  period,
  provenance,
  states = NEW_ENGLAND_STATES,
  minAnnualPassengers = CANDIDATE_MIN_ANNUAL_PASSENGERS,
}: CandidateSetInput): CandidateSetResult {
  const expected = monthsInPeriod(period);
  const inPeriod = new Set<string>(expected);
  const byAirport = new Map<string, Map<string, number>>();
  for (const row of traffic) {
    if (!inPeriod.has(row.month)) continue;
    const months = byAirport.get(row.airport) ?? new Map<string, number>();
    if (months.has(row.month)) throw new Error(`duplicate traffic record for ${row.airport} ${row.month}`);
    months.set(row.month, row.passengers);
    byAirport.set(row.airport, months);
  }

  const eligible: EligibleCandidate[] = [];
  const excluded: ExcludedAirport[] = [];
  for (const airport of [...airports].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))) {
    const exclude = (reason: ExclusionReason, detail: string, activity?: CandidateActivity): void => {
      excluded.push({ airport, reason, detail, activity });
    };
    if (!states.includes(airport.state)) {
      exclude('outside-region', `state ${airport.state} is not one of ${states.join(', ')}`);
      continue;
    }
    if (airport.use !== 'public') {
      exclude('not-public-use', 'the FAA lists the facility as private use');
      continue;
    }
    const months = byAirport.get(airport.code);
    if (!months) {
      exclude('no-traffic-data', `BTS has no traffic record for ${period.start}..${period.end}`);
      continue;
    }
    const passengers = [...months.values()].reduce((sum, value) => sum + value, 0);
    const activity: CandidateActivity = { passengers, monthsWithData: months.size, monthsExpected: expected.length, complete: months.size === expected.length };
    if (passengers >= minAnnualPassengers) eligible.push({ airport, activity });
    else if (activity.complete) exclude('below-passenger-threshold', `${passengers} passengers is below ${minAnnualPassengers}`, activity);
    else exclude('insufficient-traffic-data', `${passengers} passengers in ${activity.monthsWithData} of ${activity.monthsExpected} months; cannot show the full period is below ${minAnnualPassengers}`, activity);
  }

  return { states, period, minAnnualPassengers, eligible, excluded, assumptions: candidateAssumptions(minAnnualPassengers), provenance };
}
