// The market's daily rhythm, mirrored from the API:
// - api/src/services/marketAdjustments.js INTERVALS: four adjustment ticks a day
// - api/src/services/marketScheduler.js: settlement at 09:00 ET
// - api/src/services/trading.js computeNextLiveOrderTick: 10-minute order batches
// Prefer server timestamps (asset.next_adjustment.scheduled_at, status.next_scheduled_settlement_at)
// when you have them; these helpers are the fallback and drive countdowns.

export const MARKET_TIME_ZONE = "America/New_York";
export const ORDER_BATCH_MS = 10 * 60 * 1000;

export type TickKey = "open" | "lunch" | "late" | "overnight";

export const TICKS: ReadonlyArray<{ key: TickKey; label: string; hour: number }> = [
  { key: "open", label: "Open", hour: 9 },
  { key: "lunch", label: "Lunch", hour: 15 },
  { key: "late", label: "Late", hour: 21 },
  { key: "overnight", label: "Overnight", hour: 3 },
];

// Seconds after 09:00 ET at which each tick fires within one market day.
const TICK_OFFSETS = [0, 6, 12, 18].map((hours) => hours * 3600);
const DAY = 86_400;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function marketWallClock(now: number) {
  const parts = partsFormatter.formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

export type MarketClockState = {
  /** Wall-clock time in New York. */
  et: { hour: number; minute: number; second: number };
  /** Index into TICKS of the next tick to fire. */
  nextTickIndex: number;
  nextTick: (typeof TICKS)[number];
  secondsToNextTick: number;
  /** Ticks already fired in the current market day (0-4; 09:00 ET starts a new day). */
  ticksLanded: number;
  /** Fraction of the market day elapsed until the last tick (0-1). */
  dayProgress: number;
  nextBatchAt: Date;
  secondsToNextBatch: number;
};

export function getMarketClock(now: number): MarketClockState {
  const et = marketWallClock(now);
  const secondsOfDay = et.hour * 3600 + et.minute * 60 + et.second;
  const dayPosition = (secondsOfDay - 9 * 3600 + DAY) % DAY;

  let nextTickIndex = TICK_OFFSETS.findIndex((offset) => offset > dayPosition);
  if (nextTickIndex < 0) nextTickIndex = 0;
  const secondsToNextTick = nextTickIndex === 0 ? DAY - dayPosition : TICK_OFFSETS[nextTickIndex] - dayPosition;

  const nextBatchMs = (Math.floor(now / ORDER_BATCH_MS) + 1) * ORDER_BATCH_MS;

  return {
    et,
    nextTickIndex,
    nextTick: TICKS[nextTickIndex],
    secondsToNextTick,
    ticksLanded: nextTickIndex === 0 ? 4 : nextTickIndex,
    dayProgress: Math.min(dayPosition, TICK_OFFSETS[3]) / TICK_OFFSETS[3],
    nextBatchAt: new Date(nextBatchMs),
    secondsToNextBatch: Math.max(0, Math.ceil((nextBatchMs - now) / 1000)),
  };
}

export function formatCountdown(totalSeconds: number, { withHours = true } = {}) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return withHours ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatEtTime(date: Date, { seconds = false } = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
  }).format(date);
}
