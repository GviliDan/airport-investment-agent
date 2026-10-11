import { describe, expect, it } from 'vitest';
import { LONG_HAUL_DEFAULT_MILES } from '../assumptions';
import { greatCircleMiles } from '../distance';
import { adbProvenance, code, LOCATIONS, route } from '../__tests__/support';
import { computeLongHaulShare } from './longHaul';

const origin = { code: code('ANC'), location: LOCATIONS.ANC };
const compute = (routes: Parameters<typeof computeLongHaulShare>[0]['routes'], thresholdMiles?: number) =>
  computeLongHaulShare({ origin, routes, provenance: adbProvenance, ...(thresholdMiles === undefined ? {} : { thresholdMiles }) });

describe('computeLongHaulShare', () => {
  it('uses the approved default of 3,000 statute miles and says so', () => {
    expect(LONG_HAUL_DEFAULT_MILES).toBe(3000);
    const result = compute([route('SEA', 20, LOCATIONS.SEA)]);
    expect(result.thresholdMiles).toBe(3000);
    expect(result.thresholdSource).toBe('default');
  });

  it('weights routes by averageDailyFlights, not by destination count', () => {
    // ANC-SEA (~1,445 mi) 99 flights/day, ANC-JFK (~3,377 mi) 1 flight/day.
    const result = compute([route('SEA', 99, LOCATIONS.SEA), route('JFK', 1, LOCATIONS.JFK)]);
    expect(result.share).toBeCloseTo(0.01, 12);
    expect(result.longHaulAverageDailyFlights).toBe(1);
    expect(result.totalAverageDailyFlights).toBe(100);
    expect(result.routeCount).toBe(2);
  });

  it('counts a route at exactly the threshold as long-haul (inclusive), and just under it as not', () => {
    const exact = greatCircleMiles(origin.location, LOCATIONS.JFK);
    expect(compute([route('JFK', 4, LOCATIONS.JFK), route('SEA', 6, LOCATIONS.SEA)], exact).share).toBeCloseTo(0.4, 12);
    expect(compute([route('JFK', 4, LOCATIONS.JFK), route('SEA', 6, LOCATIONS.SEA)], exact + 0.001).share).toBe(0);
  });

  it('applies a custom threshold and labels it as user-supplied', () => {
    const routes = [route('SEA', 10, LOCATIONS.SEA), route('JFK', 10, LOCATIONS.JFK)];
    const lower = compute(routes, 1000);
    expect(lower.thresholdMiles).toBe(1000);
    expect(lower.thresholdSource).toBe('user');
    expect(lower.share).toBe(1);
    expect(compute(routes, 3000).thresholdSource).toBe('user');
    expect(compute(routes, 3000).share).toBe(0.5);
  });

  it('rejects a non-positive or non-finite threshold', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => compute([], bad)).toThrow(RangeError);
  });

  it('returns an undefined share, not zero, when there are no routes', () => {
    const result = compute([]);
    expect(result.share).toBeUndefined();
    expect(result.shareRange).toBeUndefined();
    expect(result.totalAverageDailyFlights).toBe(0);
    expect(result.missingInputs).toEqual([{ input: 'routes', reason: expect.any(String) }]);
    expect(result.distanceBands.every((b) => b.share === undefined && b.averageDailyFlights === 0)).toBe(true);
  });

  it('keeps routes without coordinates in the denominator, reports them, and bounds the share', () => {
    const result = compute([route('SEA', 6, LOCATIONS.SEA), route('JFK', 2, LOCATIONS.JFK), route('XXX', 2)]);
    expect(result.totalAverageDailyFlights).toBe(10);
    expect(result.share).toBeCloseTo(0.2, 12);
    expect(result.unclassifiedAverageDailyFlights).toBe(2);
    expect(result.shareRange).toEqual({ min: expect.closeTo(0.2, 12), max: expect.closeTo(0.4, 12) });
    expect(result.unclassifiedRoutes).toEqual([{ destination: 'XXX', averageDailyFlights: 2, reason: expect.stringContaining('coordinates') }]);
    expect(result.classifiedRouteCount).toBe(2);
    expect(result.missingInputs[0]?.input).toBe('destination coordinates');
  });

  it('treats non-finite coordinates as missing', () => {
    const result = compute([route('BAD', 3, { latitude: Number.NaN, longitude: 0 }), route('JFK', 1, LOCATIONS.JFK)]);
    expect(result.unclassifiedAverageDailyFlights).toBe(3);
    expect(result.longHaulAverageDailyFlights).toBe(1);
  });

  it('has equal bounds when every route can be placed', () => {
    const result = compute([route('SEA', 3, LOCATIONS.SEA), route('JFK', 1, LOCATIONS.JFK)]);
    expect(result.shareRange?.min).toBe(result.shareRange?.max);
  });

  it('weights distance bands by flights and shares them over the same denominator', () => {
    const result = compute([
      route('SEA', 10, LOCATIONS.SEA), // ~1,445 mi
      route('LAX', 5, LOCATIONS.LAX), // ~2,343 mi
      route('JFK', 3, LOCATIONS.JFK), // ~3,377 mi
      route('NRB', 2, { latitude: 61.5, longitude: -150 }), // < 1,000 mi
    ]);
    expect(result.distanceBands.map((b) => [b.label, b.averageDailyFlights])).toEqual([
      ['<1000', 2],
      ['1000-1999', 10],
      ['2000-2999', 5],
      ['>=3000', 3],
    ]);
    expect(result.distanceBands.map((b) => b.share)).toEqual([2 / 20, 10 / 20, 5 / 20, 3 / 20]);
    expect(result.distanceBands.at(-1)?.maxMilesExclusive).toBeNull();
  });

  it('lists long-haul routes by frequency and exposes distances', () => {
    const result = compute([route('JFK', 1, LOCATIONS.JFK), route('LHR', 4, LOCATIONS.LHR)]);
    expect(result.longHaulRoutes.map((r) => r.destination)).toEqual(['LHR', 'JFK']);
    expect(result.longHaulRoutes[0]?.distanceMiles).toBeGreaterThan(3000);
  });

  it('is deterministic regardless of route order', () => {
    const routes = [route('SEA', 9, LOCATIONS.SEA), route('JFK', 1, LOCATIONS.JFK), route('LHR', 2, LOCATIONS.LHR), route('XXX', 1)];
    expect(compute([...routes].reverse())).toEqual(compute(routes));
  });

  it('keeps the scheduled, all-service-types semantics explicit and does not use operator names', () => {
    const cargoHeavy = [route('JFK', 6, LOCATIONS.JFK, ['Atlas Air', 'Cathay Pacific']), route('SEA', 4, LOCATIONS.SEA, ['Alaska Airlines'])];
    const result = compute(cargoHeavy);
    expect(result.share).toBeCloseTo(0.6, 12);
    const text = result.assumptions.join(' ');
    expect(text).toContain('SCHEDULED');
    expect(text).toContain('NOT a passenger-only');
    expect(text).toContain('great-circle');
    expect(result.observationDescription).toContain('7 days before 2026-10-07');
    expect(result.provenance).toEqual([adbProvenance]);
  });
});
