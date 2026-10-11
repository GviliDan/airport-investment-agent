import type { Airport } from '../../domain/airport';
import { AirportCodeSchema, type AirportCode } from '../../domain/codes';
import type { AirportDelaySnapshot } from '../../domain/delays';
import { monthsInPeriod, PeriodSchema, type Period } from '../../domain/period';
import type { Provenance } from '../../domain/provenance';
import type { RouteFrequency } from '../../domain/routes';
import type { AirportMonthlyTraffic } from '../../domain/traffic';

export const code = (value: string): AirportCode => AirportCodeSchema.parse(value);
export const period = (start: string, end: string): Period => PeriodSchema.parse({ start, end });

export const btsProvenance: Provenance = { source: 'bts-socrata', dataset: 'test BTS', retrievedAt: '2026-10-07T12:00:00.000Z' };
export const adbProvenance: Provenance = { source: 'aerodatabox', dataset: 'test AeroDataBox', retrievedAt: '2026-10-07T12:00:00.000Z' };

export const LOCATIONS = {
  ANC: { latitude: 61.1744, longitude: -149.996 },
  SEA: { latitude: 47.449, longitude: -122.309 },
  JFK: { latitude: 40.6398, longitude: -73.7789 },
  LAX: { latitude: 33.9425, longitude: -118.4081 },
  SFO: { latitude: 37.6213, longitude: -122.379 },
  LHR: { latitude: 51.47, longitude: -0.4543 },
};

export function trafficRow(airport: string, month: string, patch: Partial<AirportMonthlyTraffic> = {}): AirportMonthlyTraffic {
  return {
    airport: code(airport),
    month: month as AirportMonthlyTraffic['month'],
    departures: 100,
    passengers: 10_000,
    seats: 12_500,
    freightLbs: 0,
    mailLbs: 0,
    ...patch,
  };
}

/** One row per month of the period, each built by `patch(month)`. */
export function monthlyRows(airport: string, p: Period, patch: (month: string) => Partial<AirportMonthlyTraffic> = () => ({})): AirportMonthlyTraffic[] {
  return monthsInPeriod(p).map((month) => trafficRow(airport, month, patch(month)));
}

export function route(destination: string, averageDailyFlights: number, location?: { latitude: number; longitude: number }, operators: string[] = []): RouteFrequency {
  return {
    destination: { iataCode: code(destination), name: destination, ...(location ? { location } : {}) },
    averageDailyFlights,
    operators,
  };
}

export function airport(codeValue: string, patch: Partial<Airport> = {}): Airport {
  return {
    code: code(codeValue),
    name: `${codeValue} AIRPORT`,
    city: codeValue,
    state: 'MA',
    location: { latitude: 42, longitude: -71 },
    use: 'public',
    ...patch,
  };
}

type Window = AirportDelaySnapshot['departures'];
const windowSummary = (patch: Partial<Window> = {}): Window => ({ flights: 10, qualifiedFlights: 10, cancelled: 0, ...patch });

/** A snapshot covering [startHour, endHour) of 2026-10-06 UTC. */
export function snapshot(startHour: number, endHour: number, departures: Partial<Window> = {}, arrivals: Partial<Window> = {}): AirportDelaySnapshot {
  const at = (hour: number): string => `2026-10-06T${String(hour).padStart(2, '0')}:00:00Z`;
  return { windowStart: at(startHour), windowEnd: at(endHour), departures: windowSummary(departures), arrivals: windowSummary(arrivals) };
}
