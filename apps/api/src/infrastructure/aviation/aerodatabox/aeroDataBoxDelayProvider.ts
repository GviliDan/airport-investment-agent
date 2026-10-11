import { z } from 'zod';
import { ProviderError } from '../../../application/errors';
import type { AirportDelayProvider, DelayWindowQuery } from '../../../application/ports';
import { AirportCodeSchema } from '../../../domain/codes';
import { AirportDelaySnapshotSchema, type AirportDelaySnapshot } from '../../../domain/delays';
import type { Sourced } from '../../../domain/provenance';
import { parseResponse } from '../http';
import type { AeroDataBoxGet } from './client';

const DATASET = 'AeroDataBox airport delays (historical period)';
/** One request may cover at most this long; longer windows must be split by the caller. */
const MAX_WINDOW_HOURS = 12;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const Count = z.number().int().nonnegative();
/** "[-]hh:mm:ss" */
const SignedDuration = z.string().regex(/^-?\d+:[0-5]\d:[0-5]\d$/, 'expected [-]hh:mm:ss');
/** "2026-10-06 13:00Z" */
const UtcStamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z$/, 'expected "YYYY-MM-DD HH:mmZ"');

const DelayInformationDto = z.object({
  numTotal: Count,
  numQualifiedTotal: Count,
  numCancelled: Count,
  medianDelay: SignedDuration.optional(),
  delayIndex: z.number().optional(),
});

/** AeroDataBox `AirportDelayContract`: a snapshot every 15 minutes, each covering a trailing 2-hour window. */
const DelaysDto = z.array(
  z.object({
    from: z.object({ utc: UtcStamp }),
    to: z.object({ utc: UtcStamp }),
    departuresDelayInformation: DelayInformationDto,
    arrivalsDelayInformation: DelayInformationDto,
  }),
);

const toIso = (utc: string): string => `${utc.replace(' ', 'T').replace('Z', '')}:00Z`;

function toMinutes(duration: string | undefined): number | undefined {
  if (duration === undefined) return undefined;
  const negative = duration.startsWith('-');
  const [hours = 0, minutes = 0, seconds = 0] = duration.replace('-', '').split(':').map(Number);
  const total = (hours * 3600 + minutes * 60 + seconds) / 60;
  return negative ? -total : total;
}

type DelayInformation = z.infer<typeof DelayInformationDto>;

const summarize = (info: DelayInformation) => ({
  flights: info.numTotal,
  qualifiedFlights: info.numQualifiedTotal,
  cancelled: info.numCancelled,
  medianDelayMinutes: toMinutes(info.medianDelay),
  delayIndex: info.delayIndex,
});

function mapDelaySnapshots(payload: unknown): AirportDelaySnapshot[] {
  return parseResponse('aerodatabox', DelaysDto, payload, 'delays response').map((snapshot) => {
    const mapped = AirportDelaySnapshotSchema.safeParse({
      windowStart: toIso(snapshot.from.utc),
      windowEnd: toIso(snapshot.to.utc),
      departures: summarize(snapshot.departuresDelayInformation),
      arrivals: summarize(snapshot.arrivalsDelayInformation),
    });
    if (!mapped.success) {
      const issues = mapped.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ProviderError('aerodatabox', 'invalid-response', `delay snapshot ending ${snapshot.to.utc}: ${issues}`);
    }
    return mapped.data;
  });
}

/** Rejects windows the API would refuse; the API still charges quota for rejected requests, so check first. */
function assertValidWindow({ from, to }: Pick<DelayWindowQuery, 'from' | 'to'>): void {
  if (!LOCAL_DATE_TIME.test(from) || !LOCAL_DATE_TIME.test(to)) {
    throw new ProviderError('aerodatabox', 'invalid-request', 'window times must be formatted YYYY-MM-DDTHH:mm');
  }
  const hours = (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 3_600_000;
  if (!(hours > 0 && hours <= MAX_WINDOW_HOURS)) {
    throw new ProviderError('aerodatabox', 'invalid-request', `window must be positive and at most ${MAX_WINDOW_HOURS} hours`);
  }
}

/** AirportDelayProvider backed by AeroDataBox. Each call covers one window of at most 12 hours and costs quota. */
export class AeroDataBoxDelayProvider implements AirportDelayProvider {
  constructor(
    private readonly get: AeroDataBoxGet,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async delaySnapshots(query: DelayWindowQuery): Promise<Sourced<readonly AirportDelaySnapshot[]>> {
    assertValidWindow(query);
    const airport = AirportCodeSchema.parse(query.airport);
    const snapshots = mapDelaySnapshots(await this.get(`/airports/iata/${airport}/delays/${query.from}/${query.to}`));
    return { data: snapshots, provenance: { source: 'aerodatabox', dataset: DATASET, retrievedAt: this.now().toISOString() } };
  }
}
