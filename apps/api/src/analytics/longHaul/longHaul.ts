import type { AirportCode } from '../../domain/codes';
import type { GeoPoint } from '../../domain/geo';
import type { Provenance } from '../../domain/provenance';
import type { RouteFrequency } from '../../domain/routes';
import { DISTANCE_BAND_EDGES_MILES, LONG_HAUL_DEFAULT_MILES } from '../assumptions';
import type { MissingInput } from '../common';
import { greatCircleMiles, isUsablePoint } from '../distance';

export interface DistanceBand {
  readonly label: string;
  readonly minMiles: number;
  /** Exclusive upper edge; null for the open-ended last band. */
  readonly maxMilesExclusive: number | null;
  readonly averageDailyFlights: number;
  /** This band's share of ALL listed scheduled departures (the same denominator as the long-haul share). */
  readonly share: number | undefined;
}

export interface RouteContribution {
  readonly destination: string;
  readonly averageDailyFlights: number;
  readonly distanceMiles: number;
}

export interface LongHaulShareResult {
  readonly airport: AirportCode;
  readonly thresholdMiles: number;
  readonly thresholdSource: 'default' | 'user';
  /** longHaulAverageDailyFlights / totalAverageDailyFlights; undefined when no routes were returned. */
  readonly share: number | undefined;
  /**
   * The share if every route whose distance could not be computed were long-haul, and if none were.
   * Equal to `share` when every route could be classified.
   */
  readonly shareRange: { readonly min: number; readonly max: number } | undefined;
  readonly longHaulAverageDailyFlights: number;
  /** Sum of averageDailyFlights over ALL returned routes, classifiable or not. */
  readonly totalAverageDailyFlights: number;
  readonly unclassifiedAverageDailyFlights: number;
  readonly routeCount: number;
  readonly classifiedRouteCount: number;
  readonly longHaulRoutes: readonly RouteContribution[];
  readonly unclassifiedRoutes: readonly { readonly destination: string; readonly averageDailyFlights: number; readonly reason: string }[];
  readonly distanceBands: readonly DistanceBand[];
  readonly observationDescription: string;
  readonly assumptions: readonly string[];
  readonly missingInputs: readonly MissingInput[];
  readonly provenance: readonly Provenance[];
}

export interface LongHaulInput {
  readonly origin: { readonly code: AirportCode; readonly location: GeoPoint };
  readonly routes: readonly RouteFrequency[];
  readonly provenance: Provenance;
  /** Custom threshold in statute miles; the default applies when omitted. */
  readonly thresholdMiles?: number;
}

const destinationLabel = (route: RouteFrequency): string => route.destination.iataCode ?? route.destination.icaoCode ?? route.destination.name;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

export function computeLongHaulShare({ origin, routes, provenance, thresholdMiles }: LongHaulInput): LongHaulShareResult {
  if (thresholdMiles !== undefined && !(Number.isFinite(thresholdMiles) && thresholdMiles > 0)) {
    throw new RangeError('thresholdMiles must be a positive number');
  }
  const threshold = thresholdMiles ?? LONG_HAUL_DEFAULT_MILES;

  const classified: RouteContribution[] = [];
  const unclassified: { destination: string; averageDailyFlights: number; reason: string }[] = [];
  for (const route of routes) {
    const label = destinationLabel(route);
    if (!isUsablePoint(route.destination.location)) {
      unclassified.push({ destination: label, averageDailyFlights: route.averageDailyFlights, reason: 'destination coordinates missing or invalid' });
      continue;
    }
    classified.push({
      destination: label,
      averageDailyFlights: route.averageDailyFlights,
      distanceMiles: greatCircleMiles(origin.location, route.destination.location),
    });
  }

  const total = sum(routes.map((r) => r.averageDailyFlights));
  const unclassifiedFlights = sum(unclassified.map((r) => r.averageDailyFlights));
  const longHaul = classified
    .filter((r) => r.distanceMiles >= threshold)
    .sort((a, b) => b.averageDailyFlights - a.averageDailyFlights || a.destination.localeCompare(b.destination));
  const longHaulFlights = sum(longHaul.map((r) => r.averageDailyFlights));
  const share = total > 0 ? longHaulFlights / total : undefined;

  const missingInputs: MissingInput[] = [];
  if (routes.length === 0) missingInputs.push({ input: 'routes', reason: 'no routes were returned for this airport' });
  if (unclassified.length > 0) {
    missingInputs.push({
      input: 'destination coordinates',
      reason: `${unclassified.length} of ${routes.length} routes (${unclassifiedFlights.toFixed(2)} of ${total.toFixed(2)} daily flights) could not be placed at a distance`,
    });
  }

  return {
    airport: origin.code,
    thresholdMiles: threshold,
    thresholdSource: thresholdMiles === undefined ? 'default' : 'user',
    share,
    shareRange: total > 0 ? { min: longHaulFlights / total, max: (longHaulFlights + unclassifiedFlights) / total } : undefined,
    longHaulAverageDailyFlights: longHaulFlights,
    totalAverageDailyFlights: total,
    unclassifiedAverageDailyFlights: unclassifiedFlights,
    routeCount: routes.length,
    classifiedRouteCount: classified.length,
    longHaulRoutes: longHaul,
    unclassifiedRoutes: unclassified.sort((a, b) => b.averageDailyFlights - a.averageDailyFlights || a.destination.localeCompare(b.destination)),
    distanceBands: distanceBands(classified, total),
    observationDescription: `Average daily scheduled departures over the 7 days before ${provenance.retrievedAt.slice(0, 10)} (AeroDataBox route statistic).`,
    assumptions: longHaulAssumptions(threshold),
    missingInputs,
    provenance: [provenance],
  };
}

function longHaulAssumptions(threshold: number): string[] {
  return [
    `A route is long-haul when its great-circle distance is at least ${threshold} statute miles (the comparison is inclusive).`,
    'The share is of SCHEDULED departures across all listed service types. Passenger and cargo operators are not distinguished, so it is NOT a passenger-only figure.',
    'Routes are weighted by averageDailyFlights, an average of scheduled flights over the preceding 7 days; destinations are not counted equally and performed flights are not measured.',
    'Distance is the great-circle distance between airport coordinates, not flown distance.',
    'Distance bands use fixed edges (1000, 2000, 3000 miles) and do not move with a custom threshold.',
  ];
}

function distanceBands(classified: readonly RouteContribution[], total: number): DistanceBand[] {
  const edges = [0, ...DISTANCE_BAND_EDGES_MILES];
  return edges.map((min, index) => {
    const max = edges[index + 1] ?? null;
    const flights = sum(classified.filter((r) => r.distanceMiles >= min && (max === null || r.distanceMiles < max)).map((r) => r.averageDailyFlights));
    return {
      label: max === null ? `>=${min}` : min === 0 ? `<${max}` : `${min}-${max - 1}`,
      minMiles: min,
      maxMilesExclusive: max,
      averageDailyFlights: flights,
      share: total > 0 ? flights / total : undefined,
    };
  });
}
