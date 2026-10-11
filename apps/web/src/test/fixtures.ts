import type { Artifact } from '@airport/shared';

type Of<T extends Artifact['type']> = Extract<Artifact, { type: T }>;

const hvn = { code: 'HVN', name: 'TWEED-NEW HAVEN', city: 'NEW HAVEN', state: 'CT' };
const bos = { code: 'BOS', name: 'GENERAL EDWARD LAWRENCE LOGAN INTL', city: 'BOSTON', state: 'MA' };
const lax = { code: 'LAX', name: 'LOS ANGELES INTL', city: 'LOS ANGELES', state: 'CA' };
const sna = { code: 'SNA', name: 'JOHN WAYNE AIRPORT', city: 'SANTA ANA', state: 'CA' };
const period = { start: '2025-05', end: '2026-04' };
const previousPeriod = { start: '2024-05', end: '2025-04' };
const sources = [{ source: 'bts', dataset: 'T-100', retrievedAt: '2026-10-07T12:00:00Z', period }];

export const SCOPE = 'Scores are relative to the airports included in this ranking and should not be compared across separate ranking runs.';
export const INTERPRETATION = 'This is an Airport Terminal Expansion Opportunity Score built from observable BTS traffic and capacity signals. It is not ROI.';
export const PRESSURE = 'This is an indicator of demand/capacity pressure, not an estimate of passengers who could not travel.';
export const LONG_HAUL_NOTICE =
  'This share is based on scheduled route frequency. Each route is weighted by averageDailyFlights, a rolling 7-day average of scheduled flights. It covers the listed service types (passenger and cargo), so it is not a passenger-only share, and it is not a share of performed flights.';

const factor = (id: string, value: number, unit: string, percentileRank: number) => ({
  status: 'available' as const,
  id,
  value,
  unit,
  percentileRank,
  effectiveWeightPercent: 20,
  contributionPoints: 10,
});

const rankedEntry = (rank: number, airport: typeof hvn, scorePoints: number, passengers: number, withMissing = false) => ({
  rank,
  airport,
  scorePoints,
  confidence: 'high' as const,
  missingFactors: withMissing ? ['loadFactor'] : [],
  factors: [
    factor('passengerScale', passengers, 'passengers', 75),
    factor('passengerGrowth', 10.12, 'percent', 62.5),
    factor('demandCapacityGrowthGap', 2.55, 'percentage points', 81.3),
    factor('departureGrowth', -2.13, 'percent', 12.5),
    withMissing ? { status: 'missing' as const, id: 'loadFactor', reason: 'no seat data' } : factor('loadFactor', 77.24, 'percent', 62.5),
  ],
});

export const ranking = (count = 3): Of<'ranking'> => ({
  type: 'ranking',
  profile: 'terminal-expansion-v1',
  region: 'New England',
  period,
  previousPeriod,
  candidateCount: count,
  weights: [{ id: 'passengerScale', label: 'Passenger Scale', weightPercent: 30, rawMetric: 'passengers', interpretation: 'Larger airports score higher.' }],
  ranked: [
    rankedEntry(1, hvn, 72.81, 732816, true),
    rankedEntry(2, bos, 46.88, 20983745),
    ...Array.from({ length: count - 2 }, (_, i) => rankedEntry(i + 3, { ...hvn, code: `AA${i}` }, 40 - i, 1000 + i)),
  ],
  unscored: [],
  excluded: { total: 2, byReason: { 'no scheduled service': 2 } },
  percentileReading: 'percentileRank is a percentile rank.',
  factorLeaders: [],
  comparison: { status: 'not-requested' },
  scopeNotice: SCOPE,
  interpretationNotice: INTERPRETATION,
  assumptions: ['Growth compares the latest 12 months with the 12 before.'],
  sources,
});

const direction = (flights: number, median: number | null) => ({ flights, cancelled: 0, cancellationRatePercent: 0, weightedMeanOfMedianDelayMinutes: median, meanDelayIndex: 0.23, maxDelayIndex: 0.5 });

