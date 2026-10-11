import { describe, expect, it } from 'vitest';
import { adbProvenance, code, snapshot } from '../__tests__/support';
import { summarizeDelays } from './delaySummary';

const summarize = (snapshots: ReturnType<typeof snapshot>[]) => summarizeDelays({ airport: code('LAX'), snapshots, provenance: adbProvenance });

describe('summarizeDelays', () => {
  it('weights window medians and delay indexes by qualified flights, not by window', () => {
    const result = summarize([
      snapshot(0, 2, { flights: 10, qualifiedFlights: 10, medianDelayMinutes: 4, delayIndex: 1.0 }),
      snapshot(2, 4, { flights: 30, qualifiedFlights: 30, medianDelayMinutes: 8, delayIndex: 0.2 }),
    ]);
    expect(result.departures?.weightedMeanOfMedianDelayMinutes).toBeCloseTo((4 * 10 + 8 * 30) / 40, 12);
    expect(result.departures?.meanDelayIndex).toBeCloseTo((1.0 * 10 + 0.2 * 30) / 40, 12);
    expect(result.departures?.maxDelayIndex).toBe(1.0);
    expect(result.departures?.flights).toBe(40);
  });

  it('computes the cancellation rate from counts, not by averaging per-window rates', () => {
    const result = summarize([snapshot(0, 2, { flights: 10, cancelled: 1 }), snapshot(2, 4, { flights: 90, cancelled: 9 })]);
    expect(result.departures?.cancelled).toBe(10);
    expect(result.departures?.cancellationRate).toBeCloseTo(0.1, 12);
    expect(result.arrivals?.cancellationRate).toBe(0);
  });

  it('uses overlapping rolling snapshots only once, so flights are not double counted', () => {
    const result = summarize([snapshot(0, 2, { flights: 10 }), snapshot(1, 3, { flights: 99 }), snapshot(2, 4, { flights: 20 }), snapshot(3, 5, { flights: 77 })]);
    expect(result.snapshotsProvided).toBe(4);
    expect(result.snapshotsUsed).toBe(2);
    expect(result.departures?.flights).toBe(30);
    expect(result.window).toEqual({ start: '2026-10-06T00:00:00Z', end: '2026-10-06T04:00:00Z' });
    expect(result.coveredHours).toBe(4);
    expect(result.spanHours).toBe(4);
  });

  it('does not depend on the order snapshots are supplied in', () => {
    const snapshots = [snapshot(0, 2, { flights: 10 }), snapshot(1, 3, { flights: 99 }), snapshot(2, 4, { flights: 20 })];
    expect(summarize([...snapshots].reverse())).toEqual(summarize(snapshots));
  });

  it('reports gaps between windows as less coverage than span', () => {
    const result = summarize([snapshot(0, 2), snapshot(4, 6)]);
    expect(result.coveredHours).toBe(4);
    expect(result.spanHours).toBe(6);
  });

  it('leaves a missing median out of the weighted mean and reports it', () => {
    const result = summarize([
      snapshot(0, 2, { qualifiedFlights: 10, medianDelayMinutes: 6 }),
      snapshot(2, 4, { qualifiedFlights: 10 }),
    ]);
    expect(result.departures?.weightedMeanOfMedianDelayMinutes).toBe(6);
    expect(result.departures?.windowsWithMedianDelay).toBe(1);
    expect(result.missingInputs).toContainEqual({ input: 'departure median delay', reason: '1 of 2 windows had no median delay' });
  });

  it('keeps the two directions separate when one has no usable arrivals', () => {
    const result = summarize([
      snapshot(0, 2, { medianDelayMinutes: 5, delayIndex: 0.5 }, { flights: 2, qualifiedFlights: 0 }),
    ]);
    expect(result.departures?.weightedMeanOfMedianDelayMinutes).toBe(5);
    expect(result.arrivals?.weightedMeanOfMedianDelayMinutes).toBeUndefined();
    expect(result.arrivals?.meanDelayIndex).toBeUndefined();
    expect(result.arrivals?.flights).toBe(2);
    expect(result.missingInputs.some((m) => m.input === 'arrival median delay')).toBe(true);
  });

  it('returns an undefined summary, not zeros, when there are no snapshots', () => {
    const result = summarize([]);
    expect(result.departures).toBeUndefined();
    expect(result.arrivals).toBeUndefined();
    expect(result.window).toBeUndefined();
    expect(result.snapshotsUsed).toBe(0);
    expect(result.missingInputs).toEqual([{ input: 'delay snapshots', reason: expect.any(String) }]);
  });

  it('gives an undefined cancellation rate when no flights were observed', () => {
    const result = summarize([snapshot(0, 2, { flights: 0, qualifiedFlights: 0 })]);
    expect(result.departures?.cancellationRate).toBeUndefined();
  });

  it('states what the numbers mean and do not mean, plus the window and provenance', () => {
    const result = summarize([snapshot(0, 2)]);
    const text = result.assumptions.join(' ');
    expect(text).toContain('schedule disruption');
    expect(text).toContain('not airport capacity');
    expect(text).toContain('not representative of long-term congestion');
    expect(result.window).toEqual({ start: '2026-10-06T00:00:00Z', end: '2026-10-06T02:00:00Z' });
    expect(result.provenance).toEqual([adbProvenance]);
  });
});
