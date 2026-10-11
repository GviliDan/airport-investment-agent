import { z } from 'zod';
import type { Artifact } from '@airport/shared';
import type { AirportAnalyticsService } from '../../application/airportAnalyticsService';
import { AirportCodeSchema } from '../../domain/codes';
import {
  airportProfileArtifact,
  congestionComparisonArtifact,
  demandPressureArtifact,
  longHaulArtifact,
  rankingArtifact,
} from '../artifacts';
import { defineTool, type AgentTool } from './tool';

const airportCode = z
  .string()
  .regex(/^[A-Za-z0-9]{3}$/, 'an airport code is three letters or digits, for example "SFO"')
  .transform((value) => value.toUpperCase())
  .pipe(AirportCodeSchema)
  .describe('Three-letter airport code, for example "SFO". Use resolve_airports if you only have a name.');

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'use local date-time YYYY-MM-DDTHH:mm');

const MAX_WINDOW_HOURS = 12;

const windowFields = {
  from: localDateTime.optional().describe('Start of the observation window, local airport time YYYY-MM-DDTHH:mm. Omit to use the most recent 12 hours.'),
  to: localDateTime.optional().describe('End of the window, local airport time. At most 12 hours after "from".'),
};

function checkWindow(value: { from?: string | undefined; to?: string | undefined }, ctx: z.RefinementCtx): void {
  if ((value.from === undefined) !== (value.to === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'give both "from" and "to", or neither' });
    return;
  }
  if (value.from !== undefined && value.to !== undefined) {
    const hours = (Date.parse(`${value.to}:00Z`) - Date.parse(`${value.from}:00Z`)) / 3_600_000;
    if (!(hours > 0 && hours <= MAX_WINDOW_HOURS)) ctx.addIssue({ code: 'custom', message: `"to" must be after "from" and at most ${MAX_WINDOW_HOURS} hours later` });
  }
}

/**
 * The artifact is both what the UI renders and what the model reads. The model does not need the sources and the
 * long assumption lists (the UI shows them), so they are left out of what it reads.
 */
const ok = (artifact: Artifact) => ({
  result: Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'sources' && key !== 'assumptions')),
  artifacts: [artifact],
});

/** The six tools of the agent. They call application services only and return deterministic results. */
export function buildTools(analytics: AirportAnalyticsService): AgentTool[] {
  const resolveAirports = defineTool({
    name: 'resolve_airports',
    description:
      'Resolve an airport reference (a code such as "SFO", a city such as "Anchorage", or a name such as "Santa Ana") to FAA airports. Returns candidates. If "ambiguous" is true, do not guess: choose only when the user made it clear, otherwise ask the user.',
    input: z.object({ query: z.string().trim().min(1).max(80).describe('The airport reference as the user wrote it.') }),
    async execute({ query }) {
      const resolution = await analytics.resolveAirports(query);
      return {
        result: {
          query: resolution.query,
          matchType: resolution.matchType,
          ambiguous: resolution.ambiguous,
          truncated: resolution.truncated,
          limitedToScheduledAirCarrierAirports: resolution.scheduledServiceOnly,
          candidates: resolution.candidates.map((a) => ({
            code: a.code,
            name: a.name,
            city: a.city,
            state: a.state,
            latitude: Number(a.location.latitude.toFixed(4)),
            longitude: Number(a.location.longitude.toFixed(4)),
            scheduledAirCarrierService: a.part139?.service === 'scheduled',
          })),
          source: resolution.provenance.dataset,
        },
        artifacts: [],
      };
    },
  });

  const getAirportProfile = defineTool({
    name: 'get_airport_profile',
    description:
      'Descriptive traffic profile of one US airport from BTS: passengers, seats, departures, load factor and year-over-year growth for the latest 12 months against the 12 before. Descriptive only; it does not score or rank.',
    input: z.object({ airport: airportCode }),
    async execute({ airport }) {
      return ok(airportProfileArtifact(await analytics.airportProfile(airport)));
    },
  });

  const getLongHaulShare = defineTool({
    name: 'get_long_haul_share',
    description:
      'Share of an airport\'s scheduled departures that go on routes of at least a distance threshold (default 3,000 statute miles), weighted by average daily scheduled flights, with distance bands. It covers scheduled departures across all service types, not passengers only. Quote mandatoryNotice verbatim.',
    input: z.object({
      airport: airportCode,
      thresholdMiles: z.number().positive().max(12_000).optional().describe('Long-haul threshold in statute miles. Omit for the default of 3,000.'),
    }),
    async execute({ airport, thresholdMiles }) {
      const [origin, share] = await Promise.all([analytics.lookupAirport(airport), analytics.longHaulShare(airport, thresholdMiles === undefined ? {} : { thresholdMiles })]);
      return ok(longHaulArtifact(origin, share));
    },
  });

  const compareAirportCongestion = defineTool({
    name: 'compare_airport_congestion',
    description:
      'Side-by-side delay and cancellation statistics for two airports over a short observation window (default: the most recent 12 hours). This measures schedule disruption, not capacity, and a short window is not representative of long-term congestion. No winner is declared.',
    input: z.object({ airportA: airportCode, airportB: airportCode, ...windowFields }).superRefine(checkWindow),
    async execute({ airportA, airportB, from, to }) {
      const comparison = await analytics.compareCongestion(airportA, airportB, from !== undefined && to !== undefined ? { from, to } : undefined);
      return ok(congestionComparisonArtifact(comparison));
    },
  });

  const rankTerminalExpansion = defineTool({
    name: 'rank_terminal_expansion',
    description:
      'Deterministic Terminal Expansion Opportunity ranking of eligible commercial airports in a region, from BTS traffic and capacity signals (not ROI or profitability). Currently only New England is implemented. Scores are percentile-based and relative to the airports in the ranking.',
    input: z.object({
      region: z.enum(['new-england']).default('new-england').describe('Region to rank. Only "new-england" is available.'),
      compare: z
        .array(airportCode)
        .refine((codes) => codes.length === 0 || codes.length === 2, 'give exactly two airport codes, or omit')
        .nullish()
        .describe('Two airport codes to compare factor by factor, for questions such as "why is A ranked above B". Adds a precomputed comparison to the result.'),
    }),
    async execute({ compare }) {
      const ranking = await analytics.rankNewEnglandTerminalExpansion();
      return ok(rankingArtifact(ranking, compare && compare.length === 2 ? [compare[0] as string, compare[1] as string] : undefined));
    },
  });

  const estimateUnmetDemandPressure = defineTool({
    name: 'estimate_unmet_demand_pressure',
    description:
      'Unmet Demand Pressure Proxy (0-100) for one airport from BTS load factor and growth signals. It is an indicator of demand/capacity pressure, never a count of passengers who could not travel. Optionally adds recent delay/cancellation context, which does not change the score and uses limited AeroDataBox quota.',
    input: z.object({
      airport: airportCode,
      includeOperationalContext: z.boolean().default(false).describe('Also fetch recent delay and cancellation context. Only when the user asks about operations or delays.'),
    }),
    async execute({ airport, includeOperationalContext }) {
      const [identity, pressure] = await Promise.all([analytics.lookupAirport(airport), analytics.unmetDemandPressure(airport, includeOperationalContext ? 'recent' : undefined)]);
      return ok(demandPressureArtifact(identity, pressure));
    },
  });

  return [resolveAirports, getAirportProfile, getLongHaulShare, compareAirportCongestion, rankTerminalExpansion, estimateUnmetDemandPressure] as AgentTool[];
}
