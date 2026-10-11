import { z } from 'zod';
import { ProviderError } from '../../../application/errors';
import { AirportSchema, type Airport } from '../../../domain/airport';
import { parseResponse } from '../http';

/**
 * FAA "Aviation Facilities" ArcGIS feature layer (NTAD_Aviation_Facilities). FAA field names stay in this
 * file. The FAA publishes blank strings for "not applicable", which map to absent values.
 */
const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const FacilityAttributesDto = z.object({
  ARPT_ID: z.string(),
  ICAO_ID: blankable(z.string()),
  ARPT_NAME: z.string(),
  CITY: z.string(),
  STATE_CODE: z.string(),
  LAT_DECIMAL: z.number(),
  LONG_DECIMAL: z.number(),
  FACILITY_USE_CODE: z.enum(['PU', 'PR']),
  SITE_TYPE_CODE: z.string(),
  FAR_139_TYPE_CODE: blankable(z.string()),
  FAR_139_CARRIER_SER_CODE: blankable(z.enum(['S', 'U'])),
  TWR_TYPE_CODE: blankable(z.string()),
  EFF_DATE: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/),
});

/** ArcGIS reports query failures as HTTP 200 with an `error` object, so both shapes are modelled. */
const QueryResponseDto = z.union([
  z.object({ error: z.object({ code: z.number().optional(), message: z.string().optional() }) }),
  z.object({
    features: z.array(z.object({ attributes: FacilityAttributesDto })),
    exceededTransferLimit: z.boolean().optional(),
  }),
]);

export const FACILITY_OUT_FIELDS = Object.keys(FacilityAttributesDto.shape).join(',');

interface FacilityPage {
  readonly airports: Airport[];
  /** Latest FAA effective date among the returned facilities, as YYYY-MM-DD. */
  readonly effectiveDate: string | undefined;
  readonly exceededTransferLimit: boolean;
}

export function mapFacilityPage(payload: unknown): FacilityPage {
  const response = parseResponse('faa-arcgis', QueryResponseDto, payload, 'facilities response');
  if ('error' in response) {
    throw new ProviderError('faa-arcgis', 'http-status', `query failed: ${response.error.message ?? 'unknown error'} (code ${response.error.code ?? 'n/a'})`);
  }
  const airports = response.features.map(({ attributes: a }) => {
    if (a.SITE_TYPE_CODE !== 'A') {
      throw new ProviderError('faa-arcgis', 'invalid-response', `${a.ARPT_ID}: expected site type "A" (airport), got "${a.SITE_TYPE_CODE}"`);
    }
    if ((a.FAR_139_TYPE_CODE === undefined) !== (a.FAR_139_CARRIER_SER_CODE === undefined)) {
      throw new ProviderError('faa-arcgis', 'invalid-response', `${a.ARPT_ID}: Part 139 class and service code must be given together`);
    }
    const mapped = AirportSchema.safeParse({
      code: a.ARPT_ID,
      icaoCode: a.ICAO_ID,
      name: a.ARPT_NAME,
      city: a.CITY,
      state: a.STATE_CODE,
      location: { latitude: a.LAT_DECIMAL, longitude: a.LONG_DECIMAL },
      use: a.FACILITY_USE_CODE === 'PU' ? 'public' : 'private',
      part139:
        a.FAR_139_TYPE_CODE !== undefined && a.FAR_139_CARRIER_SER_CODE !== undefined
          ? { classification: a.FAR_139_TYPE_CODE, service: a.FAR_139_CARRIER_SER_CODE === 'S' ? 'scheduled' : 'unscheduled' }
          : undefined,
      towerType: a.TWR_TYPE_CODE,
    });
    if (!mapped.success) {
      const issues = mapped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ProviderError('faa-arcgis', 'invalid-response', `facility ${a.ARPT_ID}: ${issues}`);
    }
    return mapped.data;
  });
  const effectiveDates = response.features.map((f) => f.attributes.EFF_DATE.replaceAll('/', '-')).sort();
  return {
    airports,
    effectiveDate: effectiveDates.at(-1),
    exceededTransferLimit: response.exceededTransferLimit === true,
  };
}
