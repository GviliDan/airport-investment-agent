import type { AirportCode } from '../domain/codes';
import type { Period } from '../domain/period';
import type { Provenance } from '../domain/provenance';
import type { Airport } from '../domain/airport';
import type { CandidateSetResult } from '../analytics/candidateSet/candidateSet';
import type { GrowthOutcome, TrafficTrendResult } from '../analytics/traffic/trafficTrend';
import { percentileScores } from './percentile';
import {
  RANKING_SCOPE_NOTICE,
  TERMINAL_EXPANSION_FACTORS,
  TERMINAL_EXPANSION_INTERPRETATION_NOTICE,
  TERMINAL_EXPANSION_MIN_FACTORS,
  TERMINAL_EXPANSION_PROFILE,
  type TerminalExpansionFactorId,
} from './scoringConfig';

export type FactorResult =
  | {
      readonly id: TerminalExpansionFactorId;
      readonly label: string;
      readonly status: 'available';
      readonly raw: number;
      /** 0-100 position among the candidates that have this factor. */
      readonly percentile: number;
      readonly configuredWeight: number;
      /** Weight after removing missing factors and renormalizing to 1. */
      readonly effectiveWeight: number;
      /** percentile x effectiveWeight: points this factor adds to the final score. */
      readonly contribution: number;
    }
  | {
      readonly id: TerminalExpansionFactorId;
      readonly label: string;
      readonly status: 'missing';
      readonly reason: string;
      readonly configuredWeight: number;
    };

export type RankingConfidence = 'high' | 'medium' | 'low';

interface ScoredBase {
  readonly airport: Pick<Airport, 'code' | 'name' | 'city' | 'state'>;
  readonly factors: readonly FactorResult[];
  readonly missingFactors: readonly TerminalExpansionFactorId[];
  readonly factorsAvailable: number;
  readonly factorsExpected: number;
}

export interface RankedAirport extends ScoredBase {
  readonly rank: number;
  /** Full precision. Round only for display. */
  readonly score: number;
  /** high: all five factors; medium: four; low: three. */
  readonly confidence: RankingConfidence;
}

export interface UnscoredAirport extends ScoredBase {
  readonly reason: string;
}

export interface TerminalExpansionRanking {
  readonly profile: typeof TERMINAL_EXPANSION_PROFILE;
  readonly region: { readonly name: string; readonly states: CandidateSetResult['states'] };
  readonly observation: { readonly current: Period; readonly previous: Period };
  /** Airports that passed the candidate-set eligibility rule. */
  readonly candidateCount: number;
  readonly rankedCount: number;
  readonly weights: readonly { readonly id: TerminalExpansionFactorId; readonly label: string; readonly weight: number; readonly rawMetric: string; readonly interpretation: string }[];
  readonly ranked: readonly RankedAirport[];
  readonly unscored: readonly UnscoredAirport[];
  /** Region airports that did not pass eligibility, with reasons, so nothing is dropped silently. */
  readonly excludedCount: number;
  readonly excluded: CandidateSetResult['excluded'];
  readonly scopeNotice: typeof RANKING_SCOPE_NOTICE;
  readonly interpretationNotice: string;
  readonly assumptions: readonly string[];
  readonly provenance: readonly Provenance[];
}

export const RANKING_ASSUMPTIONS: readonly string[] = [
  `Profile ${TERMINAL_EXPANSION_PROFILE}: score = sum over the five factors of (percentile x weight), weights ${TERMINAL_EXPANSION_FACTORS.map((f) => `${f.label} ${f.weight * 100}%`).join(', ')}.`,
  'Each factor is converted to a 0-100 mid-rank percentile among the candidates that have it: 100 x (below + (equal - 1) / 2) / (n - 1); 50 when n = 1 or all values are equal; tied values share one percentile.',
  'Ranking is by score descending, then airport code ascending. Ranks are sequential, so tied scores still receive distinct ranks.',
  'A missing factor is never treated as zero: its weight is removed and the remaining weights are renormalized to 100% for that airport. At least three factors are needed to be scored.',
  'Only annual BTS signals are used. AeroDataBox delay snapshots are excluded: they are short, partial samples and not representative of an annual ranking.',
  'Passenger growth is not demand by itself, load factor is not terminal capacity, and the gap between passenger and seat growth is an indicator, not a measurement of terminal shortfall.',
  'All weights and thresholds are transparent MVP assumptions, not industry standards.',
];

const growth = (outcome: GrowthOutcome): { value: number } | { reason: string } =>
  outcome.status === 'available' ? { value: outcome.rate } : { reason: outcome.reason };

