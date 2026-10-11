/**
 * Approximate local time at an airport from its US state or territory. A few states span two zones (for
 * example the Florida panhandle or western Texas); the state's main zone is used, so an airport in the
 * minority zone is off by an hour. Callers report the window they used, so this only affects which hours
 * "recent" means, never a metric.
 */
const STATE_TIME_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver', PR: 'America/Puerto_Rico', VI: 'America/Puerto_Rico', GU: 'Pacific/Guam', MP: 'Pacific/Guam', AS: 'Pacific/Pago_Pago',
};

export function timeZoneForState(state: string): string | undefined {
  return STATE_TIME_ZONES[state];
}

/** `YYYY-MM-DDTHH:mm` in the given zone. */
function formatLocal(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** The `hours` hours ending at `now`, as local date-times at an airport in `state`; undefined for an unknown state. */
export function recentLocalWindow(state: string, now: Date, hours: number): { from: string; to: string } | undefined {
  const timeZone = timeZoneForState(state);
  if (!timeZone) return undefined;
  return { from: formatLocal(new Date(now.getTime() - hours * 3_600_000), timeZone), to: formatLocal(now, timeZone) };
}
