import { branchOf, finite, unitName } from "@/app/lib/market-units";
import type { MarketAsset } from "@/app/lib/types";

// Per-session rows derived from each asset's daily sparkline candles
// (close = price at the day's close, close_mark = the settlement mark: where
// the settlement put that day's fair value). A mark gives the day's hidden
// target away, so the API withholds it until the day's last tick has landed;
// until then the session is "live" and told in prices only.

export type DayRow = {
  asset: MarketAsset;
  date: string;
  markBefore: number;
  markAfter: number;
  /** Settlement mark change (fraction). */
  fd: number;
  close: number | null;
  /** Closing price vs that session's mark (fraction). */
  prem: number | null;
  /** Price change over the session (fraction). */
  pchg: number | null;
  volume: number;
};

/** A talent in today's session while its ticks are still landing: prices only. */
export type LiveRow = {
  asset: MarketAsset;
  prevClose: number;
  price: number;
  /** Price since the previous session's close (fraction). */
  pchg: number;
  volume: number;
};

export type DayModel = {
  /** Finished session dates, oldest first (YYYY-MM-DD). */
  dates: string[];
  byDate: Map<string, DayRow[]>;
  bySymbol: Map<string, Map<string, DayRow>>;
  /**
   * The session still in progress. Its marks (each talent's new fair value) stay secret until its
   * last tick lands, so until then it's told in prices only; then it joins `dates` as a full report.
   */
  live: { date: string; rows: LiveRow[] } | null;
};

export function buildDays(assets: MarketAsset[], maxDays = 14): DayModel {
  const byDate = new Map<string, DayRow[]>();
  const bySymbol = new Map<string, Map<string, DayRow>>();
  const liveByDate = new Map<string, LiveRow[]>();
  for (const asset of assets) {
    const candles = [...asset.sparkline_candles].sort((a, b) => a.bucket.localeCompare(b.bucket));
    // The newest session without a mark is still in progress (the API withholds it until its last tick).
    const last = candles[candles.length - 1];
    const before = candles[candles.length - 2];
    if (last && before && !finite(last.close_mark) && finite(before.close) && before.close > 0) {
      const price = finite(asset.market_price) ? asset.market_price : finite(asset.current_mid_price) ? asset.current_mid_price : finite(last.close) ? last.close : null;
      if (price !== null) {
        const date = last.bucket.slice(0, 10);
        const row: LiveRow = { asset, prevClose: before.close, price, pchg: (price - before.close) / before.close, volume: last.volume_shares ?? 0 };
        liveByDate.set(date, [...(liveByDate.get(date) ?? []), row]);
      }
    }
    const rows = new Map<string, DayRow>();
    for (let i = 1; i < candles.length; i += 1) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const markBefore = prev.close_mark ?? null;
      const markAfter = cur.close_mark ?? null;
      if (!finite(markBefore) || !finite(markAfter) || markBefore <= 0) continue;
      const date = cur.bucket.slice(0, 10);
      const close = finite(cur.close) ? cur.close : null;
      const prevClose = finite(prev.close) ? prev.close : null;
      const row: DayRow = {
        asset,
        date,
        markBefore,
        markAfter,
        fd: (markAfter - markBefore) / markBefore,
        close,
        prem: close !== null && markAfter > 0 ? (close - markAfter) / markAfter : null,
        pchg: close !== null && prevClose ? (close - prevClose) / prevClose : null,
        volume: cur.volume_shares ?? 0,
      };
      rows.set(date, row);
      byDate.set(date, [...(byDate.get(date) ?? []), row]);
    }
    bySymbol.set(asset.symbol.toUpperCase(), rows);
  }
  const dates = [...byDate.keys()].sort().slice(-maxDays);
  const liveDate = [...liveByDate.keys()].sort().pop();
  const live = liveDate && (!dates.length || liveDate > dates[dates.length - 1]) ? { date: liveDate, rows: liveByDate.get(liveDate) ?? [] } : null;
  return { dates, byDate, bySymbol, live };
}

/**
 * Equal-weight settlement-mark index over the finished sessions, rebased to 100 at the first mark.
 * Marks only (no price stand-in for today's withheld one), so it lines up with `dates`.
 */
export function markIndex(assets: MarketAsset[]) {
  const series = assets
    .map((asset) => asset.sparkline_candles.map((candle) => candle.close_mark).filter((value): value is number => finite(value) && value > 0))
    .filter((values) => values.length > 1);
  const length = Math.min(...series.map((values) => values.length));
  if (!Number.isFinite(length) || length < 2) return [];
  return Array.from({ length }, (_, i) => (series.reduce((sum, values) => sum + values[values.length - length + i] / values[values.length - length], 0) / series.length) * 100);
}

export function dateLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    day: d.getUTCDate(),
    long: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    short: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase(),
  };
}

export { branchOf, unitName };
