import { describe, expect, it } from 'vitest';
import { btsProvenance, code, monthlyRows, period, trafficRow } from '../__tests__/support';
import { computeTrafficTrend, deriveComparableWindows } from './trafficTrend';

const previous = period('2024-05', '2025-04');
const current = period('2025-05', '2026-04');
const SFO = code('SFO');

const trend = (rows: ReturnType<typeof monthlyRows>) =>
  computeTrafficTrend({ airport: SFO, currentPeriod: current, previousPeriod: previous, rows, provenance: btsProvenance });

const both = (previousPatch: Record<string, number>, currentPatch: Record<string, number>) => [
  ...monthlyRows('SFO', previous, () => previousPatch),
  ...monthlyRows('SFO', current, () => currentPatch),
];

describe('computeTrafficTrend growth', () => {
  it('computes positive growth as (current - previous) / previous', () => {
    const result = trend(both({ passengers: 1000, seats: 2000, departures: 10 }, { passengers: 1100, seats: 2100, departures: 12 }));
    expect(result.growth.passengers).toEqual({ status: 'available', rate: 0.1 });
    expect(result.growth.seats).toEqual({ status: 'available', rate: 0.05 });
    expect(result.growth.departures).toEqual({ status: 'available', rate: 0.2 });
  });

  it('computes negative growth', () => {
    const result = trend(both({ passengers: 1000 }, { passengers: 900 }));
    expect(result.growth.passengers).toEqual({ status: 'available', rate: expect.closeTo(-0.1, 12) });
  });

  it('reports unchanged traffic as exactly zero growth, not as unavailable', () => {
    const result = trend(both({ passengers: 1000 }, { passengers: 1000 }));
    expect(result.growth.passengers).toEqual({ status: 'available', rate: 0 });
  });

  it('reports a fall to zero as -100%', () => {
    const result = trend(both({ passengers: 1000 }, { passengers: 0 }));
    expect(result.growth.passengers).toEqual({ status: 'available', rate: -1 });
  });

  it('is unavailable, not infinite or zero, when the previous value is zero', () => {
    const result = trend(both({ departures: 0 }, { departures: 50 }));
    expect(result.growth.departures).toEqual({ status: 'unavailable', reason: 'previous-value-zero' });
  });

  it('is unavailable when the previous period has no data at all', () => {
    const result = trend(monthlyRows('SFO', current));
    expect(result.growth.passengers).toEqual({ status: 'unavailable', reason: 'previous-period-incomplete' });
    expect(result.previous.monthsWithData).toBe(0);
    expect(result.previous.totals).toBeUndefined();
    expect(result.current.totals).toBeDefined();
  });

  it('is unavailable when the current period has no data at all', () => {
    const result = trend(monthlyRows('SFO', previous));
    expect(result.growth.passengers).toEqual({ status: 'unavailable', reason: 'current-period-incomplete' });
  });

  it('does not total or compare a period with a missing month', () => {
    const rows = [...monthlyRows('SFO', previous), ...monthlyRows('SFO', current).filter((r) => r.month !== '2026-03')];
    const result = trend(rows);
    expect(result.current.monthsWithData).toBe(11);
    expect(result.current.missingMonths).toEqual(['2026-03']);
    expect(result.current.totals).toBeUndefined();
    expect(result.growth.seats).toEqual({ status: 'unavailable', reason: 'current-period-incomplete' });
    expect(result.missingInputs).toEqual([
      { input: 'current-period traffic 2025-05..2026-04', reason: expect.stringContaining('2026-03') },
    ]);
  });

  it('never produces NaN or infinity', () => {
    const result = trend(both({ passengers: 0, seats: 0, departures: 0 }, { passengers: 0, seats: 0, departures: 0 }));
    for (const g of Object.values(result.growth)) expect(g.status).toBe('unavailable');
  });
});

describe('computeTrafficTrend totals and load factor', () => {
  it('sums each window and computes load factor from the summed passengers and seats', () => {
    const rows = [
      ...monthlyRows('SFO', previous),
      ...monthlyRows('SFO', current, (month) => (month === '2025-05' ? { passengers: 500, seats: 1000 } : { passengers: 900, seats: 1000 })),
    ];
    const totals = trend(rows).current.totals;
    expect(totals?.passengers).toBe(500 + 11 * 900);
    expect(totals?.seats).toBe(12 * 1000);
    expect(totals?.loadFactorPercent).toBeCloseTo((100 * (500 + 11 * 900)) / 12_000, 10);
  });

  it('leaves load factor undefined, and says why, when there are no seats', () => {
    const result = trend(both({ passengers: 0, seats: 0 }, { passengers: 0, seats: 0 }));
    expect(result.current.totals?.loadFactorPercent).toBeUndefined();
    expect(result.missingInputs.some((m) => m.input === 'load factor')).toBe(true);
  });

  it('ignores other airports and keeps cargo-inclusive departures as reported', () => {
    const rows = [...both({ departures: 7 }, { departures: 7 }), ...monthlyRows('LAX', current, () => ({ passengers: 999_999 }))];
    const result = trend(rows);
    expect(result.current.totals?.passengers).toBe(12 * 10_000);
    expect(result.current.totals?.departures).toBe(84);
  });

  it('rejects duplicate airport-months instead of double counting', () => {
    expect(() => trend([...monthlyRows('SFO', current), trafficRow('SFO', '2025-05')])).toThrow(/duplicate/);
  });

  it('carries periods, assumptions and provenance', () => {
    const result = trend(both({}, {}));
    expect(result.current.period).toEqual(current);
    expect(result.previous.period).toEqual(previous);
    expect(result.provenance).toEqual([btsProvenance]);
    expect(result.assumptions.join(' ')).toContain('cargo');
    expect(result.assumptions.join(' ')).toContain('(current - previous) / previous');
  });
});

describe('deriveComparableWindows', () => {
  it('derives the latest 12 months and the 12 before from the last published month', () => {
    expect(deriveComparableWindows(period('2014-01', '2026-04'))).toEqual({ current, previous });
    expect(deriveComparableWindows(period('2014-01', '2026-05'))?.current).toEqual(period('2025-06', '2026-05'));
  });

  it('accepts history that exactly fits both windows and rejects shorter history', () => {
    expect(deriveComparableWindows(period('2024-05', '2026-04'))).toBeDefined();
    expect(deriveComparableWindows(period('2024-06', '2026-04'))).toBeUndefined();
  });

  it('supports other window lengths', () => {
    expect(deriveComparableWindows(period('2020-01', '2026-04'), 6)).toEqual({ current: period('2025-11', '2026-04'), previous: period('2025-05', '2025-10') });
  });
});
