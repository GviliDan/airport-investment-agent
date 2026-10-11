import type {
  AirportProfileArtifact,
  CongestionComparisonArtifact,
  DemandPressureArtifact,
  LongHaulArtifact,
  RankingArtifact,
} from '@airport/shared';
import type { Airport } from '../domain/airport';
import type { Provenance } from '../domain/provenance';
import type { AirportProfile, CongestionComparison } from '../application/airportAnalyticsService';
import type { DirectionDelaySummary } from '../analytics/congestion/delaySummary';
import type { LongHaulShareResult } from '../analytics/longHaul/longHaul';
import type { DemandPressureResult } from '../scoring/demandPressure';
import type { TerminalExpansionRanking } from '../scoring/terminalExpansion';

/**
 * Builds the wire artifacts from deterministic results. The same object is what the model reads as the tool
 * result and what the UI renders, so nothing is ever parsed back out of prose. Conversion to presentation
 * units (percent) and display rounding happen here, once, so the model never has to convert or round.
 */

const round = (value: number, digits: number): number => Number(value.toFixed(digits));
const percent = (fraction: number | undefined, digits = 2): number | null => (fraction === undefined ? null : round(fraction * 100, digits));
const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

export const LONG_HAUL_NOTICE =
  'This share is based on scheduled route frequency. Each route is weighted by averageDailyFlights, a rolling 7-day average of scheduled flights. It covers the listed service types (passenger and cargo), so it is not a passenger-only share, and it is not a share of performed flights.';
const CONGESTION_READING =
  `This comparison reflects schedule disruption during the observed window and should not be interpreted as a direct measure of terminal capacity or long-term airport congestion. Figures are lateness and cancellations against the published schedule. The requested window, the observed data window and the covered hours are three different things and must not be merged into one duration. No cause is established for any difference between the airports.`;
const PERCENTILE_READING =
  'percentileRank is a percentile rank (0-100) among the airports in this ranking, not a percentage or rate; ties share a rank. Only factorLeaders states which airport is highest on a factor; never call another airport the largest, highest or top. Do not subtract scores, add contribution points or form multiples. For "why A above B", quote the comparison reading.';
const GAP_APPROX_ZERO_PP = 0.005;
const LOAD_FACTOR_INTERPRETATION = 'Load factor is an aircraft-seat utilization signal, not a measure of terminal capacity.';
const PRESSURE_INTERPRETATION =
  'The pressure score does not establish that actual unmet demand exists. A higher score indicates stronger observed demand/capacity-pressure signals only.';

export function growthGapInterpretation(gapPercentagePoints: number): string {
  if (Math.abs(gapPercentagePoints) < GAP_APPROX_ZERO_PP) return 'Passenger activity and seat capacity grew at approximately the same rate.';
  return gapPercentagePoints > 0 ? 'Passenger activity grew faster than seat capacity.' : 'Seat capacity grew slightly faster than passenger activity.';
}
const DEMAND_PRESSURE_CONTEXT_NOTE =
  'Schedule disruption over a short window. It is not terminal capacity, not unmet demand, and was not used in the score.';

const airportRef = (a: Pick<Airport, 'code' | 'name' | 'city' | 'state'>) => ({ code: a.code as string, name: a.name, city: a.city, state: a.state });

function sources(items: readonly Provenance[]): { source: string; dataset: string; retrievedAt: string; period?: { start: string; end: string }; effectiveDate?: string }[] {
  const seen = new Set<string>();
  const out = [];
  for (const p of items) {
    const key = JSON.stringify(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: p.source, dataset: p.dataset, retrievedAt: p.retrievedAt, ...(p.period ? { period: { ...p.period } } : {}), ...(p.effectiveDate ? { effectiveDate: p.effectiveDate } : {}) });
  }
  return out;
}

