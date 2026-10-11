import { describe, expect, it } from 'vitest';
import { CANDIDATE_MIN_ANNUAL_PASSENGERS, NEW_ENGLAND_STATES } from '../assumptions';
import { airport, btsProvenance, monthlyRows, period } from '../__tests__/support';
import { buildCandidateSet } from './candidateSet';

const window = period('2025-05', '2026-04');
const build = (airports: ReturnType<typeof airport>[], traffic: ReturnType<typeof monthlyRows>) =>
  buildCandidateSet({ airports, traffic, period: window, provenance: [btsProvenance] });
const pax = (total: number) => () => ({ passengers: total / 12 });

describe('buildCandidateSet', () => {
  it('uses exactly the six New England states', () => {
    expect([...NEW_ENGLAND_STATES].sort()).toEqual(['CT', 'MA', 'ME', 'NH', 'RI', 'VT']);
    expect(build([], []).states).toEqual(NEW_ENGLAND_STATES);
  });

  it('joins FAA airports with BTS traffic and marks airports over the threshold eligible', () => {
    const result = build([airport('BOS'), airport('BDL', { state: 'CT' })], [...monthlyRows('BOS', window, pax(21_000_000)), ...monthlyRows('BDL', window, pax(3_000_000))]);
    expect(result.eligible.map((c) => c.airport.code)).toEqual(['BDL', 'BOS']);
    expect(result.eligible[1]?.activity).toEqual({ passengers: 21_000_000, monthsWithData: 12, monthsExpected: 12, complete: true });
    expect(result.excluded).toEqual([]);
  });

  it('excludes airports outside the six states, explicitly', () => {
    const result = build([airport('PBG', { state: 'NY' })], monthlyRows('PBG', window, pax(50_000)));
    expect(result.eligible).toEqual([]);
    expect(result.excluded).toEqual([expect.objectContaining({ reason: 'outside-region', detail: expect.stringContaining('NY') })]);
  });

  it('excludes private-use facilities explicitly, even with traffic', () => {
    const result = build([airport('XYZ', { use: 'private' })], monthlyRows('XYZ', window, pax(500_000)));
    expect(result.excluded.map((e) => e.reason)).toEqual(['not-public-use']);
  });

  it('excludes a public airport BTS has no record for as no-traffic-data, never as zero passengers', () => {
    const result = build([airport('0B5')], []);
    expect(result.excluded).toEqual([{ airport: expect.objectContaining({ code: '0B5' }), reason: 'no-traffic-data', detail: expect.any(String), activity: undefined }]);
  });

  it('excludes a small airport with complete data as below the passenger threshold, with its passenger count', () => {
    const result = build([airport('AUG', { state: 'ME' })], monthlyRows('AUG', window, pax(4_200)));
    expect(result.excluded).toEqual([expect.objectContaining({ reason: 'below-passenger-threshold', activity: expect.objectContaining({ passengers: 4_200, complete: true }) })]);
  });

  it('treats the threshold as inclusive', () => {
    const exact = build([airport('AAA')], monthlyRows('AAA', window, pax(CANDIDATE_MIN_ANNUAL_PASSENGERS)));
    const under = build([airport('BBB')], monthlyRows('BBB', window, pax(CANDIDATE_MIN_ANNUAL_PASSENGERS - 12)));
    expect(exact.eligible).toHaveLength(1);
    expect(under.eligible).toHaveLength(0);
  });

  it('does not exclude as "below" an airport whose missing months could change the answer', () => {
    const rows = monthlyRows('PQI', window, () => ({ passengers: 500 })).slice(0, 3);
    const result = build([airport('PQI', { state: 'ME' })], rows);
    expect(result.excluded).toEqual([expect.objectContaining({ reason: 'insufficient-traffic-data', activity: expect.objectContaining({ passengers: 1_500, monthsWithData: 3, complete: false }) })]);
  });

  it('keeps an airport eligible on partial data when the months present already exceed the threshold, flagged incomplete', () => {
    const rows = monthlyRows('MHT', window, () => ({ passengers: 20_000 })).slice(0, 2);
    const result = build([airport('MHT', { state: 'NH' })], rows);
    expect(result.eligible).toEqual([expect.objectContaining({ activity: expect.objectContaining({ passengers: 40_000, complete: false }) })]);
  });

  it('ignores traffic outside the period', () => {
    const result = build([airport('AAA')], monthlyRows('AAA', period('2024-05', '2025-04'), pax(5_000_000)));
    expect(result.excluded.map((e) => e.reason)).toEqual(['no-traffic-data']);
  });

  it('does not use Part 139 certification to decide eligibility', () => {
    const certifiedButSmall = airport('GON', { state: 'CT', part139: { classification: 'IV A', service: 'unscheduled' } });
    const uncertifiedButBusy = airport('WST', { state: 'RI' });
    const result = build([certifiedButSmall, uncertifiedButBusy], [...monthlyRows('GON', window, pax(80)), ...monthlyRows('WST', window, pax(17_000))]);
    expect(result.eligible.map((c) => c.airport.code)).toEqual(['WST']);
    expect(result.excluded.map((e) => e.airport.code)).toEqual(['GON']);
  });

  it('orders results by airport code and accounts for every airport exactly once', () => {
    const airports = [airport('PVD', { state: 'RI' }), airport('BOS'), airport('0B5'), airport('PBG', { state: 'NY' })];
    const result = build(airports, [...monthlyRows('PVD', window, pax(2_000_000)), ...monthlyRows('BOS', window, pax(20_000_000))]);
    expect(result.eligible.map((c) => c.airport.code)).toEqual(['BOS', 'PVD']);
    expect(result.excluded.map((e) => e.airport.code)).toEqual(['0B5', 'PBG']);
    expect(result.eligible.length + result.excluded.length).toBe(airports.length);
  });

  it('states the rule, what BTS passengers represent, and carries provenance and period', () => {
    const result = build([], []);
    const text = result.assumptions.join(' ');
    expect(text).toContain('Part 139 certification is not used');
    expect(text).toContain('approximate, and are not identical to, FAA enplanements');
    expect(result.minAnnualPassengers).toBe(10_000);
    expect(result.period).toEqual(window);
    expect(result.provenance).toEqual([btsProvenance]);
  });

  it('rejects duplicate traffic records', () => {
    expect(() => build([airport('AAA')], [...monthlyRows('AAA', window), ...monthlyRows('AAA', window)])).toThrow(/duplicate/);
  });
});
