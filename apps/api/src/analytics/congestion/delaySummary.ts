import type { AirportCode } from '../../domain/codes';
import type { AirportDelaySnapshot } from '../../domain/delays';
import type { Provenance } from '../../domain/provenance';
import type { MissingInput } from '../common';

export interface DirectionDelaySummary {
  /** Flights in the non-overlapping windows used; each flight is counted once. */
  readonly flights: number;
  readonly qualifiedFlights: number;
  readonly cancelled: number;
  /** cancelled / flights; undefined when no flights were observed. */
  readonly cancellationRate: number | undefined;
  /** Mean of the windows' median delays weighted by qualified flights. An approximation of, not, the true median. */
  readonly weightedMeanOfMedianDelayMinutes: number | undefined;
  readonly windowsWithMedianDelay: number;
  /** Mean delay index (0-5) weighted by qualified flights. */
  readonly meanDelayIndex: number | undefined;
  readonly maxDelayIndex: number | undefined;
}

export interface AirportDelaySummary {
  readonly airport: AirportCode;
  /** Extent of the windows used, UTC. Undefined when there were no snapshots. */
  readonly window: { readonly start: string; readonly end: string } | undefined;
  readonly snapshotsProvided: number;
  /** Snapshots kept after removing overlap (each covers its own time span). */
  readonly snapshotsUsed: number;
  /** Hours actually covered by the windows used. */
  readonly coveredHours: number;
  /** Hours from the first window's start to the last window's end. Covered < span means gaps. */
  readonly spanHours: number;
  readonly departures: DirectionDelaySummary | undefined;
  readonly arrivals: DirectionDelaySummary | undefined;
  readonly assumptions: readonly string[];
  readonly missingInputs: readonly MissingInput[];
  readonly provenance: readonly Provenance[];
}

export const DELAY_ASSUMPTIONS: readonly string[] = [
  'AeroDataBox delay statistics describe lateness and cancellations against the published schedule (schedule disruption). They are not airport capacity and do not show unmet demand.',
  'The summary covers only the stated observation window; a short window is not representative of long-term congestion.',
  'Rolling snapshots overlap (each covers a trailing window every 15 minutes), so only non-overlapping windows are used and every flight is counted once.',
  'Median delay is summarized as a flight-weighted mean of the windows medians, which approximates but is not the true median.',
  'Cancellation rate = cancelled flights / flights across the windows used.',
];

const HOUR_MS = 3_600_000;
const hoursBetween = (start: string, end: string): number => (Date.parse(end) - Date.parse(start)) / HOUR_MS;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

export interface DelaySummaryInput {
  readonly airport: AirportCode;
  readonly snapshots: readonly AirportDelaySnapshot[];
  readonly provenance: Provenance;
}

export function summarizeDelays({ airport, snapshots, provenance }: DelaySummaryInput): AirportDelaySummary {
  const used = nonOverlapping(snapshots);
  const first = used[0];
  const last = used.at(-1);
  if (!first || !last) {
    return {
      airport,
      window: undefined,
      snapshotsProvided: snapshots.length,
      snapshotsUsed: 0,
      coveredHours: 0,
      spanHours: 0,
      departures: undefined,
      arrivals: undefined,
      assumptions: DELAY_ASSUMPTIONS,
      missingInputs: [{ input: 'delay snapshots', reason: 'AeroDataBox returned no snapshots for the requested window' }],
      provenance: [provenance],
    };
  }

  const departures = summarizeDirection(used.map((s) => s.departures));
  const arrivals = summarizeDirection(used.map((s) => s.arrivals));
  const missingInputs: MissingInput[] = [];
  for (const [label, summary] of [['departure', departures], ['arrival', arrivals]] as const) {
    if (summary.windowsWithMedianDelay < used.length) {
      missingInputs.push({ input: `${label} median delay`, reason: `${used.length - summary.windowsWithMedianDelay} of ${used.length} windows had no median delay` });
    }
  }

  return {
    airport,
    window: { start: first.windowStart, end: last.windowEnd },
    snapshotsProvided: snapshots.length,
    snapshotsUsed: used.length,
    coveredHours: sum(used.map((s) => hoursBetween(s.windowStart, s.windowEnd))),
    spanHours: hoursBetween(first.windowStart, last.windowEnd),
    departures,
    arrivals,
    assumptions: DELAY_ASSUMPTIONS,
    missingInputs,
    provenance: [provenance],
  };
}

/** Greedy earliest-ending selection of windows that do not overlap, so no flight is counted twice. */
function nonOverlapping(snapshots: readonly AirportDelaySnapshot[]): AirportDelaySnapshot[] {
  const sorted = [...snapshots].sort((a, b) => (a.windowEnd < b.windowEnd ? -1 : a.windowEnd > b.windowEnd ? 1 : 0));
  const selected: AirportDelaySnapshot[] = [];
  let lastEnd: string | undefined;
  for (const snapshot of sorted) {
    if (lastEnd === undefined || snapshot.windowStart >= lastEnd) {
      selected.push(snapshot);
      lastEnd = snapshot.windowEnd;
    }
  }
  return selected;
}

type WindowSummary = AirportDelaySnapshot['departures'];

function summarizeDirection(windows: readonly WindowSummary[]): DirectionDelaySummary {
  const flights = sum(windows.map((w) => w.flights));
  const cancelled = sum(windows.map((w) => w.cancelled));
  const withMedian = windows.filter((w) => w.medianDelayMinutes !== undefined && w.qualifiedFlights > 0);
  const withIndex = windows.filter((w) => w.delayIndex !== undefined && w.qualifiedFlights > 0);
  const medianWeight = sum(withMedian.map((w) => w.qualifiedFlights));
  const indexWeight = sum(withIndex.map((w) => w.qualifiedFlights));
  return {
    flights,
    qualifiedFlights: sum(windows.map((w) => w.qualifiedFlights)),
    cancelled,
    cancellationRate: flights > 0 ? cancelled / flights : undefined,
    weightedMeanOfMedianDelayMinutes: medianWeight > 0 ? sum(withMedian.map((w) => (w.medianDelayMinutes ?? 0) * w.qualifiedFlights)) / medianWeight : undefined,
    windowsWithMedianDelay: withMedian.length,
    meanDelayIndex: indexWeight > 0 ? sum(withIndex.map((w) => (w.delayIndex ?? 0) * w.qualifiedFlights)) / indexWeight : undefined,
    maxDelayIndex: withIndex.length > 0 ? Math.max(...withIndex.map((w) => w.delayIndex ?? 0)) : undefined,
  };
}
