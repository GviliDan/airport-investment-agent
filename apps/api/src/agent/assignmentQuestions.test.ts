import { describe, expect, it, vi } from 'vitest';
import { ChatResponseSchema, type Artifact, type ChatMessage } from '@airport/shared';
import { adbProvenance, airport, btsProvenance, LOCATIONS, monthlyRows, period, route, snapshot } from '../analytics/__tests__/support';
import { AirportAnalyticsService } from '../application/airportAnalyticsService';
import type { Airport } from '../domain/airport';
import type { LlmClient, LlmMessage, LlmRequest, LlmResponse } from './llmClient';
import { ToolCallingAgent } from './toolCallingAgent';
import { buildTools } from './tools/airportTools';
import { growthGapInterpretation } from './artifacts';

/**
 * End-to-end flows through the real agent loop, real tools, real analytics and scoring, with fake providers
 * and a scripted stand-in for the model. They check which deterministic tools run and what they return, not
 * the model's wording.
 */

const SCOPE = 'Scores are relative to the airports included in this ranking and should not be compared across separate ranking runs.';
const PRESSURE = 'This is an indicator of demand/capacity pressure, not an estimate of passengers who could not travel.';

const AIRPORTS: Airport[] = [
  airport('LAX', { name: 'LOS ANGELES INTL', city: 'LOS ANGELES', state: 'CA', location: LOCATIONS.LAX, part139: { classification: 'I C', service: 'scheduled' } }),
  airport('SNA', { name: 'JOHN WAYNE AIRPORT-ORANGE COUNTY', city: 'SANTA ANA', state: 'CA', location: { latitude: 33.68, longitude: -117.87 }, part139: { classification: 'I C', service: 'scheduled' } }),
  airport('ANC', { name: 'TED STEVENS ANCHORAGE INTL', city: 'ANCHORAGE', state: 'AK', location: LOCATIONS.ANC, part139: { classification: 'I E', service: 'scheduled' } }),
  airport('SFO', { name: 'SAN FRANCISCO INTL', city: 'SAN FRANCISCO', state: 'CA', location: LOCATIONS.SFO, part139: { classification: 'I E', service: 'scheduled' } }),
  airport('BOS', { name: 'GENERAL EDWARD LAWRENCE LOGAN INTL', city: 'BOSTON', state: 'MA' }),
  airport('HVN', { name: 'TWEED-NEW HAVEN', city: 'NEW HAVEN', state: 'CT' }),
  airport('BDL', { name: 'BRADLEY INTL', city: 'WINDSOR LOCKS', state: 'CT' }),
];
const NEW_ENGLAND = ['BOS', 'HVN', 'BDL'];
const CURRENT = period('2025-05', '2026-04');
const PREVIOUS = period('2024-05', '2025-04');

const traffic = [
  ...monthlyRows('SFO', PREVIOUS, () => ({ passengers: 1000, seats: 1250 })),
  ...monthlyRows('SFO', CURRENT, () => ({ passengers: 1050, seats: 1300 })),
  // HVN grows fast, BOS barely, BDL declines.
  ...monthlyRows('HVN', PREVIOUS, () => ({ passengers: 40_000, seats: 50_000, departures: 300 })),
  ...monthlyRows('HVN', CURRENT, () => ({ passengers: 50_000, seats: 55_000, departures: 360 })),
  ...monthlyRows('BOS', PREVIOUS, () => ({ passengers: 1_900_000, seats: 2_300_000, departures: 12_000 })),
  ...monthlyRows('BOS', CURRENT, () => ({ passengers: 1_890_000, seats: 2_300_000, departures: 12_000 })),
  ...monthlyRows('BDL', PREVIOUS, () => ({ passengers: 300_000, seats: 380_000, departures: 2_500 })),
  ...monthlyRows('BDL', CURRENT, () => ({ passengers: 290_000, seats: 380_000, departures: 2_450 })),
];

