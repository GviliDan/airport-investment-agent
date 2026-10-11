import { describe, expect, it, vi } from 'vitest';
import { adbProvenance, airport, btsProvenance, code, LOCATIONS, monthlyRows, period, route, snapshot } from '../analytics/__tests__/support';
import type { Airport } from '../domain/airport';
import type { Period } from '../domain/period';
import type { AirportMonthlyTraffic } from '../domain/traffic';
import { AirportAnalyticsService, type AirportAnalyticsPorts } from './airportAnalyticsService';
import { AirportNotFoundError, AnalysisUnavailableError } from './errors';
import type { AirportDirectory } from './ports';

const AVAILABLE = period('2014-01', '2026-04');
const WINDOW = { from: '2026-10-06T08:00', to: '2026-10-06T20:00' };

interface FakeData {
  airports?: Airport[];
  traffic?: AirportMonthlyTraffic[];
  available?: Period;
  withAeroDataBox?: boolean;
}

/** In-memory ports that record how often the (quota-costing) providers are called. */
function fakes({ airports = [], traffic = [], available = AVAILABLE, withAeroDataBox = true }: FakeData = {}) {
  const airportsByCode = vi.fn(async (codes: readonly string[]) => ({ data: airports.filter((a) => codes.includes(a.code)), provenance: { ...btsProvenance, source: 'faa-arcgis' as const } }));
  const searchAirports = vi.fn<AirportDirectory['searchAirports']>(async () => ({ data: [], provenance: { ...btsProvenance, source: 'faa-arcgis' as const } }));
  const airportsInStates = vi.fn<AirportDirectory['airportsInStates']>(async () => ({ data: airports, provenance: { ...btsProvenance, source: 'faa-arcgis' as const } }));
  const monthlyTraffic = vi.fn(async ({ airports: wanted, period: p }: { airports: readonly string[]; period: Period }) => ({
    data: traffic.filter((r) => wanted.includes(r.airport) && r.month >= p.start && r.month <= p.end),
    provenance: { ...btsProvenance, period: p },
  }));
  const availablePeriod = vi.fn(async () => ({ data: available, provenance: { ...btsProvenance, period: available } }));
  const dailyRoutes = vi.fn(async () => ({ data: [route('SEA', 10, LOCATIONS.SEA), route('JFK', 5, LOCATIONS.JFK)], provenance: adbProvenance }));
  const delaySnapshots = vi.fn(async () => ({ data: [snapshot(0, 2, { flights: 20, qualifiedFlights: 20, medianDelayMinutes: 4, delayIndex: 0.3 })], provenance: adbProvenance }));
  const ports = {
    airports: { airportsByCode, airportsInStates, searchAirports } as unknown as AirportAnalyticsPorts['airports'],
    traffic: { monthlyTraffic, availablePeriod } as unknown as AirportAnalyticsPorts['traffic'],
    routes: withAeroDataBox ? ({ dailyRoutes } as unknown as AirportAnalyticsPorts['routes']) : undefined,
    delays: withAeroDataBox ? ({ delaySnapshots } as unknown as AirportAnalyticsPorts['delays']) : undefined,
  };
  return { service: new AirportAnalyticsService(ports), airportsByCode, airportsInStates, monthlyTraffic, availablePeriod, dailyRoutes, delaySnapshots };
}

const sfoTraffic = () => [
  ...monthlyRows('SFO', period('2024-05', '2025-04'), () => ({ passengers: 1000, seats: 1250 })),
  ...monthlyRows('SFO', period('2025-05', '2026-04'), () => ({ passengers: 1100, seats: 1300 })),
];

describe('trafficTrend', () => {
  it('derives the windows from BTS availability and fetches both windows in one BTS request', async () => {
    const { service, availablePeriod, monthlyTraffic, airportsByCode, dailyRoutes, delaySnapshots } = fakes({ traffic: sfoTraffic() });
    const result = await service.trafficTrend(code('SFO'));
    expect(result.current.period).toEqual(period('2025-05', '2026-04'));
    expect(result.previous.period).toEqual(period('2024-05', '2025-04'));
    expect(result.growth.passengers).toEqual({ status: 'available', rate: expect.closeTo(0.1, 12) });
    expect(availablePeriod).toHaveBeenCalledTimes(1);
    expect(monthlyTraffic).toHaveBeenCalledTimes(1);
    expect(monthlyTraffic).toHaveBeenCalledWith({ airports: ['SFO'], period: period('2024-05', '2026-04') });
    expect(airportsByCode).not.toHaveBeenCalled();
    expect(dailyRoutes).not.toHaveBeenCalled();
    expect(delaySnapshots).not.toHaveBeenCalled();
  });

  it('follows a newer BTS release without code changes', async () => {
    const { service } = fakes({ available: period('2014-01', '2026-05'), traffic: [] });
    expect((await service.trafficTrend(code('SFO'))).current.period).toEqual(period('2025-06', '2026-05'));
  });

  it('reports missing data rather than failing when the airport has no traffic', async () => {
    const result = await fakes().service.trafficTrend(code('SFO'));
    expect(result.growth.passengers.status).toBe('unavailable');
    expect(result.missingInputs).toHaveLength(2);
  });

  it('fails clearly when BTS history is too short for two windows', async () => {
    const { service, monthlyTraffic } = fakes({ available: period('2025-01', '2026-04') });
    await expect(service.trafficTrend(code('SFO'))).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(monthlyTraffic).not.toHaveBeenCalled();
  });
});