export function airportProfileArtifact({ airport, traffic, provenance }: AirportProfile): AirportProfileArtifact {
  const totals = traffic.current.totals;
  const growth = (outcome: AirportProfile['traffic']['growth']['passengers']): number | null => (outcome.status === 'available' ? percent(outcome.rate) : null);
  const missing = [
    ...traffic.missingInputs,
    ...(['passengers', 'seats', 'departures'] as const).flatMap((key) => {
      const outcome = traffic.growth[key];
      return outcome.status === 'unavailable' ? [{ input: `${key} growth`, reason: outcome.reason }] : [];
    }),
  ];
  return {
    type: 'airport-profile',
    airport: airportRef(airport),
    period: { ...traffic.current.period },
    previousPeriod: { ...traffic.previous.period },
    passengers: totals?.passengers ?? null,
    seats: totals?.seats ?? null,
    departures: totals?.departures ?? null,
    loadFactorPercent: totals?.loadFactorPercent === undefined ? null : round(totals.loadFactorPercent, 1),
    passengerGrowthPercent: growth(traffic.growth.passengers),
    seatGrowthPercent: growth(traffic.growth.seats),
    departureGrowthPercent: growth(traffic.growth.departures),
    missing,
    assumptions: [...traffic.assumptions],
    sources: sources(provenance),
  };
}

export function longHaulArtifact(airport: Airport, result: LongHaulShareResult): LongHaulArtifact {
  return {
    type: 'long-haul',
    airport: airportRef(airport),
    thresholdMiles: result.thresholdMiles,
    thresholdSource: result.thresholdSource,
    sharePercent: percent(result.share, 1),
    sharePercentRange: result.shareRange ? { min: percent(result.shareRange.min, 1) ?? 0, max: percent(result.shareRange.max, 1) ?? 0 } : null,
    longHaulAverageDailyFlights: round(result.longHaulAverageDailyFlights, 2),
    totalAverageDailyFlights: round(result.totalAverageDailyFlights, 2),
    routeCount: result.routeCount,
    unclassifiedRouteCount: result.unclassifiedRoutes.length,
    distanceBands: result.distanceBands.map((b) => ({ label: b.label, averageDailyFlights: round(b.averageDailyFlights, 2), sharePercent: percent(b.share, 1) })),
    topLongHaulRoutes: result.longHaulRoutes.slice(0, 10).map((r) => ({ destination: r.destination, distanceMiles: Math.round(r.distanceMiles), averageDailyFlights: round(r.averageDailyFlights, 2) })),
    mandatoryNotice: LONG_HAUL_NOTICE,
    observation: result.observationDescription,
    missing: [...result.missingInputs],
    assumptions: [...result.assumptions],
    sources: sources(result.provenance),
  };
}

const direction = (d: DirectionDelaySummary | undefined) =>
  d
    ? {
        flights: d.flights,
        cancelled: d.cancelled,
        cancellationRatePercent: percent(d.cancellationRate, 1),
        weightedMeanOfMedianDelayMinutes: d.weightedMeanOfMedianDelayMinutes === undefined ? null : round(d.weightedMeanOfMedianDelayMinutes, 1),
        meanDelayIndex: d.meanDelayIndex === undefined ? null : round(d.meanDelayIndex, 2),
        maxDelayIndex: d.maxDelayIndex === undefined ? null : round(d.maxDelayIndex, 2),
      }
    : null;

/** Differences below this many minutes of weighted mean median delay are treated as similar. */
const DELAY_SIMILAR_MINUTES = 1;
type DirectionOutcome = 'a-higher' | 'b-higher' | 'similar' | 'insufficient';
type Sides = CongestionComparison['sides'];

function directionOutcome(label: 'departure' | 'arrival', [a, b]: Sides, pick: 'departures' | 'arrivals'): DirectionOutcome {
  const complete = (side: Sides[number]) => side.summary[pick]?.weightedMeanOfMedianDelayMinutes !== undefined && !side.summary.missingInputs.some((m) => m.input.startsWith(`${label} `));
  if (!complete(a) || !complete(b)) return 'insufficient';
  const diff = (a.summary[pick]?.weightedMeanOfMedianDelayMinutes ?? 0) - (b.summary[pick]?.weightedMeanOfMedianDelayMinutes ?? 0);
  if (Math.abs(diff) < DELAY_SIMILAR_MINUTES) return 'similar';
  return diff > 0 ? 'a-higher' : 'b-higher';
}

