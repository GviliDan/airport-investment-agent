/**
 * The scoring methodology: every weight, range and band in one place. These are transparent MVP analytical
 * assumptions, not industry standards, and they are code, not environment configuration.
 */

/** The notice every ranking result carries, verbatim. */
export const RANKING_SCOPE_NOTICE =
  'Scores are relative to the airports included in this ranking and should not be compared across separate ranking runs.';

export const TERMINAL_EXPANSION_INTERPRETATION_NOTICE =
  'This is an Airport Terminal Expansion Opportunity Score built from observable BTS traffic and capacity signals. It is not ROI, profitability, a terminal engineering assessment, or proof that expansion is required.';

// ---------------------------------------------------------------------------
// Terminal Expansion Opportunity Score
// ---------------------------------------------------------------------------

export const TERMINAL_EXPANSION_PROFILE = 'terminal-expansion-v1';

export type TerminalExpansionFactorId =
  | 'passengerScale'
  | 'passengerGrowth'
  | 'demandCapacityGrowthGap'
  | 'departureGrowth'
  | 'loadFactor';

export interface TerminalExpansionFactorConfig {
  readonly id: TerminalExpansionFactorId;
  readonly label: string;
  readonly weight: number;
  /** What the raw value is and how it is read. */
  readonly rawMetric: string;
  readonly interpretation: string;
}

/** Order here is the order factors are reported in. Weights sum to 1. */
export const TERMINAL_EXPANSION_FACTORS: readonly TerminalExpansionFactorConfig[] = [
  { id: 'passengerScale', label: 'Passenger Scale', weight: 0.3, rawMetric: 'passengers over the latest 12 months', interpretation: 'economic and activity scale of the airport' },
  { id: 'passengerGrowth', label: 'Passenger Growth', weight: 0.25, rawMetric: 'year-over-year passenger growth (fraction)', interpretation: 'evidence of increasing passenger activity' },
  { id: 'demandCapacityGrowthGap', label: 'Demand-Capacity Growth Gap', weight: 0.2, rawMetric: 'passenger growth minus seat growth (fraction; 0.01 = 1 percentage point)', interpretation: 'positive when passenger activity grows faster than seat capacity' },
  { id: 'departureGrowth', label: 'Departure Growth', weight: 0.15, rawMetric: 'year-over-year departure growth (fraction)', interpretation: 'increasing flight activity that may create terminal pressure' },
  { id: 'loadFactor', label: 'Load Factor', weight: 0.1, rawMetric: 'passengers / seats over the latest 12 months (percent)', interpretation: 'utilization signal' },
];

/** An airport needs at least this many of the five factors to be scored; otherwise it is reported unscored. */
export const TERMINAL_EXPANSION_MIN_FACTORS = 3;

// ---------------------------------------------------------------------------
// Unmet Demand Pressure Proxy
// ---------------------------------------------------------------------------

export const DEMAND_PRESSURE_PROFILE = 'demand-pressure-v1';

/** The notice every demand-pressure result carries, verbatim. */
export const DEMAND_PRESSURE_NOTICE =
  'This is an indicator of demand/capacity pressure, not an estimate of passengers who could not travel.';

export type DemandPressureComponentId = 'loadFactor' | 'passengerGrowth' | 'growthGap' | 'departureGrowth';

export interface DemandPressureComponentConfig {
  readonly id: DemandPressureComponentId;
  readonly label: string;
  readonly weight: number;
  /** Raw value at or below which the component is 0. */
  readonly lowerBound: number;
  /** Raw value at or above which the component is 100. */
  readonly upperBound: number;
  readonly unit: string;
}

/** Growth values are fractions (0.10 = +10%), load factor is in percent. Weights sum to 1. */
export const DEMAND_PRESSURE_COMPONENTS: readonly DemandPressureComponentConfig[] = [
  { id: 'loadFactor', label: 'Load Factor Pressure', weight: 0.35, lowerBound: 70, upperBound: 90, unit: 'percent' },
  { id: 'passengerGrowth', label: 'Passenger Growth', weight: 0.25, lowerBound: -0.05, upperBound: 0.1, unit: 'fraction' },
  { id: 'growthGap', label: 'Passenger-vs-Seat Growth Gap', weight: 0.25, lowerBound: -0.05, upperBound: 0.05, unit: 'fraction (percentage points / 100)' },
  { id: 'departureGrowth', label: 'Departure Growth', weight: 0.15, lowerBound: -0.05, upperBound: 0.1, unit: 'fraction' },
];

/** Fewer numeric components than this: no score is issued. */
export const DEMAND_PRESSURE_MIN_COMPONENTS = 3;

export type PressureBand = 'low' | 'moderate' | 'elevated' | 'high';

/** Lower edges (inclusive) of the bands above "low": 25 -> moderate, 50 -> elevated, 75 -> high. */
export const PRESSURE_BAND_EDGES = { moderate: 25, elevated: 50, high: 75 } as const;
