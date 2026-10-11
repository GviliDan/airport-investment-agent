import { z } from 'zod';

/**
 * UI artifacts are built deterministically from tool results, never from LLM prose. Numbers are already in
 * presentation units (percent, minutes, points) and rounded for display, so neither the model nor the UI
 * has to convert them. A missing value is `null`, never zero.
 */

const AirportRefSchema = z.object({ code: z.string(), name: z.string(), city: z.string(), state: z.string() });
const PeriodSchema = z.object({ start: z.string(), end: z.string() });
const SourceSchema = z.object({ source: z.string(), dataset: z.string(), retrievedAt: z.string(), period: PeriodSchema.optional(), effectiveDate: z.string().optional() });
const MissingSchema = z.object({ input: z.string(), reason: z.string() });
const common = { assumptions: z.array(z.string()), sources: z.array(SourceSchema) };

export const AirportProfileArtifactSchema = z.object({
  type: z.literal('airport-profile'),
  airport: AirportRefSchema,
  period: PeriodSchema,
  previousPeriod: PeriodSchema,
  passengers: z.number().nullable(),
  seats: z.number().nullable(),
  departures: z.number().nullable(),
  loadFactorPercent: z.number().nullable(),
  passengerGrowthPercent: z.number().nullable(),
  seatGrowthPercent: z.number().nullable(),
  departureGrowthPercent: z.number().nullable(),
  missing: z.array(MissingSchema),
  ...common,
});

export const LongHaulArtifactSchema = z.object({
  type: z.literal('long-haul'),
  airport: AirportRefSchema,
  thresholdMiles: z.number(),
  thresholdSource: z.enum(['default', 'user']),
  /** Share of scheduled departures on routes at or beyond the threshold; null when there are no routes. */
  sharePercent: z.number().nullable(),
  /** Bounds when some routes could not be placed (no destination coordinates). */
  sharePercentRange: z.object({ min: z.number(), max: z.number() }).nullable(),
  longHaulAverageDailyFlights: z.number(),
  totalAverageDailyFlights: z.number(),
  routeCount: z.number(),
  unclassifiedRouteCount: z.number(),
  distanceBands: z.array(z.object({ label: z.string(), averageDailyFlights: z.number(), sharePercent: z.number().nullable() })),
  topLongHaulRoutes: z.array(z.object({ destination: z.string(), distanceMiles: z.number(), averageDailyFlights: z.number() })),
  /** Canonical wording of the mandatory notice; quoted verbatim. */
  mandatoryNotice: z.string(),
  observation: z.string(),
  missing: z.array(MissingSchema),
  ...common,
});

const DirectionSchema = z.object({
  flights: z.number(),
  cancelled: z.number(),
  cancellationRatePercent: z.number().nullable(),
  weightedMeanOfMedianDelayMinutes: z.number().nullable(),
  meanDelayIndex: z.number().nullable(),
  maxDelayIndex: z.number().nullable(),
});

const CongestionSideSchema = z.object({
  airport: AirportRefSchema,
  /** Requested window in the airport's local time. */
  requestedWindowLocal: z.object({ from: z.string(), to: z.string() }),
  /** Window actually observed (UTC); null when AeroDataBox returned nothing. */
  observedWindowUtc: PeriodSchema.nullable(),
  coveredHours: z.number(),
  /** Deterministic list of missing or partial coverage; empty when coverage is complete. */
  coverageReading: z.array(z.string()),
  departures: DirectionSchema.nullable(),
  arrivals: DirectionSchema.nullable(),
  missing: z.array(MissingSchema),
});

export const CongestionComparisonArtifactSchema = z.object({
  type: z.literal('congestion-comparison'),
  airports: z.tuple([CongestionSideSchema, CongestionSideSchema]),
  comparabilityNotes: z.array(z.string()),
  /** Directional only when both airports have complete median coverage in every compared direction; otherwise mixed or insufficient. */
  comparisonOutcome: z.enum(['airport-a-higher-delay-pressure', 'airport-b-higher-delay-pressure', 'mixed', 'insufficient']),
  /** True only for a directional comparisonOutcome. When false, do not name a winner. */
  winnerSupported: z.boolean(),
  directionOutcomes: z.object({
    departures: z.enum(['a-higher', 'b-higher', 'similar', 'insufficient']),
    arrivals: z.enum(['a-higher', 'b-higher', 'similar', 'insufficient']),
  }),
  outcomeReading: z.string(),
  /** Ready-to-quote sentence: requested window, observed window, covered hours and missing coverage. */
  coverageSummary: z.string(),
  /** What the comparison may and may not be read as. */
  reading: z.string(),
  ...common,
});

const RankingFactorSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), id: z.string(), value: z.number(), unit: z.string(), percentileRank: z.number(), effectiveWeightPercent: z.number(), contributionPoints: z.number() }),
  z.object({ status: z.literal('missing'), id: z.string(), reason: z.string() }),
]);