function setup() {
  const dir = {
    airportsByCode: vi.fn(async (codes: readonly string[]) => ({ data: AIRPORTS.filter((a) => codes.includes(a.code)), provenance: { ...btsProvenance, source: 'faa-arcgis' as const } })),
    airportsInStates: vi.fn(async () => ({ data: AIRPORTS.filter((a) => NEW_ENGLAND.includes(a.code)), provenance: { ...btsProvenance, source: 'faa-arcgis' as const } })),
    searchAirports: vi.fn(async ({ text }: { text: string }) => ({
      data: AIRPORTS.filter((a) => a.city.includes(text.toUpperCase()) || a.name.includes(text.toUpperCase())),
      provenance: { ...btsProvenance, source: 'faa-arcgis' as const },
    })),
  };
  const traf = {
    availablePeriod: vi.fn(async () => ({ data: period('2014-01', '2026-04'), provenance: btsProvenance })),
    monthlyTraffic: vi.fn(async ({ airports, period: p }: { airports: readonly string[]; period: { start: string; end: string } }) => ({
      data: traffic.filter((r) => airports.includes(r.airport) && r.month >= p.start && r.month <= p.end),
      provenance: btsProvenance,
    })),
  };
  const routes = { dailyRoutes: vi.fn(async () => ({ data: [route('SEA', 60, LOCATIONS.SEA), route('JFK', 30, LOCATIONS.JFK), route('LHR', 10, LOCATIONS.LHR)], provenance: adbProvenance })) };
  const delays = {
    delaySnapshots: vi.fn(async ({ airport: code }: { airport: string }) => ({
      data: [snapshot(0, 2, { flights: code === 'LAX' ? 300 : 100, qualifiedFlights: code === 'LAX' ? 300 : 100, medianDelayMinutes: 5, delayIndex: 0.2 })],
      provenance: adbProvenance,
    })),
  };
  const service = new AirportAnalyticsService({ airports: dir, traffic: traf, routes, delays } as never, () => new Date('2026-10-07T20:00:00Z'));
  return { service, dir, traf, routes, delays };
}

// Tool results are untrusted JSON in these tests; the assertions below check the parts that matter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolJson = Record<string, any>;
type Step = (request: LlmRequest) => LlmResponse;
function scriptedModel(...steps: Step[]) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async chat(request) {
      requests.push(request);
      const step = steps[requests.length - 1];
      if (!step) throw new Error('model script exhausted');
      return step(request);
    },
  };
  return { llm, requests };
}
const calls = (...c: { name: string; arguments: unknown }[]): LlmResponse => ({ content: '', toolCalls: c });
const say = (content: string): LlmResponse => ({ content, toolCalls: [] });
const toolResults = (request: LlmRequest) => request.messages.filter((m): m is Extract<LlmMessage, { role: 'tool' }> => m.role === 'tool').map((m) => ({ name: m.toolName, data: JSON.parse(m.content) as ToolJson }));
const lastResult = (request: LlmRequest, name: string) => toolResults(request).filter((r) => r.name === name).at(-1)?.data;

function agentFor(service: AirportAnalyticsService, llm: LlmClient) {
  return new ToolCallingAgent({ llm, tools: buildTools(service), maxSteps: 6, deadlineMs: 5000, now: () => new Date('2026-10-07T20:00:00Z') });
}
const ask = (content: string, history: ChatMessage[] = []): ChatMessage[] => [...history, { role: 'user', content }];
const artifactTypes = (artifacts: Artifact[]) => artifacts.map((a) => a.type);

describe('assignment question 1: New England terminal expansion candidates', () => {
  it('invokes the ranking tool, returns the deterministic ranking and keeps the scope notice, using no AeroDataBox', async () => {
    const { service, routes, delays } = setup();
    const { llm } = scriptedModel(
      () => calls({ name: 'rank_terminal_expansion', arguments: { region: 'new-england' } }),
      (request) => {
        const ranking = lastResult(request, 'rank_terminal_expansion');
        expect(ranking?.ranked.map((r: { airport: { code: string } }) => r.airport.code)).toContain('HVN');
        expect(ranking?.scopeNotice).toBe(SCOPE);
        return say('HVN leads.');
      },
    );
    const response = await agentFor(service, llm).respond(ask('Which airports in New England are strong candidates for terminal expansion?'));
    expect(response.meta.toolCalls).toEqual(['rank_terminal_expansion']);
    const ranking = response.artifacts.find((a) => a.type === 'ranking');
    expect(ranking).toMatchObject({ type: 'ranking', profile: 'terminal-expansion-v1', candidateCount: 3 });
    if (ranking?.type === 'ranking') {
      expect(ranking.ranked[0]?.airport.code).toBe('HVN');
      expect(ranking.ranked[0]?.rank).toBe(1);
      expect(ranking.scopeNotice).toBe(SCOPE);
    }
    expect(routes.dailyRoutes).not.toHaveBeenCalled();
    expect(delays.delaySnapshots).not.toHaveBeenCalled();
  });
});

