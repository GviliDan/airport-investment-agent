import { describe, expect, it } from 'vitest';
import { expectProviderError, FIXED_NOW, jsonResponse, mockFetch, code } from '../__tests__/support';
import { AeroDataBoxDelayProvider } from './aeroDataBoxDelayProvider';
import { AeroDataBoxRouteNetworkProvider } from './aeroDataBoxRouteNetworkProvider';
import { createAeroDataBoxGet } from './client';

const API_KEY = 'test-key-do-not-leak';
const HOST = 'aerodatabox.p.rapidapi.com';

const setup = (...responses: Parameters<typeof mockFetch>) => {
  const mock = mockFetch(...responses);
  const get = createAeroDataBoxGet({ apiKey: API_KEY, fetch: mock.fetch });
  return {
    ...mock,
    routes: new AeroDataBoxRouteNetworkProvider(get, FIXED_NOW),
    delays: new AeroDataBoxDelayProvider(get, FIXED_NOW),
  };
};

const route = (patch: Record<string, unknown> = {}) => ({
  destination: {
    icao: 'KSEA',
    iata: 'SEA',
    name: 'Seattle Tacoma',
    shortName: 'Tacoma',
    municipalityName: 'Seattle',
    location: { lat: 47.449, lon: -122.309 },
    countryCode: 'US',
    timeZone: 'America/Los_Angeles',
  },
  averageDailyFlights: 23.14,
  operators: [{ name: 'Alaska Airlines', iata: 'AS', icao: 'ASA' }, { name: 'TNV' }],
  ...patch,
});

describe('createAeroDataBoxGet', () => {
  it('sends the key and host as headers only, never in the URL', async () => {
    const { routes, fetch, urls } = setup(jsonResponse({ routes: [] }));
    await routes.dailyRoutes(code('ANC'));
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': HOST });
    expect(urls()[0]?.toString()).not.toContain(API_KEY);
  });

  it('never includes the key in an error message', async () => {
    const { routes } = setup(new Response('Forbidden', { status: 403 }));
    const error = await expectProviderError(routes.dailyRoutes(code('ANC')), { kind: 'http-status', status: 403 });
    expect(error.message).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });
});

describe('AeroDataBoxRouteNetworkProvider', () => {
  it('maps routes, scheduled frequency, operators and coordinates', async () => {
    const { routes, urls } = setup(jsonResponse({ routes: [route()] }));
    const result = await routes.dailyRoutes(code('ANC'));
    expect(urls()[0]?.pathname).toBe('/airports/iata/ANC/stats/routes/daily');
    expect(result.data).toEqual([
      {
        destination: {
          iataCode: 'SEA',
          icaoCode: 'KSEA',
          name: 'Seattle Tacoma',
          countryCode: 'US',
          location: { latitude: 47.449, longitude: -122.309 },
        },
        averageDailyFlights: 23.14,
        operators: ['Alaska Airlines', 'TNV'],
      },
    ]);
    expect(result.provenance).toEqual({ source: 'aerodatabox', dataset: expect.stringContaining('routes'), retrievedAt: '2026-10-07T12:00:00.000Z' });
  });

  it('keeps missing destination coordinates missing', async () => {
    const noLocation = route({ destination: { icao: 'PAXX', name: 'Remote strip', countryCode: 'US' } });
    const { routes } = setup(jsonResponse({ routes: [noLocation] }));
    const [mapped] = (await routes.dailyRoutes(code('ANC'))).data;
    expect(mapped?.destination.location).toBeUndefined();
    expect(mapped?.destination.iataCode).toBeUndefined();
  });

  it('returns an empty route list as empty, not as a failure', async () => {
    const { routes } = setup(jsonResponse({ routes: [] }));
    expect((await routes.dailyRoutes(code('ANC'))).data).toEqual([]);
  });

  it('fails on a non-200 response', async () => {
    const { routes } = setup(new Response('{"message":"Not found"}', { status: 404 }));
    await expectProviderError(routes.dailyRoutes(code('1G4')), { kind: 'http-status', status: 404 });
  });

  it('reports a quota rejection as rate-limited', async () => {
    const { routes } = setup(new Response('Too many requests', { status: 429 }));
    await expectProviderError(routes.dailyRoutes(code('ANC')), { kind: 'rate-limited', status: 429 });
  });

  it.each([
    ['a frequency that is not a number', route({ averageDailyFlights: '23' })],
    ['a missing frequency', route({ averageDailyFlights: undefined })],
    ['a negative frequency', route({ averageDailyFlights: -1 })],
    ['a destination without a name', route({ destination: { iata: 'SEA' } })],
    ['a destination code that is not an airport code', route({ destination: { iata: 'seattle', name: 'x' } })],
  ])('fails on %s', async (_label, bad) => {
    const { routes } = setup(jsonResponse({ routes: [bad] }));
    await expectProviderError(routes.dailyRoutes(code('ANC')), { kind: 'invalid-response' });
  });

  it('fails when the response has no routes field', async () => {
    const { routes } = setup(jsonResponse({ message: 'weird' }));
    await expectProviderError(routes.dailyRoutes(code('ANC')), { kind: 'invalid-response' });
  });
});

