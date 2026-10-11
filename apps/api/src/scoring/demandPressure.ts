import type { AirportCode } from '../domain/codes';
import type { Period } from '../domain/period';
import type { Provenance } from '../domain/provenance';
import type { MissingInput } from '../analytics/common';
import type { AirportDelaySummary } from '../analytics/congestion/delaySummary';
import type { GrowthOutcome, TrafficTrendResult } from '../analytics/traffic/trafficTrend';
import {
  DEMAND_PRESSURE_COMPONENTS,
  DEMAND_PRESSURE_NOTICE,
  DEMAND_PRESSURE_MIN_COMPONENTS,
  DEMAND_PRESSURE_PROFILE,
  PRESSURE_BAND_EDGES,
  type DemandPressureComponentId,
  type PressureBand,
} from './scoringConfig';

export type PressureConfidence = 'medium' | 'low' | 'insufficient';

export type PressureComponent =
  | {
      readonly id: DemandPressureComponentId;
      readonly label: string;
      readonly status: 'available';
      readonly raw: number;
      readonly lowerBound: number;
      readonly upperBound: number;
      /** Bounded 0-100 transformation of the raw value. */
      readonly pressure: number;
      readonly configuredWeight: number;
      readonly effectiveWeight: number;
      /** pressure x effectiveWeight: points this component adds to the score. */
      readonly contribution: number;
    }
  | { readonly id: DemandPressureComponentId; readonly label: string; readonly status: 'missing'; readonly reason: string; readonly configuredWeight: number };

export interface DemandPressureResult {
  readonly profile: typeof DEMAND_PRESSURE_PROFILE;
  readonly airport: AirportCode;
  /** Full precision, 0-100. Undefined when fewer than three numeric components exist. Round only for display. */
  readonly score: number | undefined;
  readonly band: PressureBand | undefined;
  readonly rawMetrics: {
    readonly loadFactorPercent: number | undefined;
    readonly passengerGrowth: number | undefined;
    readonly seatGrowth: number | undefined;
    /** passenger growth - seat growth, as a fraction (0.01 = 1 percentage point). */
    readonly passengerSeatGrowthGap: number | undefined;
    readonly departureGrowth: number | undefined;
  };
  readonly components: readonly PressureComponent[];
  readonly weights: readonly { readonly id: DemandPressureComponentId; readonly weight: number }[];
  readonly availableComponents: number;
  readonly expectedComponents: number;
  readonly missingSignals: readonly MissingInput[];
  readonly confidence: PressureConfidence;
  readonly periods: { readonly trafficCurrent: Period; readonly trafficPrevious: Period };
  /**
   * Operational context. It never enters the score: a delay window is a short sample, and schedule
   * disruption is neither terminal capacity nor unmet demand.
   */
  readonly operationalContext:
    | { readonly status: 'not-requested' }
    | { readonly status: 'available'; readonly departureDelayIndex: number | undefined; readonly departureCancellationRate: number | undefined; readonly delay: AirportDelaySummary };
  readonly assumptions: readonly string[];
  readonly notice: typeof DEMAND_PRESSURE_NOTICE;
  readonly provenance: readonly Provenance[];
}

export const PRESSURE_ASSUMPTIONS: readonly string[] = [
  `Profile ${DEMAND_PRESSURE_PROFILE}: score = sum of component pressure x weight (${DEMAND_PRESSURE_COMPONENTS.map((c) => `${c.label} ${c.weight * 100}%`).join(', ')}).`,
  `Each component is a linear interpolation clamped to 0-100 between a lower and an upper bound (${DEMAND_PRESSURE_COMPONENTS.map((c) => `${c.label}: ${c.lowerBound} -> 0, ${c.upperBound} -> 100`).join('; ')}). Growth values are fractions; load factor is in percent.`,
  'The bounds and weights are MVP analytical assumptions, not industry-standard or regulatory thresholds. The score is absolute: it does not depend on other airports.',
  'Bands: below 25 low, 25 to below 50 moderate, 50 to below 75 elevated, 75 to 100 high.',
  `A missing component is never treated as zero: its weight is removed and the rest renormalized. With fewer than ${DEMAND_PRESSURE_MIN_COMPONENTS} of 4 components no score is issued. Confidence is never above medium.`,
  'Delay and cancellation data are shown as operational context and do not change the score. Schedule disruption is not terminal capacity and delay is not unmet demand.',
  'Passenger growth is not demand by itself, and load factor is not terminal capacity.',
];

