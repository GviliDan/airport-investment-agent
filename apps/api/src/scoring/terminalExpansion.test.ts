import { describe, expect, it } from 'vitest';
import { buildCandidateSet } from '../analytics/candidateSet/candidateSet';
import { computeTrafficTrend } from '../analytics/traffic/trafficTrend';
import { airport, btsProvenance, code, monthlyRows, period } from '../analytics/__tests__/support';
import { rankTerminalExpansion } from './terminalExpansion';
import { TERMINAL_EXPANSION_FACTORS } from './scoringConfig';

const CURRENT = period('2025-05', '2026-04');
const PREVIOUS = period('2024-05', '2025-04');
const WINDOWS = { current: CURRENT, previous: PREVIOUS };

/** Monthly figures; annual totals are 12x. */
interface Spec {
  code: string;
  now: { passengers: number; seats: number; departures: number };
  before?: { passengers: number; seats: number; departures: number } | 'none';
  /** Drop the current-period months from this month on, making the current window incomplete. */
  dropCurrent?: boolean;
}

function run(specs: Spec[]) {
  const airports = specs.map((s) => airport(s.code));
  const rows = specs.flatMap((s) => {
    const before = s.before === 'none' ? undefined : (s.before ?? s.now);
    return [
    ...(s.dropCurrent ? [] : monthlyRows(s.code, CURRENT, () => s.now)),
    ...(before ? monthlyRows(s.code, PREVIOUS, () => before) : []),
    ];
  });
  // Eligibility uses the current window only; keep dropped airports eligible with one month of data.
  const eligibilityRows = specs.flatMap((s) => (s.dropCurrent ? monthlyRows(s.code, period('2026-04', '2026-04'), () => ({ passengers: 50_000 })) : []));
  const candidates = buildCandidateSet({ airports, traffic: [...rows, ...eligibilityRows], period: CURRENT, provenance: [btsProvenance] });
  const trends = candidates.eligible.map((c) =>
    computeTrafficTrend({ airport: c.airport.code, currentPeriod: CURRENT, previousPeriod: PREVIOUS, rows: [...rows, ...eligibilityRows], provenance: btsProvenance }),
  );
  return rankTerminalExpansion({ candidates, trends, regionName: 'Test region', windows: WINDOWS, trafficProvenance: [btsProvenance] });
}

const flat = (passengers: number, seats = passengers * 1.25, departures = 100) => ({ passengers, seats, departures });

