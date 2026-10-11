import type { StateCode } from '../domain/codes';

/**
 * Business assumptions used by the analytics. They live in code, versioned with the formulas that use
 * them, and are not environment configuration. Every result repeats the assumptions that apply to it.
 */

/** A route is long-haul at this great-circle distance or more (inclusive), in statute miles. */
export const LONG_HAUL_DEFAULT_MILES = 3000;

/** Lower edges of the reporting distance bands: <1000, 1000-1999, 2000-2999, >=3000 miles. */
export const DISTANCE_BAND_EDGES_MILES: readonly number[] = [1000, 2000, 3000];

/** Length of the current and previous windows compared for traffic trends. */
export const COMPARISON_WINDOW_MONTHS = 12;

/** Mean Earth radius (6,371.0088 km) in statute miles, for great-circle distance. */
export const EARTH_MEAN_RADIUS_MILES = 3958.7613;

export const NEW_ENGLAND_STATES: readonly StateCode[] = ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'];

/**
 * An airport is a commercial-activity candidate at this many passengers over the latest complete
 * 12 months. 10,000 is the FAA's annual-enplanement threshold for a "primary" commercial-service
 * airport. BTS passengers on flights departing an airport approximate FAA enplanements (they are
 * measured on segments, include connecting passengers on those segments, and cover a rolling
 * 12-month window rather than a calendar year), so the threshold is applied as an explicit approximation.
 */
export const CANDIDATE_MIN_ANNUAL_PASSENGERS = 10_000;
