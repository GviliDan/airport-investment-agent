import { describe, expect, it } from 'vitest';
import { EARTH_MEAN_RADIUS_MILES } from './assumptions';
import { greatCircleMiles, isUsablePoint } from './distance';
import { LOCATIONS } from './__tests__/support';

describe('greatCircleMiles', () => {
  it.each([
    ['LAX to JFK', LOCATIONS.LAX, LOCATIONS.JFK, 2475],
    ['SFO to LAX', LOCATIONS.SFO, LOCATIONS.LAX, 337],
    ['ANC to SEA', LOCATIONS.ANC, LOCATIONS.SEA, 1445],
    ['ANC to JFK', LOCATIONS.ANC, LOCATIONS.JFK, 3377],
    ['JFK to LHR', LOCATIONS.JFK, LOCATIONS.LHR, 3451],
  ])('%s is about %i statute miles', (_label, a, b, expected) => {
    expect(greatCircleMiles(a, b)).toBeGreaterThan(expected * 0.99);
    expect(greatCircleMiles(a, b)).toBeLessThan(expected * 1.01);
  });

  it('is zero between identical coordinates', () => {
    expect(greatCircleMiles(LOCATIONS.LAX, LOCATIONS.LAX)).toBe(0);
  });

  it('is symmetric', () => {
    expect(greatCircleMiles(LOCATIONS.ANC, LOCATIONS.JFK)).toBeCloseTo(greatCircleMiles(LOCATIONS.JFK, LOCATIONS.ANC), 9);
  });

  it('matches a quarter of the equator exactly', () => {
    const quarter = greatCircleMiles({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 });
    expect(quarter).toBeCloseTo((Math.PI / 2) * EARTH_MEAN_RADIUS_MILES, 6);
  });

  it('handles antipodal points without NaN', () => {
    const half = greatCircleMiles({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(half).toBeCloseTo(Math.PI * EARTH_MEAN_RADIUS_MILES, 6);
  });

  it('crosses the antimeridian the short way', () => {
    const d = greatCircleMiles({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 });
    expect(d).toBeCloseTo((2 / 360) * 2 * Math.PI * EARTH_MEAN_RADIUS_MILES, 6);
  });
});

describe('isUsablePoint', () => {
  it('accepts valid coordinates and rejects missing, non-finite and out-of-range ones', () => {
    expect(isUsablePoint(LOCATIONS.ANC)).toBe(true);
    expect(isUsablePoint(undefined)).toBe(false);
    expect(isUsablePoint({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isUsablePoint({ latitude: 0, longitude: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isUsablePoint({ latitude: 95, longitude: 0 })).toBe(false);
    expect(isUsablePoint({ latitude: 0, longitude: -181 })).toBe(false);
  });
});