export const congestion = (overrides: Partial<Of<'congestion-comparison'>> = {}): Of<'congestion-comparison'> => {
  const side = (airport: typeof lax, departures: ReturnType<typeof direction> | null, coverageReading: string[]) => ({
    airport,
    requestedWindowLocal: { from: '2026-10-07T14:27', to: '2026-10-08T02:27' },
    observedWindowUtc: { start: '2026-10-07T19:15:00Z', end: '2026-10-08T09:15:00Z' },
    coveredHours: 14,
    coverageReading,
    departures,
    arrivals: departures ? direction(120, 5.1) : null,
    missing: [],
  });
  return {
    type: 'congestion-comparison',
    airports: [side(lax, direction(438, 4.1), []), side(sna, direction(91, 5.7), ['departure median delay: 3 of 7 windows had no median delay'])],
    comparabilityNotes: [],
    comparisonOutcome: 'insufficient',
    winnerSupported: false,
    directionOutcomes: { departures: 'insufficient', arrivals: 'insufficient' },
    outcomeReading: 'Coverage is insufficient to compare LAX and SNA on delays. Do not name a winner.',
    coverageSummary: 'The requested window was 12 hours (local time 2026-10-07T14:27 to 2026-10-08T02:27).',
    reading: 'This comparison reflects schedule disruption during the observed window and should not be interpreted as a direct measure of terminal capacity.',
    assumptions: [],
    sources,
    ...overrides,
  };
};

export const longHaul = (): Of<'long-haul'> => ({
  type: 'long-haul',
  airport: { code: 'ANC', name: 'TED STEVENS ANCHORAGE INTL', city: 'ANCHORAGE', state: 'AK' },
  thresholdMiles: 3000,
  thresholdSource: 'default',
  sharePercent: 19.3,
  sharePercentRange: null,
  longHaulAverageDailyFlights: 12.5,
  totalAverageDailyFlights: 64.8,
  routeCount: 41,
  unclassifiedRouteCount: 0,
  distanceBands: [
    { label: 'Under 1,000 miles', averageDailyFlights: 40, sharePercent: 61.7 },
    { label: '3,000 miles and over', averageDailyFlights: 12.5, sharePercent: 19.3 },
  ],
  topLongHaulRoutes: [{ destination: 'JFK', distanceMiles: 3380, averageDailyFlights: 3 }],
  mandatoryNotice: LONG_HAUL_NOTICE,
  observation: 'Average daily scheduled departures over the 7 days before 2026-10-07 (AeroDataBox route statistic).',
  missing: [],
  assumptions: ['Routes are weighted by averageDailyFlights.'],
  sources: [],
});

export const demandPressure = (): Of<'demand-pressure'> => ({
  type: 'demand-pressure',
  profile: 'demand-pressure-v1',
  airport: { code: 'SFO', name: 'SAN FRANCISCO INTL', city: 'SAN FRANCISCO', state: 'CA' },
  scorePoints: 57.6,
  band: 'elevated',
  confidence: 'medium',
  period,
  previousPeriod,
  components: [
    { status: 'available', id: 'loadFactor', label: 'Load factor', value: 82.55, unit: 'percent', zeroAt: 60, hundredAt: 90, pressurePoints: 75.2, configuredWeightPercent: 35, effectiveWeightPercent: 35, contributionPoints: 22 },
    { status: 'available', id: 'growthGap', label: 'Passenger-minus-seat growth gap', value: -0.02, unit: 'percentage points', zeroAt: -2, hundredAt: 4, pressurePoints: 49.7, configuredWeightPercent: 25, effectiveWeightPercent: 25, contributionPoints: 12.5 },
    { status: 'missing', id: 'departureGrowth', label: 'Departure growth', reason: 'no departure data', configuredWeightPercent: 15 },
  ],
  missingSignals: [{ input: 'departure growth', reason: 'no departure data' }],
  operationalContext: { status: 'not-requested' },
  interpretation: {
    passengerSeatGrowthGap: 'Seat capacity grew slightly faster than passenger activity.',
    loadFactor: 'Load factor is an aircraft-seat utilization signal, not a measure of terminal capacity.',
    pressure: 'The pressure score does not establish that actual unmet demand exists.',
  },
  notice: PRESSURE,
  assumptions: [],
  sources,
});

export const profile = (): Of<'airport-profile'> => ({
  type: 'airport-profile',
  airport: { code: 'LAX', name: 'LOS ANGELES INTL', city: 'LOS ANGELES', state: 'CA' },
  period,
  previousPeriod,
  passengers: 36590656,
  seats: null,
  departures: 250000,
  loadFactorPercent: null,
  passengerGrowthPercent: -3.29,
  seatGrowthPercent: null,
  departureGrowthPercent: 0,
  missing: [{ input: 'seats', reason: 'not reported' }],
  assumptions: [],
  sources: [],
});

export const chatBody = (artifacts: unknown[], message = 'Short commentary.') => ({ message, artifacts, meta: { toolCalls: ['x'], warnings: [] } });
