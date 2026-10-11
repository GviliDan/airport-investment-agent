import { z } from 'zod';
import { AirportCodeSchema, StateCodeSchema } from './codes';
import { GeoPointSchema } from './geo';

const AirportUseSchema = z.enum(['public', 'private']);

/** FAA Part 139 airport certification, held by airports with scheduled or unscheduled air-carrier service. */
const Part139CertificationSchema = z.object({
  /** FAA certification class, e.g. "I C" or "IV A". */
  classification: z.string().min(1),
  service: z.enum(['scheduled', 'unscheduled']),
});

/**
 * An airport as described by the FAA. Part 139 certification is evidence of air-carrier service but
 * not a complete definition of "commercial": some subsidized small-community airports are not certified.
 */
export const AirportSchema = z.object({
  code: AirportCodeSchema,
  icaoCode: z.string().regex(/^[A-Z0-9]{4}$/).optional(),
  name: z.string().min(1),
  city: z.string().min(1),
  state: StateCodeSchema,
  location: GeoPointSchema,
  use: AirportUseSchema,
  part139: Part139CertificationSchema.optional(),
  /** FAA control tower type, e.g. "ATCT", "ATCT-TRACON", "NON-ATCT". */
  towerType: z.string().min(1).optional(),
});
export type Airport = z.infer<typeof AirportSchema>;