describe('rankTerminalExpansion', () => {
  it('uses exactly the approved profile, five factors and weights summing to 100%', () => {
    const ranking = run([{ code: 'AAA', now: flat(10_000) }]);
    expect(ranking.profile).toBe('terminal-expansion-v1');
    expect(ranking.weights.map((w) => [w.id, w.weight])).toEqual([
      ['passengerScale', 0.3],
      ['passengerGrowth', 0.25],
      ['demandCapacityGrowthGap', 0.2],
      ['departureGrowth', 0.15],
      ['loadFactor', 0.1],
    ]);
    expect(TERMINAL_EXPANSION_FACTORS.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 12);
  });

  it('carries the exact scope notice', () => {
    expect(run([{ code: 'AAA', now: flat(10_000) }]).scopeNotice).toBe(
      'Scores are relative to the airports included in this ranking and should not be compared across separate ranking runs.',
    );
  });

  it('applies the exact weights to the percentiles and exposes raw values, percentiles and contributions', () => {
    // Three airports ordered the same way on every factor: A < B < C, so percentiles are 0, 50, 100.
    const ranking = run([
      { code: 'AAA', now: { passengers: 10_000, seats: 14_000, departures: 100 }, before: { passengers: 10_000, seats: 10_000, departures: 100 } },
      { code: 'BBB', now: { passengers: 20_000, seats: 26_000, departures: 110 }, before: { passengers: 18_000, seats: 20_000, departures: 100 } },
      { code: 'CCC', now: { passengers: 30_000, seats: 30_000, departures: 130 }, before: { passengers: 20_000, seats: 24_000, departures: 100 } },
    ]);
    const [first, second, third] = ranking.ranked;
    expect(ranking.ranked.map((r) => r.airport.code)).toEqual(['CCC', 'BBB', 'AAA']);
    expect(first?.score).toBeCloseTo(100, 10);
    expect(second?.score).toBeCloseTo(50, 10);
    expect(third?.score).toBeCloseTo(0, 10);
    expect(first?.rank).toBe(1);
    expect(third?.rank).toBe(3);
    const factor = first?.factors.find((f) => f.id === 'passengerGrowth');
    expect(factor).toMatchObject({ status: 'available', percentile: 100, configuredWeight: 0.25, effectiveWeight: 0.25 });
    if (factor?.status === 'available') expect(factor.raw).toBeCloseTo(0.5, 12);
    const gap = first?.factors.find((f) => f.id === 'demandCapacityGrowthGap');
    // CCC: passengers +50%, seats +25% -> gap +25 pp
    if (gap?.status === 'available') expect(gap.raw).toBeCloseTo(0.25, 12);
    const scale = first?.factors.find((f) => f.id === 'passengerScale');
    if (scale?.status === 'available') expect(scale.raw).toBe(360_000);
  });

  it('weights mixed percentiles exactly (30/25/20/15/10)', () => {
    // BBB is best on scale and load factor only; AAA is best on the three growth factors.
    const ranking = run([
      { code: 'AAA', now: { passengers: 10_000, seats: 20_000, departures: 120 }, before: { passengers: 5_000, seats: 20_000, departures: 100 } },
      { code: 'BBB', now: { passengers: 20_000, seats: 21_000, departures: 100 }, before: { passengers: 20_000, seats: 20_000, departures: 100 } },
    ]);
    const bbb = ranking.ranked.find((r) => r.airport.code === 'BBB');
    const aaa = ranking.ranked.find((r) => r.airport.code === 'AAA');
    // n = 2 -> percentiles are 0 or 100. BBB: scale + load factor = 0.30 + 0.10 -> 40. AAA: 25 + 20 + 15 = 60.
    expect(bbb?.score).toBeCloseTo(40, 10);
    expect(aaa?.score).toBeCloseTo(60, 10);
    expect(ranking.ranked[0]?.airport.code).toBe('AAA');
  });

  it('allows negative growth', () => {
    const ranking = run([
      { code: 'AAA', now: flat(8_000), before: flat(10_000) },
      { code: 'BBB', now: flat(10_000), before: flat(10_000) },
      { code: 'CCC', now: flat(12_000), before: flat(10_000) },
    ]);
    const growth = ranking.ranked.find((r) => r.airport.code === 'AAA')?.factors.find((f) => f.id === 'passengerGrowth');
    expect(growth).toMatchObject({ status: 'available', percentile: 0 });
    if (growth?.status === 'available') expect(growth.raw).toBeCloseTo(-0.2, 12);
  });

  it('gives tied values the same percentile', () => {
    const ranking = run([
      { code: 'AAA', now: flat(10_000), before: flat(10_000) },
      { code: 'BBB', now: flat(10_000), before: flat(10_000) },
      { code: 'CCC', now: flat(30_000), before: flat(10_000) },
    ]);
    const scale = (c: string) => ranking.ranked.find((r) => r.airport.code === c)?.factors.find((f) => f.id === 'passengerScale');
    expect(scale('AAA')).toMatchObject({ percentile: 25 });
    expect(scale('BBB')).toMatchObject({ percentile: 25 });
    expect(scale('CCC')).toMatchObject({ percentile: 100 });
  });

  it('scores a lone candidate, and candidates with identical values, at the neutral 50', () => {
    const lone = run([{ code: 'AAA', now: flat(10_000) }]);
    expect(lone.ranked).toHaveLength(1);
    expect(lone.ranked[0]?.score).toBeCloseTo(50, 10);
    const same = run([{ code: 'AAA', now: flat(10_000) }, { code: 'BBB', now: flat(10_000) }]);
    expect(same.ranked.map((r) => r.score)).toEqual([50, 50].map((v) => expect.closeTo(v, 10)));
  });

  it('breaks exact score ties by airport code ascending, whatever the input order', () => {
    const specs: Spec[] = [{ code: 'ZZZ', now: flat(10_000) }, { code: 'AAA', now: flat(10_000) }, { code: 'MMM', now: flat(10_000) }];
    expect(run(specs).ranked.map((r) => [r.rank, r.airport.code])).toEqual([[1, 'AAA'], [2, 'MMM'], [3, 'ZZZ']]);
    expect(run([...specs].reverse()).ranked.map((r) => r.airport.code)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('is deterministic: the same inputs give identical results', () => {
    const specs: Spec[] = [
      { code: 'AAA', now: flat(12_000), before: flat(10_000) },
      { code: 'BBB', now: flat(15_000), before: flat(14_000) },
      { code: 'CCC', now: flat(9_000), before: flat(9_500) },
    ];
    expect(run(specs)).toEqual(run(specs));
  });

  it('renormalizes the remaining weights when a factor is missing and downgrades confidence', () => {
    // CCC has no previous year: three growth factors are missing, leaving scale and load factor only (2 < 3) -> unscored.
    // BBB has a previous year but no seat history change is needed; make seats zero previously to lose growth-of-seats gap.
    const ranking = run([
      { code: 'AAA', now: flat(10_000), before: flat(9_000) },
      { code: 'BBB', now: flat(20_000), before: { passengers: 18_000, seats: 0, departures: 100 } },
      { code: 'CCC', now: flat(30_000), before: flat(25_000) },
    ]);
    const bbb = ranking.ranked.find((r) => r.airport.code === 'BBB');
    expect(bbb?.missingFactors).toEqual(['demandCapacityGrowthGap']);
    expect(bbb?.factorsAvailable).toBe(4);
    expect(bbb?.confidence).toBe('medium');
    const effective = bbb?.factors.flatMap((f) => (f.status === 'available' ? [f.effectiveWeight] : [])) ?? [];
    expect(effective.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
    expect(bbb?.factors.find((f) => f.id === 'passengerScale')).toMatchObject({ configuredWeight: 0.3, effectiveWeight: expect.closeTo(0.3 / 0.8, 12) });
    expect(bbb?.factors.find((f) => f.id === 'demandCapacityGrowthGap')).toMatchObject({ status: 'missing', reason: expect.stringContaining('seats') });
    // the score is the renormalized weighted sum, not penalized for the missing factor
    const sum = bbb?.factors.reduce((s, f) => (f.status === 'available' ? s + f.percentile * (f.configuredWeight / 0.8) : s), 0);
    expect(bbb?.score).toBeCloseTo(sum ?? Number.NaN, 10);
    expect(ranking.ranked.find((r) => r.airport.code === 'AAA')?.confidence).toBe('high');
  });

  it('reports an airport with too few factors as unscored, with a reason, instead of dropping it', () => {
    const ranking = run([
      { code: 'AAA', now: flat(10_000), before: flat(9_000) },
      { code: 'BBB', now: flat(20_000), before: 'none' },
    ]);
    expect(ranking.candidateCount).toBe(2);
    expect(ranking.rankedCount).toBe(1);
    expect(ranking.ranked.map((r) => r.airport.code)).toEqual(['AAA']);
    expect(ranking.unscored).toEqual([
      expect.objectContaining({
        airport: expect.objectContaining({ code: 'BBB' }),
        reason: expect.stringContaining('2 of 5'),
        missingFactors: ['passengerGrowth', 'demandCapacityGrowthGap', 'departureGrowth'],
      }),
    ]);
  });

  it('treats a missing factor as missing, not zero, when the current window is incomplete', () => {
    const ranking = run([
      { code: 'AAA', now: flat(10_000), before: flat(9_000) },
      { code: 'BBB', now: flat(20_000), before: flat(18_000), dropCurrent: true },
    ]);
    expect(ranking.ranked.map((r) => r.airport.code)).toEqual(['AAA']);
    expect(ranking.unscored[0]?.missingFactors).toHaveLength(5);
  });

  it('changes percentiles when the candidate set changes (scores are set-relative)', () => {
    const a: Spec = { code: 'AAA', now: flat(10_000), before: flat(10_000) };
    const b: Spec = { code: 'BBB', now: flat(20_000), before: flat(10_000) };
    const c: Spec = { code: 'CCC', now: flat(40_000), before: flat(10_000) };
    const small = run([a, b]).ranked.find((r) => r.airport.code === 'BBB');
    const large = run([a, b, c]).ranked.find((r) => r.airport.code === 'BBB');
    expect(small?.factors.find((f) => f.id === 'passengerScale')).toMatchObject({ percentile: 100 });
    expect(large?.factors.find((f) => f.id === 'passengerScale')).toMatchObject({ percentile: 50 });
    expect(small?.score).not.toBe(large?.score);
  });

  it('reports the region, observation periods, counts, exclusions and notices', () => {
    const ranking = run([{ code: 'AAA', now: flat(10_000), before: flat(9_000) }]);
    expect(ranking.region.name).toBe('Test region');
    expect(ranking.observation).toEqual(WINDOWS);
    expect(ranking.candidateCount).toBe(1);
    expect(ranking.excludedCount).toBe(0);
    expect(ranking.interpretationNotice).toContain('not ROI');
    expect(ranking.assumptions.join(' ')).toContain('mid-rank percentile');
    expect(ranking.assumptions.join(' ')).toContain('AeroDataBox delay snapshots are excluded');
    expect(ranking.provenance.length).toBeGreaterThan(0);
  });

  it('reports a candidate with no trend as unscored', () => {
    const candidates = buildCandidateSet({ airports: [airport('AAA')], traffic: monthlyRows('AAA', CURRENT, () => ({ passengers: 10_000 })), period: CURRENT, provenance: [btsProvenance] });
    const ranking = rankTerminalExpansion({ candidates, trends: [], regionName: 'x', windows: WINDOWS, trafficProvenance: [] });
    expect(ranking.unscored[0]).toMatchObject({ airport: { code: code('AAA') }, missingFactors: expect.any(Array) });
    expect(ranking.ranked).toEqual([]);
  });
});