const snapshot = (patch: Record<string, unknown> = {}) => ({
  airportIcao: 'KLAX',
  from: { utc: '2026-10-06 13:00Z', local: '2026-10-06 06:00-07:00' },
  to: { utc: '2026-10-06 15:00Z', local: '2026-10-06 08:00-07:00' },
  departuresDelayInformation: { numTotal: 52, numQualifiedTotal: 52, numCancelled: 1, medianDelay: '00:07:00', delayIndex: 0.42 },
  arrivalsDelayInformation: { numTotal: 39, numQualifiedTotal: 36, numCancelled: 0, medianDelay: '-00:12:00', delayIndex: 0.0 },
  ...patch,
});
const window = { airport: code('LAX'), from: '2026-10-06T08:00', to: '2026-10-06T20:00' };

describe('AeroDataBoxDelayProvider', () => {
  it('requests the airport and local window, and maps statistics to minutes and ISO times', async () => {
    const { delays, urls } = setup(jsonResponse([snapshot()]));
    const result = await delays.delaySnapshots(window);
    expect(urls()[0]?.pathname).toBe('/airports/iata/LAX/delays/2026-10-06T08:00/2026-10-06T20:00');
    expect(result.data).toEqual([
      {
        windowStart: '2026-10-06T13:00:00Z',
        windowEnd: '2026-10-06T15:00:00Z',
        departures: { flights: 52, qualifiedFlights: 52, cancelled: 1, medianDelayMinutes: 7, delayIndex: 0.42 },
        arrivals: { flights: 39, qualifiedFlights: 36, cancelled: 0, medianDelayMinutes: -12, delayIndex: 0 },
      },
    ]);
    expect(result.provenance.source).toBe('aerodatabox');
  });

  it('keeps a median delay and delay index the API did not supply missing', async () => {
    const sparse = snapshot({ arrivalsDelayInformation: { numTotal: 2, numQualifiedTotal: 2, numCancelled: 0 } });
    const { delays } = setup(jsonResponse([sparse]));
    const [mapped] = (await delays.delaySnapshots(window)).data;
    expect(mapped?.arrivals).toEqual({ flights: 2, qualifiedFlights: 2, cancelled: 0 });
    expect(mapped?.arrivals.medianDelayMinutes).toBeUndefined();
    expect(mapped?.arrivals.delayIndex).toBeUndefined();
  });

  it('rejects a window longer than 12 hours, or malformed, without calling the API', async () => {
    const { delays, fetch } = setup();
    await expectProviderError(delays.delaySnapshots({ ...window, to: '2026-10-06T20:01' }), { kind: 'invalid-request' });
    await expectProviderError(delays.delaySnapshots({ ...window, to: '2026-10-06T08:00' }), { kind: 'invalid-request' });
    await expectProviderError(delays.delaySnapshots({ ...window, from: '2026-10-06 08:00' }), { kind: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts exactly 12 hours', async () => {
    const { delays } = setup(jsonResponse([]));
    expect((await delays.delaySnapshots(window)).data).toEqual([]);
  });

  it('fails on a non-200 response', async () => {
    const { delays } = setup(new Response('{"message":"bad"}', { status: 400 }));
    await expectProviderError(delays.delaySnapshots(window), { kind: 'http-status', status: 400 });
  });

  it.each([
    ['a malformed duration', snapshot({ departuresDelayInformation: { numTotal: 1, numQualifiedTotal: 1, numCancelled: 0, medianDelay: '7 minutes' } })],
    ['a negative count', snapshot({ arrivalsDelayInformation: { numTotal: -1, numQualifiedTotal: 0, numCancelled: 0 } })],
    ['a missing window time', snapshot({ to: {} })],
    ['a delay index outside 0-5', snapshot({ departuresDelayInformation: { numTotal: 1, numQualifiedTotal: 1, numCancelled: 0, delayIndex: 9 } })],
  ])('fails on %s', async (_label, bad) => {
    const { delays } = setup(jsonResponse([bad]));
    await expectProviderError(delays.delaySnapshots(window), { kind: 'invalid-response' });
  });

  it('fails when the response is not a list', async () => {
    const { delays } = setup(jsonResponse({ message: 'oops' }));
    await expectProviderError(delays.delaySnapshots(window), { kind: 'invalid-response' });
  });
});
