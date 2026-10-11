import { describe, expect, it } from 'vitest';
import { computeTrafficTrend } from '../analytics/traffic/trafficTrend';
import { summarizeDelays } from '../analytics/congestion/delaySummary';
import { adbProvenance, btsProvenance, code, monthlyRows, period, snapshot } from '../analytics/__tests__/support';
import { boundedPressure, pressureBand, scoreDemandPressure } from './demandPressure';
import { DEMAND_PRESSURE_COMPONENTS } from './scoringConfig';

const CURRENT = period('2025-05', '2026-04');
const PREVIOUS = period('2024-05', '2025-04');

/** Annual totals are 12x the monthly values given. */
interface Year { passengers: number; seats: number; departures: number }
function inputsFor(current: Year, previous: Year | undefined, delay = false) {
  const rows = [
    ...monthlyRows('SFO', CURRENT, () => ({ passengers: current.passengers, seats: current.seats, departures: current.departures })),
    ...(previous ? monthlyRows('SFO', PREVIOUS, () => ({ passengers: previous.passengers, seats: previous.seats, departures: previous.departures })) : []),
  ];
  const trend = computeTrafficTrend({ airport: code('SFO'), currentPeriod: CURRENT, previousPeriod: PREVIOUS, rows, provenance: btsProvenance });
  const summary = delay ? summarizeDelays({ airport: code('SFO'), snapshots: [snapshot(0, 2, { flights: 50, qualifiedFlights: 50, cancelled: 5, medianDelayMinutes: 30, delayIndex: 4.5 })], provenance: adbProvenance }) : undefined;
  return [trend, summary] as const;
}

describe('boundedPressure', () => {
  it('clamps below the lower bound and above the upper bound', () => {
    expect(boundedPressure(50, 70, 90)).toBe(0);
    expect(boundedPressure(99, 70, 90)).toBe(100);
    expect(boundedPressure(-0.5, -0.05, 0.1)).toBe(0);
    expect(boundedPressure(0.5, -0.05, 0.1)).toBe(100);
  });

  it('maps the exact bounds to 0 and 100 and interpolates linearly between', () => {
    expect(boundedPressure(70, 70, 90)).toBe(0);
    expect(boundedPressure(90, 70, 90)).toBe(100);
    expect(boundedPressure(80, 70, 90)).toBe(50);
    expect(boundedPressure(0.025, -0.05, 0.1)).toBeCloseTo(50, 10);
    expect(boundedPressure(0, -0.05, 0.05)).toBeCloseTo(50, 10);
    expect(boundedPressure(-0.05, -0.05, 0.05)).toBe(0);
    expect(boundedPressure(0.05, -0.05, 0.05)).toBe(100);
  });
});

describe('pressureBand', () => {
  it('uses lower-inclusive edges at 25, 50 and 75', () => {
    expect(pressureBand(0)).toBe('low');
    expect(pressureBand(24.999999)).toBe('low');
    expect(pressureBand(25)).toBe('moderate');
    expect(pressureBand(49.999999)).toBe('moderate');
    expect(pressureBand(50)).toBe('elevated');
    expect(pressureBand(74.999999)).toBe('elevated');
    expect(pressureBand(75)).toBe('high');
    expect(pressureBand(100)).toBe('high');
  });
});

