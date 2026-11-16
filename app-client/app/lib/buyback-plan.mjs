// A buyback's numbers for the page: today's offer, every day's step down to the floor, the shares
// still over the max (only those get the offer), and when it ends. Mirrors
// api/src/services/marketSupply.js (buybackMultiplier, buybackFillPrice) and settlement.js (a buyback
// back under its max ends at the next Open). Plain JavaScript so `npm test` can run it without a
// build (buyback-plan.test.mjs).

export const DAY_MS = 86_400_000;
const TIME_ZONE = "America/New_York";
/** marketSupply.js defaults, for a payload that doesn't carry its schedule. */
const DEFAULT_START = 1.2;
const DEFAULT_STEP = 0.1;
const DEFAULT_FLOOR = 0.5;

/**
 * @typedef {{ started_at: string; frozen_price: number; multiplier: number; daily_step: number; floor: number; shares_over: number; start?: number | null }} Buyback
 * @typedef {{ day: number; pct: number; at: number; state: "past" | "now" | "later" }} BuybackStep
 */

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round4 = (value) => Math.round(value * 10_000) / 10_000;

/** Whole days since the buyback started (0 on its first day). */
export function dayOf(buyback, now) {
  const started = Date.parse(buyback.started_at);
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / DAY_MS)) : 0;
}

/** The schedule: where it starts, how much it drops a day, where it stops. */
export function scheduleOf(buyback) {
  const step = finite(buyback.daily_step) && buyback.daily_step >= 0 ? buyback.daily_step : DEFAULT_STEP;
  const floor = finite(buyback.floor) ? buyback.floor : DEFAULT_FLOOR;
  const start = finite(buyback.start) ? buyback.start : DEFAULT_START;
  return { start, step, floor };
}

/** The broker's offer on a given day, as a multiple of the frozen price. */
export function offerOn(buyback, day) {
  const { start, step, floor } = scheduleOf(buyback);
  return round4(Math.max(floor, start - step * Math.max(0, day)));
}

/**
 * Every day's offer from the start until `endsAt` (the weekly evaluation that forces what's left),
 * stopping at the floor. `state` marks today.
 * @returns {BuybackStep[]}
 */
export function stepsOf(buyback, now, endsAt) {
  const started = Date.parse(buyback.started_at);
  if (!Number.isFinite(started)) return [];
  const today = dayOf(buyback, now);
  const { floor } = scheduleOf(buyback);
  const steps = [];
  for (let day = 0; day < 60; day += 1) {
    const at = started + day * DAY_MS;
    if (day > 0 && finite(endsAt) && at >= endsAt) break;
    const pct = offerOn(buyback, day);
    steps.push({ day, pct, at, state: day < today ? "past" : day === today ? "now" : "later" });
    if (pct <= floor) break;
  }
  return steps;
}

/** The shares still over the max: only these get the offer; any sell past them gets the frozen price. */
export function sharesAtOffer({ circulating, max, fallback }) {
  if (finite(circulating) && finite(max) && max > 0) return Math.max(0, circulating - max);
  return Math.max(0, finite(fallback) ? fallback : 0);
}

function etParts(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    seconds: (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

/** The next 09:00 in New York (the Open, when a buyback back under its max ends). */
export function nextOpenAt(now) {
  const { seconds } = etParts(now);
  const wait = (9 * 3600 - seconds + 86_400) % 86_400 || 86_400;
  return Math.floor(now / 1000) * 1000 + wait * 1000;
}

/** The next Saturday 00:00 in New York (the weekly evaluation, which forces what's still over). */
export function nextEvaluationAt(now) {
  const { weekday, seconds } = etParts(now);
  const days = (6 - weekday + 7) % 7 || 7;
  return Math.floor(now / 1000) * 1000 + (days * 86_400 - seconds) * 1000;
}

/**
 * Everything the badge, the banner and the strips show.
 * @param {{ buyback: Buyback; circulating?: number | null; max?: number | null }} input
 * @param {number} now
 */
export function buybackPlan({ buyback, circulating = null, max = null }, now) {
  const { floor } = scheduleOf(buyback);
  const day = dayOf(buyback, now);
  const pct = offerOn(buyback, day);
  const frozen = finite(buyback.frozen_price) ? buyback.frozen_price : 0;
  const forcedAt = nextEvaluationAt(now);
  const steps = stepsOf(buyback, now, forcedAt);
  const started = Date.parse(buyback.started_at);
  const nextAt = Number.isFinite(started) ? started + (day + 1) * DAY_MS : null;
  const hasNext = nextAt !== null && pct > floor && nextAt < forcedAt;
  const over = sharesAtOffer({ circulating, max, fallback: buyback.shares_over });
  const backUnder = over <= 0;
  return {
    day,
    pct,
    offer: frozen * pct,
    frozen,
    steps,
    nextStepAt: hasNext ? nextAt : null,
    nextPct: hasNext ? offerOn(buyback, day + 1) : null,
    over,
    backUnder,
    /** "open": back under the max, trading reopens at the next Open. "forced": the evaluation takes the rest. */
    endKind: backUnder ? "open" : "forced",
    endsAt: backUnder ? nextOpenAt(now) : forcedAt,
    forcedAt,
  };
}