export const RankingArtifactSchema = z.object({
  type: z.literal('ranking'),
  profile: z.string(),
  region: z.string(),
  period: PeriodSchema,
  previousPeriod: PeriodSchema,
  candidateCount: z.number(),
  weights: z.array(z.object({ id: z.string(), label: z.string(), weightPercent: z.number(), rawMetric: z.string(), interpretation: z.string() })),
  ranked: z.array(
    z.object({
      rank: z.number(),
      airport: AirportRefSchema,
      scorePoints: z.number(),
      confidence: z.enum(['high', 'medium', 'low']),
      missingFactors: z.array(z.string()),
      factors: z.array(RankingFactorSchema),
    }),
  ),
  percentileReading: z.string(),
  /** Per factor, the airport(s) with the highest percentile rank. Only this field supports "highest/leader" statements. */
  factorLeaders: z.array(z.object({ factorId: z.string(), label: z.string(), leaderAirports: z.array(z.string()) })),
  /** Precomputed pairwise readout, present only when the tool's compare argument named two airports. */
  comparison: z.discriminatedUnion('status', [
    z.object({ status: z.literal('not-requested') }),
    z.object({ status: z.literal('unavailable'), reason: z.string() }),
    z.object({
      status: z.literal('available'),
      higherRanked: z.object({ code: z.string(), rank: z.number() }),
      lowerRanked: z.object({ code: z.string(), rank: z.number() }),
      factors: z.array(
        z.object({
          factorId: z.string(),
          label: z.string(),
          weightPercent: z.number(),
          favors: z.enum(['higher-ranked', 'lower-ranked', 'tied', 'not-comparable']),
          favoredAirport: z.string().nullable(),
          higherRanked: z.object({ value: z.number(), unit: z.string(), percentileRank: z.number() }).nullable(),
          lowerRanked: z.object({ value: z.number(), unit: z.string(), percentileRank: z.number() }).nullable(),
        }),
      ),
      favoringHigherRanked: z.array(z.string()),
      favoringLowerRanked: z.array(z.string()),
      tied: z.array(z.string()),
      /** Combined configured weight of the factors favoring each airport. Weights, not scores. */
      weightPercentFavoringHigherRanked: z.number(),
      weightPercentFavoringLowerRanked: z.number(),
      reading: z.string(),
    }),
  ]),
  unscored: z.array(z.object({ airport: AirportRefSchema, reason: z.string() })),
  excluded: z.object({ total: z.number(), byReason: z.record(z.string(), z.number()) }),
  scopeNotice: z.string(),
  interpretationNotice: z.string(),
  ...common,
});

export const DemandPressureArtifactSchema = z.object({
  type: z.literal('demand-pressure'),
  profile: z.string(),
  airport: AirportRefSchema,
  /** 0-100; null when fewer than three components exist. */
  scorePoints: z.number().nullable(),
  band: z.enum(['low', 'moderate', 'elevated', 'high']).nullable(),
  confidence: z.enum(['medium', 'low', 'insufficient']),
  period: PeriodSchema,
  previousPeriod: PeriodSchema,
  components: z.array(
    z.discriminatedUnion('status', [
      z.object({ status: z.literal('available'), id: z.string(), label: z.string(), value: z.number(), unit: z.string(), zeroAt: z.number(), hundredAt: z.number(), pressurePoints: z.number(), configuredWeightPercent: z.number(), effectiveWeightPercent: z.number(), contributionPoints: z.number() }),
      z.object({ status: z.literal('missing'), id: z.string(), label: z.string(), reason: z.string(), configuredWeightPercent: z.number() }),
    ]),
  ),
  missingSignals: z.array(MissingSchema),
  operationalContext: z.discriminatedUnion('status', [
    z.object({ status: z.literal('not-requested') }),
    z.object({
      status: z.literal('available'),
      observedWindowUtc: PeriodSchema.nullable(),
      coveredHours: z.number(),
      departureDelayIndex: z.number().nullable(),
      departureCancellationRatePercent: z.number().nullable(),
      note: z.string(),
    }),
  ]),
  /** Deterministic statements the model quotes instead of inferring semantics. */
  interpretation: z.object({
    passengerSeatGrowthGap: z.string().nullable(),
    loadFactor: z.string(),
    pressure: z.string(),
  }),
  notice: z.string(),
  ...common,
});

export const ArtifactSchema = z.discriminatedUnion('type', [
  AirportProfileArtifactSchema,
  LongHaulArtifactSchema,
  CongestionComparisonArtifactSchema,
  RankingArtifactSchema,
  DemandPressureArtifactSchema,
]);

export type AirportProfileArtifact = z.infer<typeof AirportProfileArtifactSchema>;
export type LongHaulArtifact = z.infer<typeof LongHaulArtifactSchema>;
export type CongestionComparisonArtifact = z.infer<typeof CongestionComparisonArtifactSchema>;
export type RankingArtifact = z.infer<typeof RankingArtifactSchema>;
export type DemandPressureArtifact = z.infer<typeof DemandPressureArtifactSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
