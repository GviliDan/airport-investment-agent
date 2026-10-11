import { z } from 'zod';
import { ProviderError } from '../../../application/errors';
import type { RouteNetworkProvider } from '../../../application/ports';
import { AirportCodeSchema, CountryCodeSchema, type AirportCode } from '../../../domain/codes';
import type { Sourced } from '../../../domain/provenance';
import { RouteFrequencySchema, type RouteFrequency } from '../../../domain/routes';
import { parseResponse } from '../http';
import type { AeroDataBoxGet } from './client';

const DATASET = 'AeroDataBox airport routes and daily flight destinations (stats/routes/daily)';

/**
 * AeroDataBox `DailyRouteStatContract`. Only the consumed fields are read; RapidAPI/AeroDataBox names
 * stay in this file. `averageDailyFlights` averages SCHEDULED flights over the preceding 7 days.
 */
const RoutesDto = z.object({
  routes: z.array(
    z.object({
      destination: z.object({
        iata: z.string().min(1).optional(),
        icao: z.string().min(1).optional(),
        name: z.string().min(1),
        countryCode: z.string().min(1).optional(),
        location: z.object({ lat: z.number(), lon: z.number() }).optional(),
      }),
      averageDailyFlights: z.number(),
      operators: z.array(z.object({ name: z.string().min(1) })).default([]),
    }),
  ),
});

function mapRoutes(payload: unknown): RouteFrequency[] {
  return parseResponse('aerodatabox', RoutesDto, payload, 'routes response').routes.map(({ destination: d, averageDailyFlights, operators }) => {
    const mapped = RouteFrequencySchema.safeParse({
      destination: {
        iataCode: d.iata,
        icaoCode: d.icao,
        name: d.name,
        countryCode: d.countryCode === undefined ? undefined : CountryCodeSchema.parse(d.countryCode),
        location: d.location === undefined ? undefined : { latitude: d.location.lat, longitude: d.location.lon },
      },
      averageDailyFlights,
      operators: operators.map((o) => o.name),
    });
    if (!mapped.success) {
      const issues = mapped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ProviderError('aerodatabox', 'invalid-response', `route to ${d.iata ?? d.icao ?? d.name}: ${issues}`);
    }
    return mapped.data;
  });
}

/** RouteNetworkProvider backed by AeroDataBox. Costs quota on every call, so callers should cache results. */
export class AeroDataBoxRouteNetworkProvider implements RouteNetworkProvider {
  constructor(
    private readonly get: AeroDataBoxGet,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dailyRoutes(origin: AirportCode): Promise<Sourced<readonly RouteFrequency[]>> {
    const code = AirportCodeSchema.parse(origin);
    const routes = mapRoutes(await this.get(`/airports/iata/${code}/stats/routes/daily`));
    return { data: routes, provenance: { source: 'aerodatabox', dataset: DATASET, retrievedAt: this.now().toISOString() } };
  }
}
