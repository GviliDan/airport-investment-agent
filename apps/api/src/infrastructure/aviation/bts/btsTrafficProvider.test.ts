import { describe, expect, it } from 'vitest';
import { code, expectProviderError, FIXED_NOW, jsonResponse, mockFetch, period } from '../__tests__/support';
import { BTS_TRAFFIC_URL, BtsTrafficProvider, buildAvailablePeriodUrl, buildTrafficUrl } from './btsTrafficProvider';

const row = (patch: Record<string, string | undefined> = {}) => ({
  origin_airport_code: 'SFO',
  reporting_month: '2026-03-01T00:00:00.000',
  total_departures: '17325',
  total_passengers: '2510801',
  total_seats: '2959302',
  total_load_factor: '84.8',
  total_freight_lbs: '56050403',
  total_mail_lbs: '1200000',
  domestic_departures: '15000',
  outbound_international: '2325',
  ...patch,
});

const provider = (...responses: Parameters<typeof mockFetch>) => {
  const mock = mockFetch(...responses);
  return { ...mock, provider: new BtsTrafficProvider({ fetch: mock.fetch, now: FIXED_NOW }) };
};
const query = { airports: [code('SFO')], period: period('2026-03', '2026-04') };

describe('buildTrafficUrl', () => {
  const url = buildTrafficUrl(BTS_TRAFFIC_URL, { airports: [code('SFO'), code('ANC'), code('SFO')], period: period('2025-05', '2026-04') });

  it('requests only the airports and months needed, using server-side filtering', () => {
    expect(url.origin + url.pathname).toBe('https://data.bts.gov/resource/r495-tyji.json');
    expect(url.searchParams.get('$where')).toBe(
      "origin_airport_code in('ANC','SFO') AND reporting_month >= '2025-05-01T00:00:00' AND reporting_month <= '2026-04-01T00:00:00'",
    );
    expect(url.searchParams.get('$order')).toBe('origin_airport_code,reporting_month');
  });

  it('limits the result to exactly airports x months', () => {
    expect(url.searchParams.get('$limit')).toBe(String(2 * 12));
  });

  it('selects only the consumed fields', () => {
    const fields = url.searchParams.get('$select')?.split(',');
    expect(fields).toEqual(
      expect.arrayContaining(['origin_airport_code', 'reporting_month', 'total_departures', 'total_passengers', 'total_seats', 'total_load_factor', 'total_freight_lbs', 'total_mail_lbs', 'domestic_departures', 'outbound_international']),
    );
    expect(fields).not.toContain('origin_city_name');
  });

  it('refuses a request larger than one Socrata page without sending anything', () => {
    const airports = Array.from({ length: 400 }, (_, i) => code(String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)) + 'X'));
    expect(() => buildTrafficUrl(BTS_TRAFFIC_URL, { airports, period: period('2014-01', '2026-04') })).toThrow(/limit is 50000/);
  });
});

describe('buildAvailablePeriodUrl', () => {
  it('asks for the min and max reporting month only', () => {
    const select = buildAvailablePeriodUrl(BTS_TRAFFIC_URL).searchParams.get('$select');
    expect(select).toBe('min(reporting_month) as min_reporting_month,max(reporting_month) as max_reporting_month');
  });
});

