import { z } from 'zod';
import { AirportCodeSchema, CountryCodeSchema } from './codes';
import { GeoPointSchema } from './geo';

/**
 * A route from an origin airport with its scheduled frequency.
 *
 * `averageDailyFlights` is an average of SCHEDULED departures on the route over a recent period, across
 * all service types (passenger and cargo). It is not a count of performed flights, passengers or seats.
 * `destination.location` is absent when the source does not supply coordinates.
 */
export const RouteFrequencySchema = z.object({
  destination: z.object({
    iataCode: AirportCodeSchema.optional(),
    icaoCode: z.string().regex(/^[A-Z0-9]{4}$/).optional(),
    name: z.string().min(1),
    countryCode: CountryCodeSchema.optional(),
    location: GeoPointSchema.optional(),
  }),
  averageDailyFlights: z.number().nonnegative(),
  operators: z.array(z.string().min(1)),
});
export type RouteFrequency = z.infer<typeof RouteFrequencySchema>;