function congestionOutcome(sides: Sides) {
  const directionOutcomes = { departures: directionOutcome('departure', sides, 'departures'), arrivals: directionOutcome('arrival', sides, 'arrivals') };
  const verdicts = Object.values(directionOutcomes).filter((v) => v !== 'insufficient');
  const [a, b] = [sides[0].airport.code as string, sides[1].airport.code as string];
  let comparisonOutcome: CongestionComparisonArtifact['comparisonOutcome'];
  if (verdicts.length === 0) comparisonOutcome = 'insufficient';
  else if (verdicts.every((v) => v === 'a-higher')) comparisonOutcome = 'airport-a-higher-delay-pressure';
  else if (verdicts.every((v) => v === 'b-higher')) comparisonOutcome = 'airport-b-higher-delay-pressure';
  else comparisonOutcome = 'mixed';
  const [higher, lower] = comparisonOutcome === 'airport-a-higher-delay-pressure' ? [a, b] : [b, a];
  const outcomeReading =
    comparisonOutcome === 'mixed'
      ? `The comparison is mixed: ${a} and ${b} are similar or differ in opposite directions, so neither airport is shown as having higher delays. Do not name a winner.`
      : comparisonOutcome === 'insufficient'
        ? `Coverage is insufficient to compare ${a} and ${b} on delays. Do not name a winner.`
        : `${higher} shows higher delays than ${lower} in every direction with complete data (weighted mean of median delay). This describes schedule disruption in the observed window only.`;
  return { comparisonOutcome, winnerSupported: comparisonOutcome.startsWith('airport-'), directionOutcomes, outcomeReading };
}

function coverageSummary(sides: Sides): string {
  const requested = sides[0].requestedWindow;
  const hours = (Date.parse(`${requested.to}:00Z`) - Date.parse(`${requested.from}:00Z`)) / 3_600_000;
  const observed = sides
    .map((s) => (s.summary.window ? `${s.airport.code} ${s.summary.window.start} to ${s.summary.window.end} UTC (${round(s.summary.coveredHours, 2)} hours covered)` : `${s.airport.code} no data window`))
    .join('; ');
  const gaps = sides.flatMap((s) => [
    ...(s.summary.departures ? [] : [`${s.airport.code} has no departure data`]),
    ...(s.summary.arrivals ? [] : [`${s.airport.code} has no arrival data`]),
    ...s.summary.missingInputs.map((m) => `${s.airport.code} ${m.input}: ${m.reason}`),
  ]);
  return `The requested window was ${round(hours, 2)} hours (local time ${requested.from} to ${requested.to}). Observed data windows: ${observed}. ${gaps.length === 0 ? 'No missing coverage was reported.' : `Partial or missing coverage: ${gaps.join('; ')}.`}`;
}

export function congestionComparisonArtifact({ sides }: CongestionComparison): CongestionComparisonArtifact {
  const [first, second] = sides;
  const side = ({ airport, requestedWindow, summary }: CongestionComparison['sides'][number]) => ({
    airport: airportRef(airport),
    requestedWindowLocal: { from: requestedWindow.from, to: requestedWindow.to },
    observedWindowUtc: summary.window ? { start: summary.window.start, end: summary.window.end } : null,
    coveredHours: round(summary.coveredHours, 2),
    coverageReading: [
      ...(summary.departures ? [] : ['No departure data was returned.']),
      ...(summary.arrivals ? [] : ['No arrival data was returned.']),
      ...summary.missingInputs.map((m) => `${m.input}: ${m.reason}`),
    ],
    departures: direction(summary.departures),
    arrivals: direction(summary.arrivals),
    missing: [...summary.missingInputs],
  });
  const notes: string[] = [];
  for (const { airport, summary } of sides) {
    if (!summary.departures && !summary.arrivals) notes.push(`${airport.code}: no delay data was returned for the window.`);
    else if (summary.spanHours > 0 && summary.coveredHours < summary.spanHours * 0.75) notes.push(`${airport.code}: windows cover ${round(summary.coveredHours, 1)} of ${round(summary.spanHours, 1)} hours.`);
  }
  if (first.summary.window && second.summary.window && (first.summary.window.start !== second.summary.window.start || first.summary.window.end !== second.summary.window.end)) {
    notes.push('The observed UTC windows differ between the airports, for example because they are in different time zones.');
  }
  return {
    type: 'congestion-comparison',
    airports: [side(first), side(second)],
    comparabilityNotes: notes,
    ...congestionOutcome(sides),
    coverageSummary: coverageSummary(sides),
    reading: CONGESTION_READING,
    assumptions: [...new Set(sides.flatMap((s) => s.summary.assumptions))],
    sources: sources(sides.flatMap((s) => s.summary.provenance)),
  };
}

const RANKING_UNITS: Record<string, { unit: string; scale: number }> = {
  passengerScale: { unit: 'passengers', scale: 1 },
  passengerGrowth: { unit: 'percent', scale: 100 },
  demandCapacityGrowthGap: { unit: 'percentage points', scale: 100 },
  departureGrowth: { unit: 'percent', scale: 100 },
  loadFactor: { unit: 'percent', scale: 1 },
};

