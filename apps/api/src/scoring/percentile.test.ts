import { describe, expect, it } from 'vitest';
import { percentileScores } from './percentile';

describe('percentileScores', () => {
  it('gives the unique lowest 0 and the unique highest 100, in input order', () => {
    expect(percentileScores([30, 10, 20])).toEqual([100, 0, 50]);
    expect(percentileScores([1, 2, 3, 4, 5])).toEqual([0, 25, 50, 75, 100]);
  });

  it('handles negative values and outliers by rank only', () => {
    expect(percentileScores([-0.2, 0.01, 1_000_000])).toEqual([0, 50, 100]);
  });

  it('gives tied values the same mid-rank score', () => {
    // ranks 1, 2.5, 2.5, 4 -> (rank - 1) / 3
    const scores = percentileScores([5, 7, 7, 9]);
    expect(scores[0]).toBe(0);
    expect(scores[1]).toBe(scores[2]);
    expect(scores[1]).toBeCloseTo(50, 12);
    expect(scores[3]).toBe(100);
  });

  it('lets a tied minimum sit near, not at, zero', () => {
    const [a, b, c] = percentileScores([1, 1, 2]);
    expect(a).toBe(b);
    expect(a).toBeCloseTo(25, 12);
    expect(c).toBe(100);
  });

  it('returns 50 for a single value and for identical values', () => {
    expect(percentileScores([42])).toEqual([50]);
    expect(percentileScores([3, 3, 3])).toEqual([50, 50, 50]);
  });

  it('returns nothing for nothing and is independent of input order', () => {
    expect(percentileScores([])).toEqual([]);
    const values = [4, 8, 8, 1, 6];
    const forward = percentileScores(values);
    const reversed = percentileScores([...values].reverse()).reverse();
    expect(reversed).toEqual(forward);
  });
});
