import { z } from 'zod';

const Count = z.number().int().nonnegative();

/** Delay statistics for one direction of traffic within a snapshot window. */
const FlightDelaySummarySchema = z.object({
  flights: Count,
  /** Flights that had enough information to be included in the delay statistics. */
  qualifiedFlights: Count,
  cancelled: Count,
  /** Median delay against schedule in minutes; negative means early. Absent when there is not enough data. */
  medianDelayMinutes: z.number().optional(),
  /** Normalized 0.0-5.0 index of delays and cancellations in the window (0 = none). Absent when unknown. */
  delayIndex: z.number().min(0).max(5).optional(),
});

/**
 * Delay statistics for the flights of one airport within a trailing window ending at `windowEnd`.
 * Statistics describe lateness versus the published schedule; they are not a measure of capacity.
 */
export const AirportDelaySnapshotSchema = z.object({
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  departures: FlightDelaySummarySchema,
  arrivals: FlightDelaySummarySchema,
});
export type AirportDelaySnapshot = z.infer<typeof AirportDelaySnapshotSchema>;