describe('assignment question 2: LAX versus Santa Ana congestion', () => {
  it('resolves both references, then compares congestion for the resolved codes', async () => {
    const { service, delays } = setup();
    const { llm, requests } = scriptedModel(
      () => calls({ name: 'resolve_airports', arguments: { query: 'LAX' } }, { name: 'resolve_airports', arguments: { query: 'Santa Ana' } }),
      (request) => {
        const [lax, santaAna] = toolResults(request).map((r) => r.data);
        expect(lax?.ambiguous).toBe(false);
        expect(lax?.candidates[0].code).toBe('LAX');
        expect(santaAna?.candidates.map((c: { code: string }) => c.code)).toEqual(['SNA']);
        return calls({ name: 'compare_airport_congestion', arguments: { airportA: lax?.candidates[0].code, airportB: santaAna?.candidates[0].code } });
      },
      () => say('Comparison.'),
    );
    const response = await agentFor(service, llm).respond(ask('Compare LAX and Santa Ana airport congestion levels.'));
    expect(response.meta.toolCalls).toEqual(['resolve_airports', 'resolve_airports', 'compare_airport_congestion']);
    const comparison = response.artifacts.find((a) => a.type === 'congestion-comparison');
    expect(comparison?.type === 'congestion-comparison' && comparison.airports.map((a) => a.airport.code)).toEqual(['LAX', 'SNA']);
    if (comparison?.type === 'congestion-comparison') {
      expect(comparison.reading).toMatch(/not be interpreted as a direct measure of terminal capacity or long-term airport congestion/);
      expect(comparison.reading).toMatch(/observed data window/);
      // default window: the most recent 12 hours in each airport's local time (13:00 PDT on 2026-10-07)
      expect(comparison.airports[0].requestedWindowLocal).toEqual({ from: '2026-10-07T01:00', to: '2026-10-07T13:00' });
      expect(comparison.airports[0].departures?.flights).toBe(300);
    }
    expect(delays.delaySnapshots).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(3);
  });

  it('does not declare a winner and flags limited comparability when data is missing', async () => {
    const { service, delays } = setup();
    delays.delaySnapshots.mockImplementation(async ({ airport: code }: { airport: string }) => ({
      data: code === 'LAX' ? [snapshot(0, 2, { flights: 300, qualifiedFlights: 300, delayIndex: 0.2 })] : [],
      provenance: adbProvenance,
    }));
    const { llm } = scriptedModel(() => calls({ name: 'compare_airport_congestion', arguments: { airportA: 'lax', airportB: 'SNA' } }), () => say('x'));
    const response = await agentFor(service, llm).respond(ask('Compare LAX and SNA'));
    const comparison = response.artifacts.find((a) => a.type === 'congestion-comparison');
    if (comparison?.type !== 'congestion-comparison') throw new Error('missing artifact');
    expect(comparison.comparabilityNotes.join(' ')).toContain('SNA: no delay data');
    expect(comparison.airports[1].departures).toBeNull();
    expect(Object.keys(comparison)).not.toContain('winner');
  });
});

describe('assignment question 3: Anchorage long-haul share', () => {
  it('invokes the long-haul tool with the default threshold and exposes the scheduled-departures caveat', async () => {
    const { service, routes } = setup();
    const { llm } = scriptedModel(
      () => calls({ name: 'get_long_haul_share', arguments: { airport: 'ANC' } }),
      () => say('19.x'),
    );
    const response = await agentFor(service, llm).respond(ask('What percentage of long haul flights are out of Anchorage airport?'));
    expect(response.meta.toolCalls).toEqual(['get_long_haul_share']);
    expect(routes.dailyRoutes).toHaveBeenCalledTimes(1);
    const longHaul = response.artifacts.find((a) => a.type === 'long-haul');
    if (longHaul?.type !== 'long-haul') throw new Error('missing artifact');
    expect(longHaul).toMatchObject({ thresholdMiles: 3000, thresholdSource: 'default', totalAverageDailyFlights: 100, longHaulAverageDailyFlights: 40 });
    expect(longHaul.sharePercent).toBe(40);
    expect(longHaul.mandatoryNotice).toMatch(/not a passenger-only share/);
    expect(longHaul.mandatoryNotice).toMatch(/not a share of performed flights/);
    expect(longHaul.topLongHaulRoutes.map((r) => r.destination)).toEqual(['JFK', 'LHR']);
  });

  it('passes a user threshold through and labels it', async () => {
    const { service } = setup();
    const { llm } = scriptedModel(() => calls({ name: 'get_long_haul_share', arguments: { airport: 'ANC', thresholdMiles: 1500 } }), () => say('ok'));
    const response = await agentFor(service, llm).respond(ask('Long haul over 1500 miles from ANC?'));
    expect(response.artifacts.find((a) => a.type === 'long-haul')).toMatchObject({ thresholdMiles: 1500, thresholdSource: 'user' });
  });
});