describe('longHaulShare', () => {
  it('looks the origin up in the FAA directory, then makes one AeroDataBox routes request', async () => {
    const anc = airport('ANC', { state: 'AK', location: LOCATIONS.ANC });
    const { service, airportsByCode, dailyRoutes, monthlyTraffic, delaySnapshots } = fakes({ airports: [anc] });
    const result = await service.longHaulShare(code('ANC'));
    expect(result.airport).toBe('ANC');
    expect(result.thresholdSource).toBe('default');
    expect(result.longHaulAverageDailyFlights).toBe(5);
    expect(result.share).toBeCloseTo(5 / 15, 12);
    expect(airportsByCode).toHaveBeenCalledTimes(1);
    expect(dailyRoutes).toHaveBeenCalledTimes(1);
    expect(monthlyTraffic).not.toHaveBeenCalled();
    expect(delaySnapshots).not.toHaveBeenCalled();
  });

  it('passes a custom threshold through', async () => {
    const { service } = fakes({ airports: [airport('ANC', { location: LOCATIONS.ANC })] });
    const result = await service.longHaulShare(code('ANC'), { thresholdMiles: 1000 });
    expect(result).toMatchObject({ thresholdMiles: 1000, thresholdSource: 'user', share: 1 });
  });

  it('fails without spending AeroDataBox quota when the airport is unknown to the FAA', async () => {
    const { service, dailyRoutes } = fakes({ airports: [] });
    await expect(service.longHaulShare(code('ZZZ'))).rejects.toBeInstanceOf(AirportNotFoundError);
    expect(dailyRoutes).not.toHaveBeenCalled();
  });

  it('fails clearly, with no calls at all, when AeroDataBox is not configured', async () => {
    const { service, airportsByCode } = fakes({ airports: [airport('ANC')], withAeroDataBox: false });
    await expect(service.longHaulShare(code('ANC'))).rejects.toThrow(/AERODATABOX_API_KEY/);
    expect(airportsByCode).not.toHaveBeenCalled();
  });
});

describe('delaySummary', () => {
  it('makes one AeroDataBox request for the given window and summarizes it', async () => {
    const { service, delaySnapshots } = fakes();
    const result = await service.delaySummary(code('LAX'), WINDOW);
    expect(delaySnapshots).toHaveBeenCalledTimes(1);
    expect(delaySnapshots).toHaveBeenCalledWith({ airport: 'LAX', ...WINDOW });
    expect(result.departures?.flights).toBe(20);
  });

  it('fails clearly when AeroDataBox is not configured', async () => {
    await expect(fakes({ withAeroDataBox: false }).service.delaySummary(code('LAX'), WINDOW)).rejects.toBeInstanceOf(AnalysisUnavailableError);
  });
});

