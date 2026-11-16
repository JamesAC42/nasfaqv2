import type { MarketAsset } from "@/app/lib/types";

// Units (generations / branches) in debut order, and helpers to name and group them.

export const UNIT_ORDER = [
  "Generation 0", "1st Generation", "2nd Generation", "GAMERS", "3rd Generation", "4th Generation", "5th Generation",
  "holoX", "ReGLOSS", "FLOW GLOW", "ASOBI★MAWARI-TAI!", "Indonesia", "English -Myth-", "English -Council-", "English -Promise-",
  "English -Advent-", "English -Justice-",
];

export function unitName(unit: string | null | undefined) {
  return (unit || "").replace(/^hololive\s+/i, "").trim();
}

export function unitLabel(unit: string | null | undefined) {
  return unitName(unit)
    .replace(/^English -(.*)-$/, "EN $1")
    .replace("Generation 0", "Gen 0")
    .replace(" Generation", " Gen");
}

export function branchOf(unit: string | null | undefined): "EN" | "ID" | "JP" {
  const name = unitName(unit);
  if (/^English/i.test(name)) return "EN";
  if (/^Indonesia/i.test(name)) return "ID";
  return "JP";
}

/** Assets grouped by unit, in debut order (unknown units last). */
export function groupByUnit(assets: MarketAsset[]) {
  const byUnit = new Map<string, MarketAsset[]>();
  for (const asset of assets) {
    const unit = unitName(asset.unit) || "Other";
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), asset]);
  }
  const order = [...UNIT_ORDER, ...[...byUnit.keys()].filter((unit) => !UNIT_ORDER.includes(unit))];
  return order.filter((unit) => byUnit.has(unit)).map((unit) => ({ unit, assets: byUnit.get(unit) ?? [] }));
}

/** Each day's closing price over the sparkline window, oldest first (today's is the price so far). */
export function closeSeries(asset: MarketAsset) {
  return asset.sparkline_candles
    .map((candle) => candle.close)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
}

/**
 * The newest revealed target: the fair value (a day's settlement mark) of the latest day whose four
 * ticks have all landed, usually yesterday's. Today's stays hidden until its last tick, and the API
 * leaves it out until then.
 */
export function lastRevealedTarget(asset: MarketAsset) {
  const marks = asset.sparkline_candles
    .map((candle) => candle.close_mark)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return marks.at(-1) ?? null;
}

export function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}
