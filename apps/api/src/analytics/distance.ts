import type { GeoPoint } from '../domain/geo';
import { EARTH_MEAN_RADIUS_MILES } from './assumptions';

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function isUsablePoint(point: GeoPoint | undefined): point is GeoPoint {
  return (
    point !== undefined &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** Great-circle (haversine) distance in statute miles. This is not flown distance. */
export function greatCircleMiles(a: GeoPoint, b: GeoPoint): number {
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  // Clamp against rounding just above 1 for antipodal points.
  return 2 * EARTH_MEAN_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}