/** Linear interpolation of `value` between the bounds, clamped to 0-100. */
export function boundedPressure(value: number, lowerBound: number, upperBound: number): number {
  if (value <= lowerBound) return 0;
  if (value >= upperBound) return 100;
  return (100 * (value - lowerBound)) / (upperBound - lowerBound);
}

export function pressureBand(score: number): PressureBand {
  if (score >= PRESSURE_BAND_EDGES.high) return 'high';
  if (score >= PRESSURE_BAND_EDGES.elevated) return 'elevated';
  if (score >= PRESSURE_BAND_EDGES.moderate) return 'moderate';
  return 'low';
}

const growthValue = (outcome: GrowthOutcome): number | undefined => (outcome.status === 'available' ? outcome.rate : undefined);
const growthReason = (outcome: GrowthOutcome): string => (outcome.status === 'available' ? '' : outcome.reason);

/**
 * Scores one airport from its BTS traffic trend. The optional delay summary is carried as operational context
 * only: it never enters the score or the confidence.
 */
export function scoreDemandPressure(traffic: TrafficTrendResult, delay?: AirportDelaySummary): DemandPressureResult {
  const passengerGrowth = growthValue(traffic.growth.passengers);
  const seatGrowth = growthValue(traffic.growth.seats);
  const departureGrowth = growthValue(traffic.growth.departures);
  const loadFactorPercent = traffic.current.totals?.loadFactorPercent;
  const gap = passengerGrowth !== undefined && seatGrowth !== undefined ? passengerGrowth - seatGrowth : undefined;
  const raw: Record<DemandPressureComponentId, number | undefined> = { loadFactor: loadFactorPercent, passengerGrowth, growthGap: gap, departureGrowth };
  const reasons: Record<DemandPressureComponentId, string> = {
    loadFactor: traffic.current.totals ? 'no seats reported in the current period' : `current period is missing ${traffic.current.missingMonths.length} month(s)`,
    passengerGrowth: growthReason(traffic.growth.passengers),
    growthGap: passengerGrowth === undefined ? 'needs passenger growth' : 'needs seat growth',
    departureGrowth: growthReason(traffic.growth.departures),
  };

  const availableWeight = DEMAND_PRESSURE_COMPONENTS.reduce((sum, c) => (raw[c.id] === undefined ? sum : sum + c.weight), 0);
  const components: PressureComponent[] = DEMAND_PRESSURE_COMPONENTS.map((c): PressureComponent => {
    const value = raw[c.id];
    if (value === undefined) return { id: c.id, label: c.label, status: 'missing', reason: reasons[c.id], configuredWeight: c.weight };
    const pressure = boundedPressure(value, c.lowerBound, c.upperBound);
    const effectiveWeight = c.weight / availableWeight;
    return { id: c.id, label: c.label, status: 'available', raw: value, lowerBound: c.lowerBound, upperBound: c.upperBound, pressure, configuredWeight: c.weight, effectiveWeight, contribution: pressure * effectiveWeight };
  });

  const available = components.filter((c) => c.status === 'available').length;
  const scored = available >= DEMAND_PRESSURE_MIN_COMPONENTS;
  const score = scored ? components.reduce((sum, c) => (c.status === 'available' ? sum + c.contribution : sum), 0) : undefined;
  const missingSignals: MissingInput[] = components.flatMap((c) => (c.status === 'missing' ? [{ input: c.label, reason: c.reason }] : []));

  return {
    profile: DEMAND_PRESSURE_PROFILE,
    airport: traffic.airport,
    score,
    band: score === undefined ? undefined : pressureBand(score),
    rawMetrics: { loadFactorPercent, passengerGrowth, seatGrowth, passengerSeatGrowthGap: gap, departureGrowth },
    components,
    weights: DEMAND_PRESSURE_COMPONENTS.map(({ id, weight }) => ({ id, weight })),
    availableComponents: available,
    expectedComponents: components.length,
    missingSignals,
    confidence: !scored ? 'insufficient' : available === components.length ? 'medium' : 'low',
    periods: { trafficCurrent: traffic.current.period, trafficPrevious: traffic.previous.period },
    operationalContext: delay
      ? { status: 'available', departureDelayIndex: delay.departures?.meanDelayIndex, departureCancellationRate: delay.departures?.cancellationRate, delay }
      : { status: 'not-requested' },
    assumptions: [...PRESSURE_ASSUMPTIONS, ...traffic.assumptions],
    notice: DEMAND_PRESSURE_NOTICE,
    provenance: [...traffic.provenance, ...(delay?.provenance ?? [])],
  };
}
