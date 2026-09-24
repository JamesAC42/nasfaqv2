import { branchOf, fairSeries, finite, unitName } from "@/app/lib/market-units";
import type { MarketAsset } from "@/app/lib/types";

// Per-session rows derived from each asset's daily sparkline candles
// (close = price at the day's close, close_mark = fair value that day).

export type DayRow = {
  asset: MarketAsset;
  date: string;
  fairBefore: number;
  fairAfter: number;
  /** Fair value change at settlement (fraction). */
  fd: number;
  close: number | null;
  /** Price vs fair value at the close (fraction). */
  prem: number | null;
  /** Price change over the session (fraction). */
  pchg: number | null;
  volume: number;
};

export type DayModel = {
  /** Session dates, oldest first (YYYY-MM-DD). */
  dates: string[];
  byDate: Map<string, DayRow[]>;
  bySymbol: Map<string, Map<string, DayRow>>;
};

export function buildDays(assets: MarketAsset[], maxDays = 14): DayModel {
  const byDate = new Map<string, DayRow[]>();
  const bySymbol = new Map<string, Map<string, DayRow>>();
  for (const asset of assets) {
    const candles = [...asset.sparkline_candles].sort((a, b) => a.bucket.localeCompare(b.bucket));
    const rows = new Map<string, DayRow>();
    for (let i = 1; i < candles.length; i += 1) {
      const prev = candles[i - 1];
      const cur = candles[i];
      const fairBefore = prev.close_mark ?? null;
      const fairAfter = cur.close_mark ?? null;
      if (!finite(fairBefore) || !finite(fairAfter) || fairBefore <= 0) continue;
      const date = cur.bucket.slice(0, 10);
      const close = finite(cur.close) ? cur.close : null;
      const prevClose = finite(prev.close) ? prev.close : null;
      const row: DayRow = {
        asset,
        date,
        fairBefore,
        fairAfter,
        fd: (fairAfter - fairBefore) / fairBefore,
        close,
        prem: close !== null && fairAfter > 0 ? (close - fairAfter) / fairAfter : null,
        pchg: close !== null && prevClose ? (close - prevClose) / prevClose : null,
        volume: cur.volume_shares ?? 0,
      };
      rows.set(date, row);
      byDate.set(date, [...(byDate.get(date) ?? []), row]);
    }
    bySymbol.set(asset.symbol.toUpperCase(), rows);
  }
  const dates = [...byDate.keys()].sort().slice(-maxDays);
  return { dates, byDate, bySymbol };
}

/** Equal-weight fair value index over the window, rebased to 100 at the first mark. */
export function fairIndex(assets: MarketAsset[]) {
  const series = assets.map(fairSeries).filter((values) => values.length > 1);
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
