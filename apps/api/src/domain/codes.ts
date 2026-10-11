import { z } from 'zod';

/**
 * Airport identifier as used by BTS and the FAA: three uppercase letters or digits. Most are IATA codes,
 * but some commercial-service airports have none and are identified by an FAA location identifier
 * (e.g. "1G4" Grand Canyon West, "W33" Friday Harbor), which BTS also uses. Branded so arbitrary
 * strings cannot be passed where a validated code is expected.
 */
export const AirportCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{3}$/, 'Airport code must be three uppercase letters or digits')
  .brand<'AirportCode'>();
export type AirportCode = z.infer<typeof AirportCodeSchema>;

/** Two-letter country code as published by BTS (e.g. "US", "CA"). */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Country code must be two uppercase letters');

/** Two-letter US state or territory postal code (e.g. "MA", "PR"). */
export const StateCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'State code must be two uppercase letters');
export type StateCode = z.infer<typeof StateCodeSchema>;
