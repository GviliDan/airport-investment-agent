import { describe, expect, it } from 'vitest';
import { recentLocalWindow, timeZoneForState } from './timezone';

describe('recentLocalWindow', () => {
  const now = new Date('2026-10-07T20:00:00Z');

  it('formats the trailing hours in the airport\'s local time, daylight saving included', () => {
    expect(recentLocalWindow('CA', now, 12)).toEqual({ from: '2026-10-07T01:00', to: '2026-10-07T13:00' });
    expect(recentLocalWindow('NY', now, 12)).toEqual({ from: '2026-10-07T04:00', to: '2026-10-07T16:00' });
    expect(recentLocalWindow('AK', now, 6)).toEqual({ from: '2026-10-07T06:00', to: '2026-10-07T12:00' });
  });

  it('crosses midnight correctly and uses a fixed offset where the state has no daylight saving', () => {
    expect(recentLocalWindow('AZ', new Date('2026-01-15T03:00:00Z'), 12)).toEqual({ from: '2026-01-14T08:00', to: '2026-01-14T20:00' });
    expect(recentLocalWindow('HI', new Date('2026-07-01T05:00:00Z'), 12)).toEqual({ from: '2026-06-30T07:00', to: '2026-06-30T19:00' });
  });

  it('is undefined for an unknown state', () => {
    expect(timeZoneForState('ZZ')).toBeUndefined();
    expect(recentLocalWindow('ZZ', now, 12)).toBeUndefined();
  });
});
