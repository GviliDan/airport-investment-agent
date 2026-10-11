import type { AirportCode } from '../../domain/codes';
import { monthsInPeriod, precedingPeriod, trailingPeriod, type Period, type YearMonth } from '../../domain/period';
import type { Provenance } from '../../domain/provenance';
import type { AirportMonthlyTraffic } from '../../domain/traffic';
import { COMPARISON_WINDOW_MONTHS } from '../assumptions';
import type { MissingInput } from '../common';

export interface TrafficTotals {
  readonly passengers: number;
  readonly seats: number;
  readonly departures: number;
  /** 100 x passengers / seats of the summed window; undefined when there are no seats. */
  readonly loadFactorPercent: number | undefined;
}

export interface TrafficWindow {
  readonly period: Period;
  readonly monthsExpected: number;
  readonly monthsWithData: number;
  readonly missingMonths: readonly YearMonth[];
  /** Present only when every month of the window has data. A partial sum would look like a real total. */
  readonly totals: TrafficTotals | undefined;
}

export type GrowthUnavailableReason = 'current-period-incomplete' | 'previous-period-incomplete' | 'previous-value-zero';

export type GrowthOutcome =
  | { readonly status: 'available'; readonly rate: number }
  | { readonly status: 'unavailable'; readonly reason: GrowthUnavailableReason };

export interface TrafficTrendResult {
  readonly airport: AirportCode;
  readonly current: TrafficWindow;
  readonly previous: TrafficWindow;
  /** (current - previous) / previous as a fraction: 0.034 means +3.4%. */
  readonly growth: {
    readonly passengers: GrowthOutcome;
    readonly seats: GrowthOutcome;
    readonly departures: GrowthOutcome;
  };
  readonly missingInputs: readonly MissingInput[];
  readonly assumptions: readonly string[];
  readonly provenance: readonly Provenance[];
}

export const TRAFFIC_ASSUMPTIONS: readonly string[] = [
  'Passengers, seats and departures are summed over whole windows; a window with any missing month is not totalled.',
  'Growth = (current - previous) / previous, expressed as a fraction (0.034 = +3.4%). It is unavailable when the previous value is zero.',
  'Load factor = passengers / seats of the summed window, not an average of monthly load factors.',
  'Departures include cargo departures; seats and passengers describe passenger flights only.',
  'The windows come from the latest month BTS currently publishes, which lags the calendar by about two months.',
];

/**
 * The latest complete comparable windows: the `months` months ending at the last published month, and the
 * same number of months before them. Undefined when BTS history is too short for both.
 */
export function deriveComparableWindows(
  available: Period,
  months: number = COMPARISON_WINDOW_MONTHS,
): { current: Period; previous: Period } | undefined {
  const current = trailingPeriod(available.end, months);
  const previous = precedingPeriod(current);
  return previous.start < available.start ? undefined : { current, previous };
}

export interface TrafficTrendInput {
  readonly airport: AirportCode;
  readonly currentPeriod: Period;
  readonly previousPeriod: Period;
  readonly rows: readonly AirportMonthlyTraffic[];
  readonly provenance: Provenance;
}

export function computeTrafficTrend({ airport, currentPeriod, previousPeriod, rows, provenance }: TrafficTrendInput): TrafficTrendResult {
  const byMonth = indexByMonth(airport, rows);
  const current = summarizeWindow(currentPeriod, byMonth);
  const previous = summarizeWindow(previousPeriod, byMonth);

  const growth = {
    passengers: growthOutcome(current, previous, (t) => t.passengers),
    seats: growthOutcome(current, previous, (t) => t.seats),
    departures: growthOutcome(current, previous, (t) => t.departures),
  };

  const missingInputs: MissingInput[] = [];
  for (const [label, window] of [['current', current], ['previous', previous]] as const) {
    if (window.missingMonths.length > 0) {
      missingInputs.push({
        input: `${label}-period traffic ${window.period.start}..${window.period.end}`,
        reason: `${window.missingMonths.length} of ${window.monthsExpected} months have no BTS record: ${window.missingMonths.join(', ')}`,
      });
    }
  }
  if (current.totals && current.totals.loadFactorPercent === undefined) {
    missingInputs.push({ input: 'load factor', reason: 'no seats reported in the current period' });
  }

  return { airport, current, previous, growth, missingInputs, assumptions: TRAFFIC_ASSUMPTIONS, provenance: [provenance] };
}

function indexByMonth(airport: AirportCode, rows: readonly AirportMonthlyTraffic[]): Map<YearMonth, AirportMonthlyTraffic> {
  const byMonth = new Map<YearMonth, AirportMonthlyTraffic>();
  for (const row of rows) {
    if (row.airport !== airport) continue;
    if (byMonth.has(row.month)) throw new Error(`duplicate traffic record for ${airport} ${row.month}`);
    byMonth.set(row.month, row);
  }
  return byMonth;
}

function summarizeWindow(period: Period, byMonth: ReadonlyMap<YearMonth, AirportMonthlyTraffic>): TrafficWindow {
  const expected = monthsInPeriod(period);
  const present = expected.flatMap((month) => {
    const row = byMonth.get(month);
    return row ? [row] : [];
  });
  const missingMonths = expected.filter((month) => !byMonth.has(month));
  const complete = missingMonths.length === 0;
  const passengers = present.reduce((sum, r) => sum + r.passengers, 0);
  const seats = present.reduce((sum, r) => sum + r.seats, 0);
  const departures = present.reduce((sum, r) => sum + r.departures, 0);
  return {
    period,
    monthsExpected: expected.length,
    monthsWithData: present.length,
    missingMonths,
    totals: complete ? { passengers, seats, departures, loadFactorPercent: seats > 0 ? (100 * passengers) / seats : undefined } : undefined,
  };
}

function growthOutcome(current: TrafficWindow, previous: TrafficWindow, pick: (totals: TrafficTotals) => number): GrowthOutcome {
  if (!current.totals) return { status: 'unavailable', reason: 'current-period-incomplete' };
  if (!previous.totals) return { status: 'unavailable', reason: 'previous-period-incomplete' };
  const before = pick(previous.totals);
  if (before === 0) return { status: 'unavailable', reason: 'previous-value-zero' };
  return { status: 'available', rate: (pick(current.totals) - before) / before };
}