describe('rankNewEnglandTerminalExpansion', () => {
  const airports = [airport('BOS'), airport('BDL', { state: 'CT' }), airport('PVD', { state: 'RI' }), airport('0B5')];
  const both = (id: string, now: number, before: number) => [
    ...monthlyRows(id, period('2024-05', '2025-04'), () => ({ passengers: before, seats: before * 1.2 })),
    ...monthlyRows(id, period('2025-05', '2026-04'), () => ({ passengers: now, seats: now * 1.2 })),
  ];
  const traffic = [...both('BOS', 1_500_000, 1_400_000), ...both('BDL', 250_000, 200_000), ...both('PVD', 90_000, 95_000)];

  it('ranks from FAA and BTS only and never calls AeroDataBox', async () => {
    const { service, airportsInStates, monthlyTraffic, availablePeriod, dailyRoutes, delaySnapshots } = fakes({ airports, traffic });
    const ranking = await service.rankNewEnglandTerminalExpansion();
    expect(ranking.ranked.map((r) => r.airport.code).sort()).toEqual(['BDL', 'BOS', 'PVD']);
    expect(ranking.ranked[0]?.rank).toBe(1);
    expect(ranking.candidateCount).toBe(3);
    expect(ranking.excludedCount).toBe(1);
    expect(ranking.observation).toEqual({ current: period('2025-05', '2026-04'), previous: period('2024-05', '2025-04') });
    expect(airportsInStates).toHaveBeenCalledTimes(1);
    expect(availablePeriod).toHaveBeenCalledTimes(1);
    expect(monthlyTraffic).toHaveBeenCalledTimes(2);
    expect(monthlyTraffic).toHaveBeenLastCalledWith({ airports: ['BDL', 'BOS', 'PVD'], period: period('2024-05', '2026-04') });
    expect(dailyRoutes).not.toHaveBeenCalled();
    expect(delaySnapshots).not.toHaveBeenCalled();
  });

  it('works without AeroDataBox configured and returns the scope notice', async () => {
    const { service } = fakes({ airports, traffic, withAeroDataBox: false });
    expect((await service.rankNewEnglandTerminalExpansion()).scopeNotice).toMatch(/^Scores are relative to the airports included in this ranking/);
  });

  it('returns an empty ranking, not an error, when no airport is eligible', async () => {
    const { service, monthlyTraffic } = fakes({ airports: [airport('0B5')], traffic: [] });
    const ranking = await service.rankNewEnglandTerminalExpansion();
    expect(ranking.ranked).toEqual([]);
    expect(ranking.candidateCount).toBe(0);
    expect(monthlyTraffic).toHaveBeenCalledTimes(1);
  });
});

describe('unmetDemandPressure', () => {
  it('scores from BTS alone and does not call AeroDataBox unless a delay window is given', async () => {
    const { service, delaySnapshots, dailyRoutes } = fakes({ traffic: sfoTraffic() });
    const result = await service.unmetDemandPressure(code('SFO'));
    expect(result.score).toBeGreaterThan(0);
    expect(result.operationalContext).toEqual({ status: 'not-requested' });
    expect(delaySnapshots).not.toHaveBeenCalled();
    expect(dailyRoutes).not.toHaveBeenCalled();
  });

  it('fetches delay context once when asked, without changing the score', async () => {
    const plain = await fakes({ traffic: sfoTraffic() }).service.unmetDemandPressure(code('SFO'));
    const { service, delaySnapshots } = fakes({ traffic: sfoTraffic() });
    const withDelay = await service.unmetDemandPressure(code('SFO'), WINDOW);
    expect(delaySnapshots).toHaveBeenCalledTimes(1);
    expect(withDelay.operationalContext.status).toBe('available');
    expect(withDelay.score).toBe(plain.score);
  });
});