describe('BtsTrafficProvider.monthlyTraffic', () => {
  it('maps Socrata rows into normalized domain records with provenance', async () => {
    const { provider: p, urls } = provider(jsonResponse([row()]));
    const result = await p.monthlyTraffic(query);
    expect(result.data).toEqual([
      {
        airport: 'SFO',
        month: '2026-03',
        departures: 17325,
        passengers: 2510801,
        seats: 2959302,
        loadFactorPercent: 84.8,
        freightLbs: 56050403,
        mailLbs: 1200000,
        domesticDepartures: 15000,
        outboundInternationalDepartures: 2325,
      },
    ]);
    expect(result.provenance).toEqual({
      source: 'bts-socrata',
      dataset: expect.stringContaining('r495-tyji'),
      retrievedAt: '2026-10-07T12:00:00.000Z',
      period: { start: '2026-03', end: '2026-04' },
    });
    expect(urls()[0]?.hostname).toBe('data.bts.gov');
  });

  it('keeps a metric BTS did not report missing instead of turning it into zero', async () => {
    const sparse = row({ total_load_factor: undefined, domestic_departures: undefined, outbound_international: undefined });
    const { provider: p } = provider(jsonResponse([sparse]));
    const [record] = (await p.monthlyTraffic(query)).data;
    expect(record?.loadFactorPercent).toBeUndefined();
    expect(record?.domesticDepartures).toBeUndefined();
    expect(record?.outboundInternationalDepartures).toBeUndefined();
    expect(record).not.toHaveProperty('outboundInternationalDepartures', 0);
  });

  it('returns no records, not zeros, when BTS has nothing for the request', async () => {
    const { provider: p } = provider(jsonResponse([]));
    expect((await p.monthlyTraffic(query)).data).toEqual([]);
  });

  it('does not call the API when no airports are requested', async () => {
    const { provider: p, fetch } = provider();
    expect((await p.monthlyTraffic({ airports: [], period: query.period })).data).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails on a non-200 response', async () => {
    const { provider: p } = provider(new Response('Server Error', { status: 500 }));
    await expectProviderError(p.monthlyTraffic(query), { kind: 'http-status', status: 500 });
  });

  it('fails on an error object instead of rows', async () => {
    const { provider: p } = provider(jsonResponse({ error: true, message: 'query.soql.no-such-column' }));
    await expectProviderError(p.monthlyTraffic(query), { kind: 'invalid-response' });
  });

  it.each([
    ['a non-numeric count', { total_passengers: 'abc' }],
    ['a missing required total', { total_seats: undefined }],
    ['a negative count', { total_departures: '-4' }],
    ['a month that is not a month start', { reporting_month: '2026-03-15T00:00:00.000' }],
    ['a malformed airport code', { origin_airport_code: 'sfo' }],
  ])('fails on %s rather than guessing a value', async (_label, patch) => {
    const { provider: p } = provider(jsonResponse([row(patch)]));
    await expectProviderError(p.monthlyTraffic(query), { kind: 'invalid-response' });
  });

  it('fails when the server returns an airport or month that was not requested', async () => {
    await expectProviderError(provider(jsonResponse([row({ origin_airport_code: 'LAX' })])).provider.monthlyTraffic(query), { kind: 'invalid-response' });
    await expectProviderError(provider(jsonResponse([row({ reporting_month: '2026-06-01T00:00:00.000' })])).provider.monthlyTraffic(query), { kind: 'invalid-response' });
  });

  it('fails on duplicate airport-months', async () => {
    const { provider: p } = provider(jsonResponse([row(), row()]));
    await expectProviderError(p.monthlyTraffic(query), { kind: 'invalid-response' });
  });
});

describe('BtsTrafficProvider.availablePeriod', () => {
  it('maps the min and max reporting months to a period', async () => {
    const { provider: p } = provider(jsonResponse([{ min_reporting_month: '2014-01-01T00:00:00.000', max_reporting_month: '2026-04-01T00:00:00.000' }]));
    const result = await p.availablePeriod();
    expect(result.data).toEqual({ start: '2014-01', end: '2026-04' });
    expect(result.provenance.source).toBe('bts-socrata');
  });

  it('fails on an empty or malformed answer', async () => {
    await expectProviderError(provider(jsonResponse([])).provider.availablePeriod(), { kind: 'invalid-response' });
    await expectProviderError(provider(jsonResponse([{ min_reporting_month: 'x' }])).provider.availablePeriod(), { kind: 'invalid-response' });
  });
});
