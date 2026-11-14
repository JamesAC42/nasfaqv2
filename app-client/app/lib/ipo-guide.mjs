// The IPO page's explanations: where an IPO is in its three steps, the viewer's local time for them,
// and the line under the order amount. Plain JavaScript so `npm test` can run it without a build
// (ipo-guide.test.mjs). The rules it describes are in api/src/services/ipo.js.

/**
 * @typedef {{ status: "announced" | "open" | "listed" | "cancelled"; window_opens_at: string; window_closes_at: string; listing_date: string }} IpoTimes
 * @typedef {"done" | "current" | "next"} StepState
 * @typedef {"upcoming" | "subscribe" | "allocating" | "trading" | "cancelled"} IpoPhase
 */

/**
 * A moment in the viewer's own time zone, with the zone named: "Thu, Nov 19, 9:00 AM EST".
 * `timeZone` is for tests; the page leaves it out so the browser's zone is used.
 * @param {string | number | Date} value
 * @param {{ timeZone?: string }} [options]
 */
export function localMoment(value, { timeZone } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) });
}

/**
 * Where an IPO is: before its window, subscribing, closed and waiting for the shares to be handed
 * out, or listed and trading. Read from the clock as well as the status, so the window closes on
 * time even if the shared (cached) body still says it's open.
 * @param {IpoTimes} event
 * @param {number} now
 * @returns {IpoPhase}
 */
export function ipoPhase(event, now) {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "listed") return "trading";
  if (event.status === "open") return now < Date.parse(event.window_closes_at) ? "subscribe" : "allocating";
  return "upcoming";
}

/**
 * The three steps (subscribe, window closes and shares are handed out, listing and trading), each
 * done, current or next. Before the window opens nothing is current yet; a called-off IPO has none.
 * @param {IpoTimes} event
 * @param {number} now
 * @returns {{ phase: IpoPhase; steps: Array<{ key: "subscribe" | "allocate" | "trade"; state: StepState }> }}
 */
export function ipoSteps(event, now) {
  const phase = ipoPhase(event, now);
  const at = { upcoming: -1, subscribe: 0, allocating: 1, trading: 2, cancelled: -1 }[phase];
  /** @type {Array<"subscribe" | "allocate" | "trade">} */
  const keys = ["subscribe", "allocate", "trade"];
  return {
    phase,
    steps: keys.map((key, index) => ({ key, state: index < at ? "done" : index === at ? "current" : "next" })),
  };
}

/** "$1,234.50" (the site's money format). @param {number} value */
export function dollars(value) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 1234 → "1,234". @param {number} value */
const count = (value) => Math.round(value).toLocaleString("en-US");

/**
 * "80", or "80–84" when talents differ. Empty when none is known yet.
 * @param {Array<number | null | undefined>} values
 */
export function rangeText(values) {
  const known = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!known.length) return "";
  const low = Math.min(...known);
  const high = Math.max(...known);
  return low === high ? count(low) : `${count(low)}–${count(high)}`;
}

/**
 * The line under the order amount: what the request holds from Cash (or gives back, when changing
 * an existing one), and how the per-player limit applies.
 * @param {{ qty: number; price: number; held?: number; cash?: number | null; cap?: number | null; capPct: number; offered?: number | null }} input
 *   `held` is what the viewer's current subscription already holds; `cash` their spendable Cash.
 * @returns {{ hold: string; cap: string }}
 */
export function holdSummary({ qty, price, held = 0, cash = null, cap = null, capPct, offered = null }) {
  const cost = Math.round(qty * price * 100) / 100;
  const delta = Math.round((cost - held) * 100) / 100;
  let hold = "";
  if (qty >= 1 && price > 0) {
    if (!held) hold = `Holds ${dollars(cost)}${cash !== null && cash !== undefined ? ` of your ${dollars(cash)}` : ""} Cash now.`;
    else if (delta > 0) hold = `Holds ${dollars(delta)} more Cash now, ${dollars(cost)} in all.`;
    else if (delta < 0) hold = `Gives ${dollars(-delta)} back to your Cash now, ${dollars(cost)} held.`;
    else hold = `${dollars(cost)} of your Cash is held for these.`;
  }
  let capText = "";
  if (cap && offered) capText = `Limit ${count(cap)} per player: ${capPct}% of the ${count(offered)} offered.`;
  else if (cap) capText = `Limit ${count(cap)} per player.`;
  return { hold, cap: capText };
}
