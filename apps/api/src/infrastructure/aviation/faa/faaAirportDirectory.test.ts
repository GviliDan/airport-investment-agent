import { describe, expect, it } from 'vitest';
import { code, expectProviderError, FIXED_NOW, jsonResponse, mockFetch } from '../__tests__/support';
import { buildFacilitiesUrl, codesFilter, FAA_FACILITIES_URL, FaaAirportDirectory, searchFilter, statesFilter } from './faaAirportDirectory';

const attributes = (patch: Record<string, unknown> = {}) => ({
  ARPT_ID: 'BDL',
  ICAO_ID: 'KBDL',
  ARPT_NAME: 'BRADLEY INTL',
  CITY: 'WINDSOR LOCKS',
  STATE_CODE: 'CT',
  LAT_DECIMAL: 41.939,
  LONG_DECIMAL: -72.684,
  FACILITY_USE_CODE: 'PU',
  SITE_TYPE_CODE: 'A',
  FAR_139_TYPE_CODE: 'I C',
  FAR_139_CARRIER_SER_CODE: 'S',
  TWR_TYPE_CODE: 'ATCT',
  EFF_DATE: '2026/10/01',
  ...patch,
});
const page = (items: Record<string, unknown>[], exceeded = false) => ({
  features: items.map((a) => ({ attributes: a })),
  ...(exceeded ? { exceededTransferLimit: true } : {}),
});

const directory = (...responses: Parameters<typeof mockFetch>) => {
  const mock = mockFetch(...responses);
  return { ...mock, directory: new FaaAirportDirectory({ fetch: mock.fetch, now: FIXED_NOW }) };
};
const NEW_ENGLAND = ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'];

describe('query construction', () => {
  it('filters the six New England states server-side, as public-use airports', () => {
    const url = buildFacilitiesUrl(FAA_FACILITIES_URL, statesFilter({ states: NEW_ENGLAND, publicUseOnly: true }), 0);
    expect(url.searchParams.get('where')).toBe("SITE_TYPE_CODE='A' AND STATE_CODE IN ('CT','MA','ME','NH','RI','VT') AND FACILITY_USE_CODE='PU'");
    expect(url.searchParams.get('returnGeometry')).toBe('false');
    expect(url.searchParams.get('f')).toBe('json');
    expect(url.searchParams.get('outFields')).toContain('FAR_139_TYPE_CODE');
  });

  it('can include private-use facilities', () => {
    expect(statesFilter({ states: ['MA'], publicUseOnly: false })).toBe("STATE_CODE IN ('MA')");
  });

  it('builds a code lookup with sorted, de-duplicated codes', () => {
    expect(codesFilter([code('PVD'), code('BOS'), code('PVD')])).toBe("ARPT_ID IN ('BOS','PVD')");
  });

  it('rejects a malformed state before building any query', () => {
    expect(() => statesFilter({ states: ["MA') OR 1=1 --"], publicUseOnly: true })).toThrow();
  });
});

describe('FaaAirportDirectory.airportsInStates', () => {
  it('maps facilities into normalized airports with coordinates and classification', async () => {
    const { directory: d } = directory(jsonResponse(page([attributes()])));
    const result = await d.airportsInStates({ states: ['CT'], publicUseOnly: true });
    expect(result.data).toEqual([
      {
        code: 'BDL',
        icaoCode: 'KBDL',
        name: 'BRADLEY INTL',
        city: 'WINDSOR LOCKS',
        state: 'CT',
        location: { latitude: 41.939, longitude: -72.684 },
        use: 'public',
        part139: { classification: 'I C', service: 'scheduled' },
        towerType: 'ATCT',
      },
    ]);
    expect(result.provenance).toEqual({
      source: 'faa-arcgis',
      dataset: expect.stringContaining('FAA'),
      retrievedAt: '2026-10-07T12:00:00.000Z',
      effectiveDate: '2026-10-01',
    });
  });

  it('maps blank FAA fields to absent values and distinguishes unscheduled service and private use', async () => {
    const small = attributes({ ARPT_ID: 'RUT', ICAO_ID: '', FAR_139_TYPE_CODE: '', FAR_139_CARRIER_SER_CODE: '', TWR_TYPE_CODE: '', FACILITY_USE_CODE: 'PR' });
    const unscheduled = attributes({ ARPT_ID: 'GON', FAR_139_TYPE_CODE: 'IV A', FAR_139_CARRIER_SER_CODE: 'U' });
    const { directory: d } = directory(jsonResponse(page([small, unscheduled])));
    const [rut, gon] = (await d.airportsInStates({ states: ['VT', 'CT'], publicUseOnly: false })).data;
    expect(rut).toMatchObject({ code: 'RUT', use: 'private' });
    expect(rut?.icaoCode).toBeUndefined();
    expect(rut?.part139).toBeUndefined();
    expect(rut?.towerType).toBeUndefined();
    expect(gon?.part139).toEqual({ classification: 'IV A', service: 'unscheduled' });
  });

  it('follows pages until the layer stops reporting a transfer limit', async () => {
    const { directory: d, urls } = directory(
      jsonResponse(page([attributes({ ARPT_ID: 'BDL' })], true)),
      jsonResponse(page([attributes({ ARPT_ID: 'BOS', STATE_CODE: 'MA' })])),
    );
    const result = await d.airportsInStates({ states: ['CT', 'MA'], publicUseOnly: true });
    expect(result.data.map((a) => a.code)).toEqual(['BDL', 'BOS']);
    expect(urls().map((u) => u.searchParams.get('resultOffset'))).toEqual(['0', '2000']);
  });

  it('does not call the API for an empty state list', async () => {
    const { directory: d, fetch } = directory();
    expect((await d.airportsInStates({ states: [], publicUseOnly: true })).data).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails on a non-200 response', async () => {
    const { directory: d } = directory(new Response('Bad gateway', { status: 502 }));
    await expectProviderError(d.airportsInStates({ states: ['CT'], publicUseOnly: true }), { kind: 'http-status', status: 502 });
  });

  it('fails on an ArcGIS error reported inside a 200 response', async () => {
    const { directory: d } = directory(jsonResponse({ error: { code: 400, message: 'Invalid query parameters' } }));
    const error = await expectProviderError(d.airportsInStates({ states: ['CT'], publicUseOnly: true }), { kind: 'http-status' });
    expect(error.message).toContain('Invalid query parameters');
  });

  it.each([
    ['text instead of a latitude', { LAT_DECIMAL: '41.9' }],
    ['a latitude out of range', { LAT_DECIMAL: 123 }],
    ['an unknown use code', { FACILITY_USE_CODE: 'XX' }],
    ['a facility identifier that is not an airport code', { ARPT_ID: '02MA' }],
    ['a non-airport site type', { SITE_TYPE_CODE: 'H' }],
    ['a Part 139 class without a service code', { FAR_139_CARRIER_SER_CODE: '' }],
    ['a missing name', { ARPT_NAME: undefined }],
  ])('fails on %s rather than guessing', async (_label, patch) => {
    const { directory: d } = directory(jsonResponse(page([attributes(patch)])));
    await expectProviderError(d.airportsInStates({ states: ['CT'], publicUseOnly: true }), { kind: 'invalid-response' });
  });

  it('fails on a response without features', async () => {
    const { directory: d } = directory(jsonResponse({ unexpected: true }));
    await expectProviderError(d.airportsInStates({ states: ['CT'], publicUseOnly: true }), { kind: 'invalid-response' });
  });

  it('fails on duplicate facilities', async () => {
    const { directory: d } = directory(jsonResponse(page([attributes(), attributes()])));
    await expectProviderError(d.airportsInStates({ states: ['CT'], publicUseOnly: true }), { kind: 'invalid-response' });
  });
});

