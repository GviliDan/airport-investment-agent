import { describe, expect, it } from 'vitest';
import type { AirportAnalyticsService } from '../../application/airportAnalyticsService';
import { buildTools } from './airportTools';
import { toToolDefinition } from './tool';

const tools = buildTools({} as AirportAnalyticsService);
const byName = (name: string) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

describe('tool set', () => {
  it('exposes exactly the six agreed tools', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'resolve_airports',
      'get_airport_profile',
      'get_long_haul_share',
      'compare_airport_congestion',
      'rank_terminal_expansion',
      'estimate_unmet_demand_pressure',
    ]);
  });

  it('renders narrow JSON Schemas from the Zod inputs', () => {
    for (const tool of tools) {
      const definition = toToolDefinition(tool);
      expect(definition.parameters).toMatchObject({ type: 'object' });
      expect(definition.parameters).not.toHaveProperty('$schema');
      expect(definition.description.length).toBeGreaterThan(20);
    }
    const longHaul = toToolDefinition(byName('get_long_haul_share')).parameters as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(longHaul.properties)).toEqual(['airport', 'thresholdMiles']);
    expect(longHaul.required).toEqual(['airport']);
  });
});

describe('argument validation', () => {
  it('normalizes airport codes to upper case', () => {
    expect(byName('get_airport_profile').input.parse({ airport: 'sfo' })).toEqual({ airport: 'SFO' });
  });

  it.each([
    ['get_airport_profile', { airport: 'San Francisco' }],
    ['get_airport_profile', { airport: 'SF' }],
    ['get_airport_profile', { airport: "SFO'; DROP" }],
    ['get_long_haul_share', { airport: 'ANC', thresholdMiles: 0 }],
    ['get_long_haul_share', { airport: 'ANC', thresholdMiles: -5 }],
    ['get_long_haul_share', { airport: 'ANC', thresholdMiles: 'far' }],
    ['get_long_haul_share', { airport: 'ANC', thresholdMiles: 1_000_000 }],
    ['rank_terminal_expansion', { region: 'texas' }],
    ['rank_terminal_expansion', { compare: ['HVN'] }],
    ['resolve_airports', { query: '' }],
    ['compare_airport_congestion', { airportA: 'LAX' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA', from: '2026-10-07T08:00' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA', from: '2026-10-07 08:00', to: '2026-10-07 10:00' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA', from: '2026-10-07T08:00', to: '2026-10-08T08:00' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA', from: '2026-10-07T10:00', to: '2026-10-07T08:00' }],
  ])('rejects invalid arguments for %s: %j', (name, args) => {
    expect(byName(name).input.safeParse(args).success).toBe(false);
  });

  it.each([
    ['rank_terminal_expansion', {}],
    ['rank_terminal_expansion', { region: 'new-england' }],
    ['rank_terminal_expansion', { compare: ['hvn', 'BOS'] }],
    ['rank_terminal_expansion', { compare: [] }],
    ['rank_terminal_expansion', { compare: null }],
    ['get_long_haul_share', { airport: 'ANC', thresholdMiles: 2500 }],
    ['estimate_unmet_demand_pressure', { airport: 'sfo' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA' }],
    ['compare_airport_congestion', { airportA: 'LAX', airportB: 'SNA', from: '2026-10-07T08:00', to: '2026-10-07T20:00' }],
  ])('accepts valid arguments for %s: %j', (name, args) => {
    expect(byName(name).input.safeParse(args).success).toBe(true);
  });
});