describe('assignment question 4: SFO unmet demand', () => {
  it('invokes the demand-pressure tool, keeps the mandatory notice and never calls AeroDataBox by default', async () => {
    const { service, delays, routes } = setup();
    const { llm } = scriptedModel(
      () => calls({ name: 'estimate_unmet_demand_pressure', arguments: { airport: 'SFO' } }),
      (request) => {
        expect(lastResult(request, 'estimate_unmet_demand_pressure')?.notice).toBe(PRESSURE);
        return say('Elevated pressure.');
      },
    );
    const response = await agentFor(service, llm).respond(ask('What is the unmet flight demand in SFO and why?'));
    const pressure = response.artifacts.find((a) => a.type === 'demand-pressure');
    if (pressure?.type !== 'demand-pressure') throw new Error('missing artifact');
    expect(pressure.notice).toBe(PRESSURE);
    expect(pressure.scorePoints).not.toBeNull();
    expect(pressure.components).toHaveLength(4);
    expect(pressure.operationalContext).toEqual({ status: 'not-requested' });
    expect(JSON.stringify(response)).not.toMatch(/unmetPassengers|lostPassengers|suppressed/i);
    expect(delays.delaySnapshots).not.toHaveBeenCalled();
    expect(routes.dailyRoutes).not.toHaveBeenCalled();
  });

  it('adds delay context only when asked, without changing the score', async () => {
    const { service, delays } = setup();
    const run = async (includeOperationalContext: boolean) => {
      const { llm } = scriptedModel(() => calls({ name: 'estimate_unmet_demand_pressure', arguments: { airport: 'SFO', includeOperationalContext } }), () => say('ok'));
      const response = await agentFor(service, llm).respond(ask('SFO pressure'));
      const artifact = response.artifacts.find((a) => a.type === 'demand-pressure');
      if (artifact?.type !== 'demand-pressure') throw new Error('missing artifact');
      return artifact;
    };
    const plain = await run(false);
    const withContext = await run(true);
    expect(delays.delaySnapshots).toHaveBeenCalledTimes(1);
    expect(withContext.operationalContext.status).toBe('available');
    expect(withContext.scorePoints).toBe(plain.scorePoints);
  });
});

