import { describe, expect, it } from 'vitest';
import { AirportCodeSchema, CountryCodeSchema } from './codes';
import { monthsInPeriod, PeriodSchema, precedingPeriod, trailingPeriod, YearMonthSchema } from './period';
import { AirportSchema } from './airport';
import { AirportDelaySnapshotSchema } from './delays';
import { RouteFrequencySchema } from './routes';
import { AirportMonthlyTrafficSchema } from './traffic';

describe('AirportCodeSchema', () => {
  it.each(['BOS', 'ANC', '1G4', 'W33', 'A43'])('accepts %s', (code) => {
    expect(AirportCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(['bos', 'BO', 'BOST', '', 'B-S', 'B S', 'bOS'])('rejects %j', (code) => {
    expect(AirportCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('CountryCodeSchema', () => {
  it('accepts two uppercase letters only', () => {
    expect(CountryCodeSchema.safeParse('US').success).toBe(true);
    expect(CountryCodeSchema.safeParse('usa').success).toBe(false);
  });
});

describe('YearMonthSchema', () => {
  it.each(['2025-01', '2026-12', '1999-09'])('accepts %s', (v) => expect(YearMonthSchema.safeParse(v).success).toBe(true));
  it.each(['2025-13', '2025-00', '2025-1', '25-01', '2025/01', '2025-01-01', ''])('rejects %j', (v) => {
    expect(YearMonthSchema.safeParse(v).success).toBe(false);
  });
});

describe('PeriodSchema', () => {
  it('accepts a single month and an ordered range', () => {
    expect(PeriodSchema.safeParse({ start: '2025-07', end: '2025-07' }).success).toBe(true);
    expect(PeriodSchema.safeParse({ start: '2025-07', end: '2026-06' }).success).toBe(true);
  });

  it('rejects an end before the start', () => {
    expect(PeriodSchema.safeParse({ start: '2026-06', end: '2025-07' }).success).toBe(false);
  });
});

describe('period helpers', () => {
  const period = PeriodSchema.parse({ start: '2025-11', end: '2026-02' });

  it('lists every month across a year boundary', () => {
    expect(monthsInPeriod(period)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('trailingPeriod and precedingPeriod', () => {
  it('builds the trailing twelve months and the twelve before them across year boundaries', () => {
    const window = trailingPeriod(YearMonthSchema.parse('2026-04'), 12);
    expect(window).toEqual({ start: '2025-05', end: '2026-04' });
    expect(precedingPeriod(window)).toEqual({ start: '2024-05', end: '2025-04' });
  });

  it('handles a single month and January boundaries', () => {
    expect(trailingPeriod(YearMonthSchema.parse('2026-01'), 1)).toEqual({ start: '2026-01', end: '2026-01' });
    expect(trailingPeriod(YearMonthSchema.parse('2026-01'), 2)).toEqual({ start: '2025-12', end: '2026-01' });
    expect(precedingPeriod(PeriodSchema.parse({ start: '2026-01', end: '2026-03' }))).toEqual({ start: '2025-10', end: '2025-12' });
  });

  it('rejects a non-positive length', () => {
    expect(() => trailingPeriod(YearMonthSchema.parse('2026-01'), 0)).toThrow(RangeError);
  });
});

describe('AirportMonthlyTrafficSchema', () => {
  const valid = {
    airport: 'SFO',
    month: '2026-04',
    departures: 17000,
    passengers: 2_400_000,
    seats: 2_900_000,
    freightLbs: 56_000_000,
    mailLbs: 1_000_000,
  };

  it('accepts a record whose optional fields are absent', () => {
    const parsed = AirportMonthlyTrafficSchema.parse(valid);
    expect(parsed.loadFactorPercent).toBeUndefined();
    expect(parsed).not.toHaveProperty('domesticDepartures');
  });

  it.each([
    ['negative passengers', { passengers: -1 }],
    ['fractional seats', { seats: 1.5 }],
    ['invalid month', { month: '2026-13' }],
    ['malformed airport code', { airport: 'sfo' }],
    ['negative load factor', { loadFactorPercent: -1 }],
  ])('rejects %s', (_label, patch) => {
    expect(AirportMonthlyTrafficSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('AirportSchema', () => {
  const valid = {
    code: '1G4',
    name: 'GRAND CANYON WEST',
    city: 'PEACH SPRINGS',
    state: 'AZ',
    location: { latitude: 35.99, longitude: -113.82 },
    use: 'public',
  };

  it('accepts an airport identified by an FAA identifier with digits, without optional fields', () => {
    expect(AirportSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects impossible coordinates and unknown use', () => {
    expect(AirportSchema.safeParse({ ...valid, location: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(AirportSchema.safeParse({ ...valid, use: 'military' }).success).toBe(false);
  });
});

describe('RouteFrequencySchema', () => {
  it('allows a destination without coordinates but not a negative frequency', () => {
    const route = { destination: { name: 'Somewhere' }, averageDailyFlights: 1.5, operators: [] };
    expect(RouteFrequencySchema.safeParse(route).success).toBe(true);
    expect(RouteFrequencySchema.safeParse({ ...route, averageDailyFlights: -1 }).success).toBe(false);
  });
});

describe('AirportDelaySnapshotSchema', () => {
  const summary = { flights: 10, qualifiedFlights: 9, cancelled: 0 };
  const valid = { windowStart: '2026-10-06T13:00:00Z', windowEnd: '2026-10-06T15:00:00Z', departures: summary, arrivals: summary };

  it('keeps an unknown median delay unknown', () => {
    const parsed = AirportDelaySnapshotSchema.parse(valid);
    expect(parsed.arrivals.medianDelayMinutes).toBeUndefined();
  });

  it('rejects a delay index outside 0-5', () => {
    expect(AirportDelaySnapshotSchema.safeParse({ ...valid, departures: { ...summary, delayIndex: 6 } }).success).toBe(false);
  });
});
