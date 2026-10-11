import { z } from 'zod';
import { AirportCodeSchema } from './codes';
import { YearMonthSchema } from './period';

const Count = z.number().int().nonnegative();

/**
 * Monthly commercial traffic departing one airport, as reported to BTS (T-100 segment data summed over
 * carriers and destinations). One record per airport and month.
 *
 * `departures` counts all reported departures, cargo flights included; `seats` and `passengers` exist
 * only for passenger-carrying flights, so seats per departure is NOT seats per passenger flight.
 * Optional fields are absent when BTS reports nothing for them (for example no seats means no load
 * factor, and no international departures leaves that field out). Absence is never converted to zero.
 */
export const AirportMonthlyTrafficSchema = z.object({
  airport: AirportCodeSchema,
  month: YearMonthSchema,
  departures: Count,
  passengers: Count,
  seats: Count,
  /** Passengers as a percentage of seats, as reported by BTS; can exceed 100 in rare records. */
  loadFactorPercent: z.number().nonnegative().optional(),
  freightLbs: Count,
  mailLbs: Count,
  domesticDepartures: Count.optional(),
  outboundInternationalDepartures: Count.optional(),
});
export type AirportMonthlyTraffic = z.infer<typeof AirportMonthlyTrafficSchema>;