function factorLeaders(ranking: TerminalExpansionRanking): RankingArtifact['factorLeaders'] {
  return ranking.weights.map((w) => {
    const entries = ranking.ranked.flatMap((r) => {
      const f = r.factors.find((x) => x.id === w.id);
      return f && f.status !== 'missing' ? [{ code: r.airport.code as string, percentile: f.percentile }] : [];
    });
    const top = Math.max(...entries.map((e) => e.percentile));
    return { factorId: w.id, label: w.label, leaderAirports: entries.filter((e) => e.percentile === top).map((e) => e.code).sort() };
  });
}

function rankingComparison(ranking: TerminalExpansionRanking, compare: readonly [string, string] | undefined): RankingArtifact['comparison'] {
  if (!compare) return { status: 'not-requested' };
  const found = compare.map((code) => ranking.ranked.find((r) => r.airport.code === code));
  const [x, y] = found;
  if (!x || !y) return { status: 'unavailable', reason: `${compare.filter((_, i) => !found[i]).join(' and ')} is not a scored airport in this ranking, so no factor comparison is available.` };
  const [high, low] = x.rank <= y.rank ? [x, y] : [y, x];
  const view = (r: typeof high, id: string) => {
    const f = r.factors.find((fx) => fx.id === id);
    if (!f || f.status === 'missing') return null;
    const { unit, scale } = RANKING_UNITS[id] ?? { unit: '', scale: 1 };
    return { value: id === 'passengerScale' ? Math.round(f.raw) : round(f.raw * scale, 2), unit, percentileRank: round(f.percentile, 1), percentile: f.percentile };
  };
  const hc = high.airport.code as string;
  const lc = low.airport.code as string;
  const factors = ranking.weights.map((w) => {
    const h = view(high, w.id);
    const l = view(low, w.id);
    const favors = !h || !l ? ('not-comparable' as const) : h.percentile > l.percentile ? ('higher-ranked' as const) : h.percentile < l.percentile ? ('lower-ranked' as const) : ('tied' as const);
    const strip = (v: typeof h) => (v ? { value: v.value, unit: v.unit, percentileRank: v.percentileRank } : null);
    return { factorId: w.id, label: w.label, weightPercent: round(w.weight * 100, 1), favors, favoredAirport: favors === 'higher-ranked' ? hc : favors === 'lower-ranked' ? lc : null, higherRanked: strip(h), lowerRanked: strip(l) };
  });
  const labelsFor = (favors: string) => factors.filter((f) => f.favors === favors).map((f) => f.label);
  const list = (items: string[]) => (items.length === 0 ? 'no factor' : items.join(', '));
  const favoringHigherRanked = labelsFor('higher-ranked');
  const favoringLowerRanked = labelsFor('lower-ranked');
  const tied = labelsFor('tied');
  const weightOf = (favors: string) => round(factors.filter((f) => f.favors === favors).reduce((sum, f) => sum + f.weightPercent, 0), 1);
  const weightHigher = weightOf('higher-ranked');
  const weightLower = weightOf('lower-ranked');
  const reading = `${hc} ranks above ${lc} (rank ${high.rank} and rank ${low.rank} of ${ranking.candidateCount}). ${hc} is favored on ${list(favoringHigherRanked)}; ${lc} is favored on ${list(favoringLowerRanked)}.${tied.length > 0 ? ` Tied: ${tied.join(', ')}.` : ''} The factors favoring ${hc} carry ${weightHigher} percent of the total weight and those favoring ${lc} carry ${weightLower} percent. Weights are not scores: this readout states no score differences.`;
  return { status: 'available', higherRanked: { code: hc, rank: high.rank }, lowerRanked: { code: lc, rank: low.rank }, factors, favoringHigherRanked, favoringLowerRanked, tied, weightPercentFavoringHigherRanked: weightHigher, weightPercentFavoringLowerRanked: weightLower, reading };
}