describe('FaaAirportDirectory.airportsByCode', () => {
  it('looks airports up by code with a server-side filter', async () => {
    const { directory: d, urls } = directory(jsonResponse(page([attributes()])));
    const result = await d.airportsByCode([code('BDL')]);
    expect(result.data.map((a) => a.code)).toEqual(['BDL']);
    expect(urls()[0]?.searchParams.get('where')).toBe("SITE_TYPE_CODE='A' AND ARPT_ID IN ('BDL')");
  });

  it('returns only the airports the FAA knows', async () => {
    const { directory: d } = directory(jsonResponse(page([])));
    expect((await d.airportsByCode([code('ZZZ')])).data).toEqual([]);
  });

  it('refuses too many codes without sending anything', async () => {
    const { directory: d, fetch } = directory();
    const codes = Array.from({ length: 301 }, (_, i) => code(String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)) + 'X'));
    await expectProviderError(d.airportsByCode(codes), { kind: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('text search', () => {
  it('matches city, name and (for three characters) code, public-use only, optionally scheduled service only', () => {
    expect(searchFilter({ text: 'Santa Ana', scheduledServiceOnly: true })).toBe(
      "FACILITY_USE_CODE='PU' AND (CITY LIKE 'SANTA ANA%' OR ARPT_NAME LIKE '%SANTA ANA%') AND FAR_139_CARRIER_SER_CODE='S'",
    );
    expect(searchFilter({ text: 'sfo', scheduledServiceOnly: false })).toBe("FACILITY_USE_CODE='PU' AND (CITY LIKE 'SFO%' OR ARPT_NAME LIKE 'SFO%' OR ARPT_ID='SFO')");
  });

  it('cannot be used to change the query: the text stays inside one string literal with quotes doubled', () => {
    const literal = /^FACILITY_USE_CODE='PU' AND \(CITY LIKE '(?:[^']|'')*%' OR ARPT_NAME LIKE '(?:[^']|'')*'\)$/;
    for (const text of ["x') OR 1=1 --; DROP%_", "'''", "a' OR ''='", 'x" OR 1=1']) {
      expect(searchFilter({ text, scheduledServiceOnly: false }) ?? '').toMatch(literal);
    }
    expect(searchFilter({ text: "O'Hare", scheduledServiceOnly: false })).toContain("O''HARE");
    expect(searchFilter({ text: '  %%  ', scheduledServiceOnly: false })).toBeUndefined();
  });

  it('returns the matching airports with a single bounded request, and nothing for unsearchable text', async () => {
    const { directory: d, urls } = directory(jsonResponse(page([attributes()])));
    const result = await d.searchAirports({ text: 'Windsor Locks', scheduledServiceOnly: true, limit: 8 });
    expect(result.data.map((a) => a.code)).toEqual(['BDL']);
    expect(urls()).toHaveLength(1);
    expect(urls()[0]?.searchParams.get('resultRecordCount')).toBe('9');
    const none = directory();
    expect((await none.directory.searchAirports({ text: '%%', scheduledServiceOnly: true, limit: 8 })).data).toEqual([]);
    expect(none.urls()).toHaveLength(0);
  });
});
