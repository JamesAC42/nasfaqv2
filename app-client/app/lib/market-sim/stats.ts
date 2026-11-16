// Small statistics helpers for the simulator.

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

export function quantile(values: number[], q: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export const median = (values: number[]) => quantile(values, 0.5);

export function share(values: number[], test: (value: number) => boolean) {
  return values.length ? values.filter(test).length / values.length : NaN;
}

export function stdev(values: number[]) {
  if (values.length < 2) return NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

/** Pearson correlation of two equal-length series. */
export function correlation(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Daily log changes of a series with gaps, and each one paired with the change the day before. */
export function dailyChanges(series: (number | null)[]) {
  const changes: number[] = [];
  const pairs: [number, number][] = [];
  let previous: number | null = null;
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    const change = a !== null && b !== null && a > 0 && b > 0 ? Math.log(b / a) : null;
    if (change !== null) {
      changes.push(change);
      if (previous !== null) pairs.push([previous, change]);
    }
    previous = change;
  }
  return { changes, pairs };
}

/** Counts per bin for values clamped into [from, to]; returns the bins' lower edges too. */
export function histogram(values: number[], { from, to, bins }: { from: number; to: number; bins: number }) {
  const width = (to - from) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - from) / width)));
    counts[index] += 1;
  }
  return { counts, edges: counts.map((_, index) => from + index * width), width };
}