export function rankingArtifact(ranking: TerminalExpansionRanking, compare?: readonly [string, string]): RankingArtifact {
  const byReason: Record<string, number> = {};
  for (const e of ranking.excluded) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  return {
    type: 'ranking',
    profile: ranking.profile,
    region: ranking.region.name,
    period: { ...ranking.observation.current },
    previousPeriod: { ...ranking.observation.previous },
    candidateCount: ranking.candidateCount,
    weights: ranking.weights.map((w) => ({ id: w.id, label: w.label, weightPercent: round(w.weight * 100, 1), rawMetric: w.rawMetric, interpretation: w.interpretation })),
    ranked: ranking.ranked.map((r) => ({
      rank: r.rank,
      airport: airportRef(r.airport),
      scorePoints: round(r.score, 2),
      confidence: r.confidence,
      missingFactors: [...r.missingFactors],
      factors: r.factors.map((f) => {
        if (f.status === 'missing') return { status: 'missing' as const, id: f.id, reason: f.reason };
        const { unit, scale } = RANKING_UNITS[f.id] ?? { unit: '', scale: 1 };
        return {
          status: 'available' as const,
          id: f.id,
          value: f.id === 'passengerScale' ? Math.round(f.raw) : round(f.raw * scale, 2),
          unit,
          percentileRank: round(f.percentile, 1),
          effectiveWeightPercent: round(f.effectiveWeight * 100, 1),
          contributionPoints: round(f.contribution, 2),
        };
      }),
    })),
    percentileReading: PERCENTILE_READING,
    factorLeaders: factorLeaders(ranking),
    comparison: rankingComparison(ranking, compare),
    unscored: ranking.unscored.map((u) => ({ airport: airportRef(u.airport), reason: u.reason })),
    excluded: { total: ranking.excludedCount, byReason },
    scopeNotice: ranking.scopeNotice,
    interpretationNotice: ranking.interpretationNotice,
    assumptions: [...ranking.assumptions],
    sources: sources(ranking.provenance),
  };
}

const PRESSURE_UNITS: Record<string, { unit: string; scale: number }> = {
  loadFactor: { unit: 'percent', scale: 1 },
  passengerGrowth: { unit: 'percent', scale: 100 },
  growthGap: { unit: 'percentage points', scale: 100 },
  departureGrowth: { unit: 'percent', scale: 100 },
};

export function demandPressureArtifact(airport: Airport, result: DemandPressureResult): DemandPressureArtifact {
  const context = result.operationalContext;
  const gap = result.rawMetrics.passengerSeatGrowthGap;
  return {
    type: 'demand-pressure',
    profile: result.profile,
    airport: airportRef(airport),
    scorePoints: result.score === undefined ? null : round(result.score, 1),
    band: orNull(result.band),
    confidence: result.confidence,
    period: { ...result.periods.trafficCurrent },
    previousPeriod: { ...result.periods.trafficPrevious },
    components: result.components.map((c) => {
      if (c.status === 'missing') return { status: 'missing' as const, id: c.id, label: c.label, reason: c.reason, configuredWeightPercent: round(c.configuredWeight * 100, 1) };
      const { unit, scale } = PRESSURE_UNITS[c.id] ?? { unit: '', scale: 1 };
      return {
        status: 'available' as const,
        id: c.id,
        label: c.label,
        value: round(c.raw * scale, 2),
        unit,
        zeroAt: round(c.lowerBound * scale, 2),
        hundredAt: round(c.upperBound * scale, 2),
        pressurePoints: round(c.pressure, 1),
        configuredWeightPercent: round(c.configuredWeight * 100, 1),
        effectiveWeightPercent: round(c.effectiveWeight * 100, 1),
        contributionPoints: round(c.contribution, 1),
      };
    }),
    missingSignals: [...result.missingSignals],
    operationalContext:
      context.status === 'not-requested'
        ? { status: 'not-requested' }
        : {
            status: 'available',
            observedWindowUtc: context.delay.window ? { start: context.delay.window.start, end: context.delay.window.end } : null,
            coveredHours: round(context.delay.coveredHours, 2),
            departureDelayIndex: context.departureDelayIndex === undefined ? null : round(context.departureDelayIndex, 2),
            departureCancellationRatePercent: percent(context.departureCancellationRate, 1),
            note: DEMAND_PRESSURE_CONTEXT_NOTE,
          },
    interpretation: {
      passengerSeatGrowthGap: gap === undefined ? null : growthGapInterpretation(round(gap * 100, 2)),
      loadFactor: LOAD_FACTOR_INTERPRETATION,
      pressure: PRESSURE_INTERPRETATION,
    },
    notice: result.notice,
    assumptions: [...result.assumptions],
    sources: sources(result.provenance),
  };
}
