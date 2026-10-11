import { z } from 'zod';
import { ProviderError } from '../../../application/errors';
import { PeriodSchema, type Period } from '../../../domain/period';
import { AirportMonthlyTrafficSchema, type AirportMonthlyTraffic } from '../../../domain/traffic';
import { parseResponse } from '../http';

/**
 * Socrata (SODA) rows from data.bts.gov dataset r495-tyji "AFF - T100 Segment Summary By Origin Airport".
 * Socrata returns every number as a string and omits fields that are null. Only the fields we use are
 * read, and Socrata's field names stay in this file.
 */
const WholeNumber = z
  .string()
  .regex(/^\d+(\.0+)?$/, 'expected a non-negative whole number')
  .transform(Number);
const Decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'expected a non-negative number')
  .transform(Number);
const MonthStart = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01T00:00:00(\.000)?$/, 'expected the first day of a month');

const TrafficRowDto = z.object({
  origin_airport_code: z.string(),
  reporting_month: MonthStart,
  total_departures: WholeNumber,
  total_passengers: WholeNumber,
  total_seats: WholeNumber,
  total_load_factor: Decimal.optional(),
  total_freight_lbs: WholeNumber,
  total_mail_lbs: WholeNumber,
  domestic_departures: WholeNumber.optional(),
  outbound_international: WholeNumber.optional(),
});

export const TRAFFIC_SELECT = Object.keys(TrafficRowDto.shape).join(',');

export function mapTrafficRows(payload: unknown): AirportMonthlyTraffic[] {
  return parseResponse('bts-socrata', z.array(TrafficRowDto), payload, 'traffic rows').map((row) => {
    const month = row.reporting_month.slice(0, 7);
    const mapped = AirportMonthlyTrafficSchema.safeParse({
      airport: row.origin_airport_code,
      month,
      departures: row.total_departures,
      passengers: row.total_passengers,
      seats: row.total_seats,
      loadFactorPercent: row.total_load_factor,
      freightLbs: row.total_freight_lbs,
      mailLbs: row.total_mail_lbs,
      domesticDepartures: row.domestic_departures,
      outboundInternationalDepartures: row.outbound_international,
    });
    if (!mapped.success) {
      const issues = mapped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ProviderError('bts-socrata', 'invalid-response', `traffic row ${row.origin_airport_code} ${month}: ${issues}`);
    }
    return mapped.data;
  });
}

const PeriodRowsDto = z.array(z.object({ min_reporting_month: MonthStart, max_reporting_month: MonthStart })).length(1);

export function mapAvailablePeriod(payload: unknown): Period {
  const [row] = parseResponse('bts-socrata', PeriodRowsDto, payload, 'available period');
  if (!row) throw new ProviderError('bts-socrata', 'invalid-response', 'no available period returned');
  return parseResponse(
    'bts-socrata',
    PeriodSchema,
    { start: row.min_reporting_month.slice(0, 7), end: row.max_reporting_month.slice(0, 7) },
    'available period',
  );
}