/** The raw value of each factor for one airport, or the reason it is missing. */
function rawFactors(trend: TrafficTrendResult): Record<TerminalExpansionFactorId, { value: number } | { reason: string }> {
  const totals = trend.current.totals;
  const passengers = growth(trend.growth.passengers);
  const seats = growth(trend.growth.seats);
  const gap =
    'value' in passengers && 'value' in seats
      ? { value: passengers.value - seats.value }
      : { reason: `needs passenger and seat growth (${'reason' in passengers ? `passengers: ${passengers.reason}` : ''}${'reason' in seats ? ` seats: ${seats.reason}` : ''})`.replace('( ', '(') };
  return {
    passengerScale: totals ? { value: totals.passengers } : { reason: `current period incomplete (${trend.current.missingMonths.length} months missing)` },
    passengerGrowth: passengers,
    demandCapacityGrowthGap: gap,
    departureGrowth: growth(trend.growth.departures),
    loadFactor: totals?.loadFactorPercent !== undefined ? { value: totals.loadFactorPercent } : { reason: totals ? 'no seats reported' : 'current period incomplete' },
  };
}

export interface TerminalExpansionInput {
  readonly candidates: CandidateSetResult;
  /** One traffic trend per eligible candidate. A candidate without one is reported unscored. */
  readonly trends: readonly TrafficTrendResult[];
  readonly regionName: string;
  readonly windows: { readonly current: Period; readonly previous: Period };
  readonly trafficProvenance: readonly Provenance[];
}

export function rankTerminalExpansion({ candidates, trends, regionName, windows, trafficProvenance }: TerminalExpansionInput): TerminalExpansionRanking {
  const trendByAirport = new Map<AirportCode, TrafficTrendResult>(trends.map((t) => [t.airport, t]));
  const eligible = candidates.eligible.map((c) => c.airport);
  const raws = eligible.map((airport) => {
    const trend = trendByAirport.get(airport.code);
    return trend ? rawFactors(trend) : undefined;
  });

  // Percentiles per factor, among the candidates that have the factor.
  const percentiles = new Map<TerminalExpansionFactorId, Map<number, number>>();
  for (const factor of TERMINAL_EXPANSION_FACTORS) {
    const present: { index: number; value: number }[] = [];
    raws.forEach((raw, index) => {
      const entry = raw?.[factor.id];
      if (entry && 'value' in entry) present.push({ index, value: entry.value });
    });
    const scores = percentileScores(present.map((p) => p.value));
    percentiles.set(factor.id, new Map(present.map((p, i) => [p.index, scores[i] ?? 50])));
  }

  const ranked: Omit<RankedAirport, 'rank'>[] = [];
  const unscored: UnscoredAirport[] = [];
  eligible.forEach((airport, index) => {
    const raw = raws[index];
    const identity = { code: airport.code, name: airport.name, city: airport.city, state: airport.state };
    const availableWeight = TERMINAL_EXPANSION_FACTORS.reduce((sum, f) => (raw && 'value' in raw[f.id] ? sum + f.weight : sum), 0);
    const factors: FactorResult[] = TERMINAL_EXPANSION_FACTORS.map((f): FactorResult => {
      const entry = raw?.[f.id];
      if (!entry || 'reason' in entry) {
        return { id: f.id, label: f.label, status: 'missing', reason: entry ? entry.reason : 'no traffic trend was provided', configuredWeight: f.weight };
      }
      const percentile = percentiles.get(f.id)?.get(index) ?? 50;
      const effectiveWeight = f.weight / availableWeight;
      return { id: f.id, label: f.label, status: 'available', raw: entry.value, percentile, configuredWeight: f.weight, effectiveWeight, contribution: percentile * effectiveWeight };
    });
    const missingFactors = factors.filter((f) => f.status === 'missing').map((f) => f.id);
    const factorsAvailable = factors.length - missingFactors.length;
    const base = { airport: identity, factors, missingFactors, factorsAvailable, factorsExpected: factors.length };
    if (factorsAvailable < TERMINAL_EXPANSION_MIN_FACTORS) {
      unscored.push({ ...base, reason: `only ${factorsAvailable} of ${factors.length} factors available; at least ${TERMINAL_EXPANSION_MIN_FACTORS} are needed` });
      return;
    }
    const score = factors.reduce((sum, f) => (f.status === 'available' ? sum + f.contribution : sum), 0);
    ranked.push({ ...base, score, confidence: factorsAvailable === factors.length ? 'high' : factorsAvailable === factors.length - 1 ? 'medium' : 'low' });
  });

  ranked.sort((a, b) => b.score - a.score || (a.airport.code < b.airport.code ? -1 : a.airport.code > b.airport.code ? 1 : 0));

  return {
    profile: TERMINAL_EXPANSION_PROFILE,
    region: { name: regionName, states: candidates.states },
    observation: windows,
    candidateCount: eligible.length,
    rankedCount: ranked.length,
    weights: TERMINAL_EXPANSION_FACTORS.map(({ id, label, weight, rawMetric, interpretation }) => ({ id, label, weight, rawMetric, interpretation })),
    ranked: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
    unscored,
    excludedCount: candidates.excluded.length,
    excluded: candidates.excluded,
    scopeNotice: RANKING_SCOPE_NOTICE,
    interpretationNotice: TERMINAL_EXPANSION_INTERPRETATION_NOTICE,
    assumptions: [...RANKING_ASSUMPTIONS, ...candidates.assumptions],
    provenance: [...candidates.provenance, ...trafficProvenance],
  };
}