describe('resolveAirports', () => {
  const lax = airport('LAX', { name: 'LOS ANGELES INTL', city: 'LOS ANGELES', state: 'CA', part139: { classification: 'I C', service: 'scheduled' } });
  const sna = airport('SNA', { name: 'JOHN WAYNE AIRPORT-ORANGE COUNTY', city: 'SANTA ANA', state: 'CA', part139: { classification: 'I C', service: 'scheduled' } });

  function withSearch(found: Airport[], unscheduledOnly = false) {
    const f = fakes({ airports: [lax, sna] });
    const searchAirports = vi.fn(async ({ scheduledServiceOnly }: { scheduledServiceOnly: boolean }) => ({
      data: unscheduledOnly && scheduledServiceOnly ? [] : found,
      provenance: { ...btsProvenance, source: 'faa-arcgis' as const },
    }));
    (f.service as unknown as { ports: { airports: Record<string, unknown> } }).ports.airports.searchAirports = searchAirports;
    return { ...f, searchAirports };
  }

  it('resolves an exact code without a text search, in any case', async () => {
    const { service, searchAirports } = withSearch([]);
    const result = await service.resolveAirports(' lax ');
    expect(result).toMatchObject({ matchType: 'exact-code', ambiguous: false, candidates: [{ code: 'LAX' }] });
    expect(searchAirports).not.toHaveBeenCalled();
  });

  it('resolves "LA" and "Los Angeles" to LAX deterministically, without a text search', async () => {
    const { service, searchAirports } = withSearch([]);
    for (const reference of ['LA', ' la ', 'Los Angeles', 'los  angeles']) {
      expect(await service.resolveAirports(reference)).toMatchObject({ matchType: 'alias', ambiguous: false, candidates: [{ code: 'LAX' }] });
    }
    expect(searchAirports).not.toHaveBeenCalled();
  });

  it('resolves a city name to a single unambiguous candidate', async () => {
    const { service } = withSearch([sna]);
    expect(await service.resolveAirports('Santa Ana')).toMatchObject({ matchType: 'text', ambiguous: false, scheduledServiceOnly: true, candidates: [{ code: 'SNA' }] });
  });

  it('returns several candidates as ambiguous instead of choosing, best match first', async () => {
    const other = airport('LAS', { name: 'HARRY REID INTL', city: 'LAS VEGAS', state: 'NV' });
    const { service } = withSearch([other, lax, sna]);
    const result = await service.resolveAirports('Springfield');
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.map((c) => c.code)).toEqual(['LAX', 'SNA', 'LAS']); // scheduled service first
  });

  it('falls back to airports without scheduled service, and reports no match as none', async () => {
    const small = airport('XYZ', { city: 'TINYTOWN' });
    const fallback = await withSearch([small], true).service.resolveAirports('Tinytown');
    expect(fallback).toMatchObject({ scheduledServiceOnly: false, candidates: [{ code: 'XYZ' }] });
    expect(await withSearch([]).service.resolveAirports('Nowhere')).toMatchObject({ matchType: 'none', ambiguous: false, candidates: [] });
  });

  it('caps the candidate list and says it was truncated', async () => {
    const many = Array.from({ length: 12 }, (_, i) => airport(`A${String(i).padStart(2, '0')}`, { city: 'SPRINGFIELD' }));
    const result = await withSearch(many).service.resolveAirports('Springfield');
    expect(result.candidates).toHaveLength(8);
    expect(result.truncated).toBe(true);
  });
});

describe('airportProfile', () => {
  it('combines the FAA identity with the BTS trend and never touches AeroDataBox', async () => {
    const { service, dailyRoutes, delaySnapshots } = fakes({ airports: [airport('SFO', { state: 'CA' })], traffic: sfoTraffic() });
    const profile = await service.airportProfile(code('SFO'));
    expect(profile.airport.code).toBe('SFO');
    expect(profile.traffic.current.totals?.passengers).toBe(13_200);
    expect(dailyRoutes).not.toHaveBeenCalled();
    expect(delaySnapshots).not.toHaveBeenCalled();
  });

  it('fails when the FAA does not know the airport', async () => {
    await expect(fakes({ traffic: sfoTraffic() }).service.airportProfile(code('SFO'))).rejects.toBeInstanceOf(AirportNotFoundError);
  });
});

describe('compareCongestion', () => {
  const lax = airport('LAX', { state: 'CA' });
  const sna = airport('SNA', { state: 'CA' });
  const nyc = airport('JFK', { state: 'NY' });
  const now = () => new Date('2026-10-07T20:00:00Z');

  it('uses the most recent 12 hours in each airport\'s own local time and makes one AeroDataBox request per airport', async () => {
    const f = fakes({ airports: [lax, nyc] });
    const service = new AirportAnalyticsService((f.service as unknown as { ports: AirportAnalyticsPorts }).ports, now);
    const result = await service.compareCongestion(code('LAX'), code('JFK'));
    expect(result.sides.map((s) => s.requestedWindow)).toEqual([
      { from: '2026-10-07T01:00', to: '2026-10-07T13:00' },
      { from: '2026-10-07T04:00', to: '2026-10-07T16:00' },
    ]);
    expect(f.delaySnapshots).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit window as given for both airports', async () => {
    const f = fakes({ airports: [lax, sna] });
    await f.service.compareCongestion(code('LAX'), code('SNA'), WINDOW);
    expect(f.delaySnapshots).toHaveBeenCalledWith({ airport: 'LAX', ...WINDOW });
    expect(f.delaySnapshots).toHaveBeenCalledWith({ airport: 'SNA', ...WINDOW });
  });

  it('fails before any request when AeroDataBox is missing, an airport is unknown, or both are the same', async () => {
    const missing = fakes({ airports: [lax, sna], withAeroDataBox: false });
    await expect(missing.service.compareCongestion(code('LAX'), code('SNA'))).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(missing.airportsByCode).not.toHaveBeenCalled();
    const f = fakes({ airports: [lax] });
    await expect(f.service.compareCongestion(code('LAX'), code('SNA'))).rejects.toBeInstanceOf(AirportNotFoundError);
    await expect(f.service.compareCongestion(code('LAX'), code('LAX'))).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(f.delaySnapshots).not.toHaveBeenCalled();
  });
});
