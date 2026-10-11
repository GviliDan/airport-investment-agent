/**
 * Mid-rank percentile of each value within its own list, on a 0-100 scale.
 *
 *   n = 1:  50 (a single value has no position relative to others)
 *   n > 1:  100 * (below + (equal - 1) / 2) / (n - 1)
 *
 * where `below` counts values strictly lower and `equal` counts values equal to this one (itself included).
 * Properties: a unique minimum is 0 and a unique maximum is 100; tied values share one score (the mean of
 * the ranks they span); when every value is equal every score is 50; the score depends on order only, so
 * outliers and negative values need no special handling.
 */
export function percentileScores(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  return values.map((value) => {
    let below = 0;
    let equal = 0;
    for (const other of values) {
      if (other < value) below += 1;
      else if (other === value) equal += 1;
    }
    return (100 * (below + (equal - 1) / 2)) / (n - 1);
  });
}