describe('scoreDemandPressure', () => {
  it('configured weights are exactly 35/25/25/15 and sum to 100%', () => {
    expect(DEMAND_PRESSURE_COMPONENTS.map((c) => c.weight)).toEqual([0.35, 0.25, 0.25, 0.15]);
    expect(DEMAND_PRESSURE_COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 12);
  });

  it('computes the weighted sum of bounded components from known raw values', () => {
    // load factor 80% -> 50; passengers +5% -> (0.05+0.05)/0.15*100 = 66.67; seats +2% -> gap +3pp -> 80; departures +2.5% -> 50
    const result = scoreDemandPressure(...inputsFor({ passengers: 1050, seats: 1312.5, departures: 102.5 }, { passengers: 1000, seats: 1286.7647, departures: 100 }));
    const byId = Object.fromEntries(result.components.map((c) => [c.id, c]));
    expect(result.rawMetrics.loadFactorPercent).toBeCloseTo(80, 6);
    expect(byId.loadFactor).toMatchObject({ status: 'available', pressure: expect.closeTo(50, 4) });
    expect(byId.passengerGrowth).toMatchObject({ pressure: expect.closeTo(66.6667, 3) });
    const expected = 0.35 * (byId.loadFactor as { pressure: number }).pressure + 0.25 * (byId.passengerGrowth as { pressure: number }).pressure + 0.25 * (byId.growthGap as { pressure: number }).pressure + 0.15 * (byId.departureGrowth as { pressure: number }).pressure;
    expect(result.score).toBeCloseTo(expected, 10);
    expect(result.components.every((c) => c.status === 'available' && c.effectiveWeight === c.configuredWeight)).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.rawMetrics.passengerSeatGrowthGap).toBeCloseTo((result.rawMetrics.passengerGrowth ?? 0) - (result.rawMetrics.seatGrowth ?? 0), 12);
  });

  it('scores 100 at the upper bounds and 0 at the lower bounds', () => {
    const max = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 110 }, { passengers: 800, seats: 1000, departures: 100 }));
    // load factor 90%, passengers +12.5%, seats 0% => gap +12.5pp, departures +10%
    expect(max.score).toBeCloseTo(100, 10);
    expect(max.band).toBe('high');
    const min = scoreDemandPressure(...inputsFor({ passengers: 700, seats: 1000, departures: 90 }, { passengers: 800, seats: 1000, departures: 100 }));
    expect(min.score).toBeCloseTo(0, 10);
    expect(min.band).toBe('low');
  });

  it('issues no score when only load factor exists (no previous year)', () => {
    const noPrev = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 100 }, undefined));
    expect(noPrev.availableComponents).toBe(1);
    expect(noPrev.score).toBeUndefined();
    expect(noPrev.band).toBeUndefined();
    expect(noPrev.confidence).toBe('insufficient');
    expect(noPrev.missingSignals.map((m) => m.input)).toEqual(['Passenger Growth', 'Passenger-vs-Seat Growth Gap', 'Departure Growth']);
  });

  it('with the gap missing (seat growth unavailable) scores the other three with renormalized weights', () => {
    // previous seats are zero, so seat growth (and therefore the gap) is unavailable
    const result = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 110 }, { passengers: 800, seats: 0, departures: 100 }));
    expect(result.availableComponents).toBe(3);
    expect(result.confidence).toBe('low');
    const weights = result.components.flatMap((c) => (c.status === 'available' ? [c.effectiveWeight] : []));
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
    const loadFactor = result.components.find((c) => c.id === 'loadFactor');
    expect(loadFactor).toMatchObject({ configuredWeight: 0.35, effectiveWeight: expect.closeTo(0.35 / 0.75, 12) });
    expect(result.components.find((c) => c.id === 'growthGap')).toMatchObject({ status: 'missing', configuredWeight: 0.25 });
    // all three present components are at their upper bound, so renormalization yields exactly 100 (not 75)
    expect(result.score).toBeCloseTo(100, 10);
  });

  it('issues no score with fewer than three numeric components', () => {
    // previous passengers and departures are zero, so passenger growth, the gap and departure growth are unavailable
    const two = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 110 }, { passengers: 0, seats: 1000, departures: 0 }));
    expect(two.score).toBeUndefined();
    expect(two.confidence).toBe('insufficient');
  });

  it('always carries the mandatory notice and never reports passenger counts', () => {
    const result = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 100 }, { passengers: 800, seats: 1000, departures: 100 }));
    expect(result.notice).toBe('This is an indicator of demand/capacity pressure, not an estimate of passengers who could not travel.');
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['unmetPassengers', 'lostPassengers']));
    expect(result.assumptions.join(' ')).toContain('MVP analytical assumptions');
  });

  it('reports delay and cancellation as context without changing the score', () => {
    const without = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 105 }, { passengers: 850, seats: 1000, departures: 100 }));
    const withDelay = scoreDemandPressure(...inputsFor({ passengers: 900, seats: 1000, departures: 105 }, { passengers: 850, seats: 1000, departures: 100 }, true));
    expect(withDelay.score).toBe(without.score);
    expect(withDelay.confidence).toBe(without.confidence);
    expect(without.operationalContext).toEqual({ status: 'not-requested' });
    expect(withDelay.operationalContext).toMatchObject({ status: 'available', departureDelayIndex: 4.5, departureCancellationRate: expect.closeTo(0.1, 12) });
  });
});