describe('assignment question 5: follow-up using conversation context', () => {
  it('re-calls the ranking tool and gets deterministic factors for both airports being compared', async () => {
    const { service, traf } = setup();
    const history: ChatMessage[] = [
      { role: 'user', content: 'Which New England airports are strong candidates for terminal expansion?' },
      { role: 'assistant', content: 'HVN ranks first, followed by BDL and BOS.' },
    ];
    const { llm, requests } = scriptedModel(
      (request) => {
        // The client's history is visible to the model, so it can resolve "the first airport".
        expect(request.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        return calls({ name: 'rank_terminal_expansion', arguments: {} });
      },
      (request) => {
        const ranking = lastResult(request, 'rank_terminal_expansion');
        const byCode = Object.fromEntries(ranking?.ranked.map((r: { airport: { code: string } }) => [r.airport.code, r]));
        expect(byCode.HVN.rank).toBeLessThan(byCode.BOS.rank);
        expect(byCode.HVN.scorePoints).toBeGreaterThan(byCode.BOS.scorePoints);
        expect(byCode.HVN.factors.find((f: { id: string }) => f.id === 'passengerGrowth').value).toBe(25);
        return say('Because of growth.');
      },
    );
    const response = await agentFor(service, llm).respond(ask('Why is the first airport ranked above BOS?', history));
    expect(response.meta.toolCalls).toEqual(['rank_terminal_expansion']);
    expect(artifactTypes(response.artifacts)).toContain('ranking');
    expect(requests).toHaveLength(2);
    expect(traf.monthlyTraffic).toHaveBeenCalled();
  });
});

describe('wire contract', () => {
  it('every artifact built from real tool results satisfies the shared ChatResponse schema', async () => {
    const { service } = setup();
    const { llm } = scriptedModel(
      () =>
        calls(
          { name: 'rank_terminal_expansion', arguments: {} },
          { name: 'get_long_haul_share', arguments: { airport: 'ANC' } },
          { name: 'estimate_unmet_demand_pressure', arguments: { airport: 'SFO', includeOperationalContext: true } },
          { name: 'compare_airport_congestion', arguments: { airportA: 'LAX', airportB: 'SNA' } },
        ),
      () => calls({ name: 'get_airport_profile', arguments: { airport: 'SFO' } }),
      () => say('All of it.'),
    );
    const response = await agentFor(service, llm).respond(ask('everything'));
    expect(ChatResponseSchema.safeParse(response).success).toBe(true);
    expect(new Set(artifactTypes(response.artifacts))).toEqual(new Set(['ranking', 'long-haul', 'demand-pressure', 'congestion-comparison', 'airport-profile']));
  });

  it('presents values in display units, so the model never converts', async () => {
    const { service } = setup();
    const { llm } = scriptedModel(() => calls({ name: 'get_airport_profile', arguments: { airport: 'SFO' } }), () => say('ok'));
    const response = await agentFor(service, llm).respond(ask('SFO profile'));
    const profile = response.artifacts.find((a) => a.type === 'airport-profile');
    if (profile?.type !== 'airport-profile') throw new Error('missing artifact');
    expect(profile).toMatchObject({ passengers: 12_600, seats: 15_600, passengerGrowthPercent: 5, seatGrowthPercent: 4, loadFactorPercent: 80.8 });
    expect(profile.airport.code).toBe('SFO');
    expect(profile.missing).toEqual([]);
  });
});


describe('deterministic readouts the model quotes instead of inferring', () => {
  const run = async (service: AirportAnalyticsService, name: string, args: unknown) => {
    const { llm } = scriptedModel(() => calls({ name, arguments: args }), () => say('ok'));
    return (await agentFor(service, llm).respond(ask('q'))).artifacts;
  };
  const rankingOf = async (compare?: string[]) => {
    const ranking = (await run(setup().service, 'rank_terminal_expansion', compare ? { compare } : {})).find((a) => a.type === 'ranking');
    if (ranking?.type !== 'ranking') throw new Error('missing artifact');
    return ranking;
  };
  const congestionOf = async (medians: (code: string) => number | undefined, drop?: string) => {
    const { service, delays } = setup();
    delays.delaySnapshots.mockImplementation(async ({ airport: code }: { airport: string }) => ({
      data: code === drop ? [] : [snapshot(0, 2, { flights: 100, qualifiedFlights: 100, ...(medians(code) === undefined ? {} : { medianDelayMinutes: medians(code) as number }), delayIndex: 0.2 })],
      provenance: adbProvenance,
    }));
    const comparison = (await run(service, 'compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA' })).find((a) => a.type === 'congestion-comparison');
    if (comparison?.type !== 'congestion-comparison') throw new Error('missing artifact');
    return comparison;
  };

  it('demand pressure: gap sign, load factor and proxy semantics, plus the exact notice', async () => {
    expect(growthGapInterpretation(-0.02)).toBe('Seat capacity grew slightly faster than passenger activity.');
    expect(growthGapInterpretation(1.2)).toBe('Passenger activity grew faster than seat capacity.');
    expect(growthGapInterpretation(0)).toBe('Passenger activity and seat capacity grew at approximately the same rate.');
    // BOS: passengers fall while seats are flat, so the gap is negative.
    const pressure = (await run(setup().service, 'estimate_unmet_demand_pressure', { airport: 'BOS' })).find((a) => a.type === 'demand-pressure');
    if (pressure?.type !== 'demand-pressure') throw new Error('missing artifact');
    expect(pressure.interpretation.passengerSeatGrowthGap).toBe('Seat capacity grew slightly faster than passenger activity.');
    expect(pressure.interpretation.loadFactor).toContain('not a measure of terminal capacity');
    expect(pressure.interpretation.pressure).toContain('does not establish that actual unmet demand exists');
    expect(pressure.notice).toBe(PRESSURE);
  });

  it('long haul: the notice states the scheduled, rolling 7-day, not passenger-only, not performed-flights basis', async () => {
    const longHaul = (await run(setup().service, 'get_long_haul_share', { airport: 'ANC' })).find((a) => a.type === 'long-haul');
    if (longHaul?.type !== 'long-haul') throw new Error('missing artifact');
    for (const phrase of ['scheduled route frequency', 'rolling 7-day average', 'not a passenger-only share', 'not a share of performed flights']) {
      expect(longHaul.mandatoryNotice).toContain(phrase);
    }
  });

  it('ranking: percentile labels, factor leaders, and a per-factor comparison with no arithmetic', async () => {
    const ranking = await rankingOf(['HVN', 'BOS']);
    const factor = ranking.ranked[0]?.factors.find((f) => f.status === 'available');
    expect(factor).toHaveProperty('percentileRank');
    expect(ranking.percentileReading).toContain('not a percentage or rate');
    expect(ranking.factorLeaders.find((f) => f.factorId === 'passengerScale')?.leaderAirports).toEqual(['BOS']);
    if (ranking.comparison.status !== 'available') throw new Error('comparison unavailable');
    const c = ranking.comparison;
    expect([c.higherRanked.code, c.lowerRanked.code]).toEqual(['HVN', 'BOS']);
    expect(c.factors.find((f) => f.factorId === 'passengerScale')).toMatchObject({ favors: 'lower-ranked', favoredAirport: 'BOS' });
    expect(c.factors.find((f) => f.factorId === 'passengerGrowth')).toMatchObject({ favors: 'higher-ranked', favoredAirport: 'HVN' });
    expect(c.reading).toContain('HVN ranks above BOS');
    expect(c.reading).toContain('states no score differences');
    expect(c.weightPercentFavoringHigherRanked + c.weightPercentFavoringLowerRanked).toBeLessThanOrEqual(100);
    expect(((await rankingOf(['BOS', 'HVN'])).comparison as typeof c).reading).toBe(c.reading); // order of the pair does not matter
  });

  it('ranking: no comparison unless requested, and none for an airport that is not ranked', async () => {
    expect((await rankingOf()).comparison).toEqual({ status: 'not-requested' });
    expect((await rankingOf(['HVN', 'SFO'])).comparison).toMatchObject({ status: 'unavailable' });
  });

  it('congestion: requested and observed windows stay separate and partial coverage is quotable', async () => {
    const { service, delays } = setup();
    delays.delaySnapshots.mockImplementation(async ({ airport: code }: { airport: string }) => ({
      data: [snapshot(0, 2, { flights: 100, qualifiedFlights: 100, ...(code === 'SNA' ? {} : { medianDelayMinutes: 5 }), delayIndex: 0.2 })],
      provenance: adbProvenance,
    }));
    const comparison = (await run(service, 'compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA' })).find((a) => a.type === 'congestion-comparison');
    if (comparison?.type !== 'congestion-comparison') throw new Error('missing artifact');
    expect(comparison.coverageSummary).toMatch(/requested window was 12 hours/);
    expect(comparison.coverageSummary).toContain('Observed data windows:');
    expect(comparison.coverageSummary).toMatch(/Partial or missing coverage: .*SNA .*median delay/);
    expect(comparison.airports[1].coverageReading.join(' ')).toContain('median delay');
    expect(comparison.reading).toContain('must not be merged into one duration');
  });

  it('congestion: a direction is declared only with complete data; otherwise mixed or insufficient and no winner', async () => {
    const a = await congestionOf((code) => (code === 'LAX' ? 12 : 5));
    expect(a).toMatchObject({ comparisonOutcome: 'airport-a-higher-delay-pressure', winnerSupported: true });
    expect(a.outcomeReading).toContain('LAX shows higher delays than SNA');
    expect(await congestionOf((code) => (code === 'LAX' ? 5 : 12))).toMatchObject({ comparisonOutcome: 'airport-b-higher-delay-pressure', winnerSupported: true });
    const mixed = await congestionOf(() => 5); // within the one-minute similarity threshold
    expect(mixed).toMatchObject({ comparisonOutcome: 'mixed', winnerSupported: false });
    expect(mixed.outcomeReading).toContain('Do not name a winner');
    expect(await congestionOf((code) => (code === 'LAX' ? 12 : undefined))).toMatchObject({ comparisonOutcome: 'insufficient', winnerSupported: false });
    expect(await congestionOf(() => 5, 'SNA')).toMatchObject({ comparisonOutcome: 'insufficient', winnerSupported: false });
  });
});
