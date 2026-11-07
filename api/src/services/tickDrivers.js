// Why a stock moved at a tick: the short line each stock gets after each of the four daily ticks
// ("Subscribers up 0.6% this week", "3D live yesterday (18k peak)", "Eased after player buying
// since the Open tick").
//
// A tick moves a price part of the way to its hidden fair value (marketAdjustments.applyInterval).
// The distance it closes was built by things players can see: the channel numbers that repriced
// the fair value at settlement (subscribers, views, uploads, a flat month, big streams) and player
// trading. Each tick records how that distance splits between them, carries the split forward
// (scaled down by the tick) for the next one, and names the biggest part that pushed the way the
// price went. Recorded when the tick runs, never recomputed later.
//
// Secrecy (marketSecrecy.js). The split is in log-price units, so with the price it gives the fair
// value away: it lives in driver_state_json, which no public query selects. Players get
// reasons_json: what kind of driver it was and a line built only from public numbers (subscriber,
// view and upload counts, labeled streams and their peaks, net shares traded). Never the fair value,
// the gap to it, a strength, or wording about what comes next: no "still catching up", no "pulled
// toward its value". A tick moves the same way as the one before about 82% of the time, so the line
// explains the tick that happened and never a trend. test/tick-drivers.test.js holds it to that.

const DAY_MS = 86_400_000;
const EPS = 1e-9;

// The fair value formula's weights (fundamentals.computeDerivedSnapshot). The test checks these
// still add up to that function's raw fair value, so a formula change can't silently drift.
const SUB_EXPONENT = 0.42;
const MOMENTUM_SCALE = 0.35;
const VIEW_WEIGHT = 0.58;
const SUB_WEIGHT = 0.3;
const UPLOAD_WEIGHT = 0.12;
const SMOOTHING_RAW_WEIGHT = 0.6;
const SMOOTHING_PREVIOUS_WEIGHT = 0.4;
const SMOOTHING_LAGS = 6;

// Trade price impact, read the way trading.js reads it.
const TRANSIENT_HALF_LIFE_MINUTES = Math.max(Number(process.env.MARKET_TRANSIENT_HALF_LIFE_MINUTES || 60), 1);
const TRANSIENT_IMPACT_WEIGHT = Number(process.env.MARKET_TRANSIENT_IMPACT_WEIGHT || 0.7);
const PERSISTENT_IMPACT_WEIGHT = Number(process.env.MARKET_PERSISTENT_IMPACT_WEIGHT || 0.15);

/** Moves smaller than this get no line. */
const MIN_MOVE = 0.0005;
/** A driver is named only if it is at least this share of everything that pushed the price that way. */
const PRIMARY_SHARE = 0.2;
const SECOND_SHARE = 0.25;
const MAX_REASONS = 2;
/** How far back to read fills when the last tick was long ago (a halted stock coming back). */
const MAX_FILL_LOOKBACK_MS = 3 * DAY_MS;

const CHANNEL_KEYS = ["subs", "views", "uploads", "quiet", "stream"];
/** Parts a reason can name. `other` (the unexplained rest, overshoots included) never is. */
const NAMED_KEYS = [...CHANNEL_KEYS, "players", "players_earlier"];

const STREAM_KINDS = {
  three_d: { phrase: "3D live", short: "3D live" },
  new_outfit: { phrase: "new outfit reveal", short: "New outfit" },
  original_song: { phrase: "original song release", short: "New song" },
  anniversary: { phrase: "anniversary stream", short: "Anniversary" },
  birthday: { phrase: "birthday stream", short: "Birthday" },
  milestone: { phrase: "milestone stream", short: "Milestone" },
  cover_song: { phrase: "song cover", short: "Cover" },
};

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value) {
  if (!value) return null;
  const match = String(value instanceof Date ? value.toISOString() : value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function shiftDay(key, days) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
function zonedDay(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** 0.0061 → "0.6%", 0.00052 → "0.05%", 0.24 → "24%". */
function pctText(fraction) {
  const value = Math.abs(fraction) * 100;
  const digits = value < 0.1 ? 2 : value < 10 ? 1 : 0;
  return `${String(Number(value.toFixed(digits)))}%`;
}

/** 18_234 → "18k", 1_234 → "1.2k", 950 → "950". */
function compactCount(value) {
  const n = Math.max(0, Math.round(value));
  if (n >= 1_000_000) return `${String(Number((n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)))}M`;
  if (n >= 1_000) return `${String(Number((n / 1_000).toFixed(n >= 10_000 ? 0 : 1)))}k`;
  return String(n);
}

// ── Channel drivers ──────────────────────────────────────────────────────

/**
 * One day's log raw fair value split into what feeds it: ln(size) + 0.35 × momentum, with size =
 * subs^0.42 × views^0.08 and momentum = 0.58 views + 0.3 subs + 0.12 uploads + a flat-month penalty +
 * big streams. The flat-month part also takes momentum's clamp, if it bit.
 */
function snapshotParts(snapshot) {
  if (!snapshot) return null;
  const size = num(snapshot.size_anchor_raw);
  const subs = num(snapshot.subscriber_count);
  const momentum = num(snapshot.momentum_raw);
  if (!(size > 0) || subs === null || momentum === null) return null;
  const viewSignal = num(snapshot.view_signal) ?? 0;
  const subSignal = num(snapshot.sub_signal) ?? 0;
  const uploadSignal = num(snapshot.upload_signal) ?? 0;
  const eventSignal = num(snapshot.event_signal) ?? 0;
  const subsSize = SUB_EXPONENT * Math.log(Math.max(subs, 1));
  const flat = momentum - (VIEW_WEIGHT * viewSignal + SUB_WEIGHT * subSignal + UPLOAD_WEIGHT * uploadSignal + eventSignal);
  return {
    subs: subsSize + MOMENTUM_SCALE * SUB_WEIGHT * subSignal,
    views: Math.log(size) - subsSize + MOMENTUM_SCALE * VIEW_WEIGHT * viewSignal,
    uploads: MOMENTUM_SCALE * UPLOAD_WEIGHT * uploadSignal,
    quiet: MOMENTUM_SCALE * flat,
    stream: MOMENTUM_SCALE * eventSignal,
  };
}

/**
 * Splits a fair value change, `total` = ln(FV on `to` / FV on `from`), between the channel drivers.
 * The fair value is smoothed (0.4 × yesterday's + 0.6 × today's raw), so a day's change is
 * 0.6 × Σ 0.4^j × (raw change j days earlier): a big stream lifts it most the next day and fades.
 * What the split can't place (the daily move cap, missing days) goes to `other`.
 */
function splitFairValueChange({ byDate, from, to, total }) {
  const estimate = {};
  let estimated = 0;
  if (from && to && from < to && byDate) {
    for (let day = shiftDay(from, 1); day <= to; day = shiftDay(day, 1)) {
      for (let lag = 0; lag <= SMOOTHING_LAGS; lag += 1) {
        const current = snapshotParts(byDate.get(shiftDay(day, -lag)));
        const before = snapshotParts(byDate.get(shiftDay(day, -lag - 1)));
        if (!current || !before) continue;
        const weight = SMOOTHING_RAW_WEIGHT * SMOOTHING_PREVIOUS_WEIGHT ** lag;
        for (const key of CHANNEL_KEYS) {
          const delta = weight * (current[key] - before[key]);
          estimate[key] = (estimate[key] ?? 0) + delta;
          estimated += delta;
        }
      }
    }
  }
  let scale = 1;
  if (Math.abs(estimated) > EPS && Math.sign(estimated) === Math.sign(total)) {
    const ratio = total / estimated;
    if (ratio >= 0.5 && ratio <= 2) scale = ratio;
  }
  const parts = {};
  let placed = 0;
  for (const key of CHANNEL_KEYS) {
    if (!estimate[key]) continue;
    parts[key] = estimate[key] * scale;
    placed += parts[key];
  }
  if (Math.abs(total - placed) > EPS) parts.other = total - placed;
  return parts;
}

/** The public channel numbers the lines quote, as of `to`: all from subscriber, view and video counts. */
function channelMetrics(byDate, to) {
  const current = byDate?.get(to);
  if (!current) return {};
  const weekAgo = byDate.get(shiftDay(to, -7));
  const monthBefore = byDate.get(shiftDay(to, -35));
  const subs = num(current.subscriber_count);
  const subsWeekAgo = num(weekAgo?.subscriber_count);
  const views = num(current.view_count);
  const viewsWeekAgo = num(weekAgo?.view_count);
  const viewsMonthBefore = num(monthBefore?.view_count);

  const out = {};
  if (subs !== null && subsWeekAgo > 0) out.subs_week = (subs - subsWeekAgo) / subsWeekAgo;
  if (views !== null && viewsWeekAgo !== null && viewsMonthBefore !== null && viewsWeekAgo - viewsMonthBefore > 0) {
    // This week's daily views against the daily pace of the four weeks before it.
    out.views_pace = (views - viewsWeekAgo) / 7 / ((viewsWeekAgo - viewsMonthBefore) / 28) - 1;
  }

  // Upload run (days in a row with a new video) or quiet spell (days in a row without one).
  const videos = (day) => num(byDate.get(day)?.video_count);
  let streak = 0;
  let idle = 0;
  for (let day = to; streak + idle < 14; day = shiftDay(day, -1)) {
    const today = videos(day);
    const before = videos(shiftDay(day, -1));
    if (today === null || before === null) break;
    const delta = today - before;
    if (delta > 0 && idle === 0) streak += 1;
    else if (delta === 0 && streak === 0) idle += 1;
    else break;
  }
  out.upload_streak = streak;
  out.upload_idle_days = idle;
  const videosNow = videos(to);
  const videosWeekAgo = videos(shiftDay(to, -7));
  if (videosNow !== null && videosWeekAgo !== null) out.uploads_week = Math.max(0, videosNow - videosWeekAgo);

  // The latest labeled big stream in the past week (the fair value's event lift).
  for (let day = to; day >= shiftDay(to, -7); day = shiftDay(day, -1)) {
    const row = byDate.get(day);
    const kinds = Array.isArray(row?.event_kinds) ? row.event_kinds.filter((kind) => STREAM_KINDS[kind]) : [];
    if (kinds.length && (num(row.event_signal) ?? 0) > 0) {
      out.stream = { date: day, kind: kinds[0] };
      break;
    }
  }
  return out;
}

// ── Player trading ───────────────────────────────────────────────────────

/**
 * What players' fills since the last tick did to the price, in log terms, the way trading.js applies
 * them: each fill shifts the price by (persistent + transient weight) × quantity / depth, and the
 * transient part fades with a 60-minute half-life, applied at each later trade. Returned as a push on
 * the distance a tick closes (buying lifts the price, so it pushes the tick down: negative).
 */
function playerPush(fills, liquidityDepth) {
  const depth = Math.max(num(liquidityDepth) ?? 0, 1);
  const list = (fills ?? []).filter((fill) => Number.isFinite(Date.parse(fill.ts)));
  if (!list.length) return { push: 0, net_shares: 0 };
  const last = Math.max(...list.map((fill) => Date.parse(fill.ts)));
  let price = 0;
  let net = 0;
  for (const fill of list) {
    const sign = fill.side === "buy" ? 1 : -1;
    const quantity = Math.max(num(fill.quantity) ?? 0, 0);
    const shock = quantity / depth;
    const fade = 0.5 ** ((last - Date.parse(fill.ts)) / 60_000 / TRANSIENT_HALF_LIFE_MINUTES);
    price += sign * shock * (PERSISTENT_IMPACT_WEIGHT + TRANSIENT_IMPACT_WEIGHT * fade);
    net += sign * quantity;
  }
  return { push: -price, net_shares: Math.round(net * 1e6) / 1e6 };
}

// ── Lines ────────────────────────────────────────────────────────────────

/** "yesterday" / "on Monday" / "on Nov 2", and the possessive form, for a day seen from the tick's day. */
function dayWords(day, tickDay) {
  const gap = day && tickDay ? daysBetween(day, tickDay) : null;
  if (gap === 0) return { adverb: "today", possessive: "today's" };
  if (gap === 1) return { adverb: "yesterday", possessive: "yesterday's" };
  const date = new Date(`${day}T12:00:00Z`);
  if (gap !== null && gap > 1 && gap < 7) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    return { adverb: `on ${weekday}`, possessive: `${weekday}'s` };
  }
  const short = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { adverb: `on ${short}`, possessive: `the ${short}` };
}

/**
 * The line for one driver pushing the way the price went (`up`), from public numbers only. Null when
 * those numbers don't back the claim, so a line never says something the counts contradict.
 */
function describe(key, up, meta, context) {
  const m = meta ?? {};
  switch (key) {
    case "subs": {
      const week = num(m.subs_week);
      if (week === null) return up ? { text: "Subscriber growth picked up", short: "Subs up" } : { text: "Subscriber growth slowed", short: "Subs slowed" };
      if (up) {
        if (week >= 0.0005) return { text: `Subscribers up ${pctText(week)} this week`, short: `Subs +${pctText(week)}` };
        if (week > 0) return { text: "Subscriber growth picked up this week", short: "Subs up" };
        return { text: "Fewer subscribers lost this week", short: "Subs steadier" };
      }
      if (week <= -0.0005) return { text: `Subscribers down ${pctText(week)} this week`, short: `Subs −${pctText(week)}` };
      if (week < 0) return { text: "Subscribers slipped this week", short: "Subs slipped" };
      return { text: "Subscriber growth slowed this week", short: "Subs slowed" };
    }
    case "views": {
      const pace = num(m.views_pace);
      if (up) {
        if (pace !== null && pace >= 0.05) return { text: `Views up ${pctText(pace)} this week vs. the month before`, short: `Views +${pctText(pace)}` };
        if (pace === null || pace > -0.05) return { text: "Views picked up this week", short: "Views up" };
        return null;
      }
      if (pace !== null && pace <= -0.05) return { text: `Views down ${pctText(pace)} this week vs. the month before`, short: `Views −${pctText(pace)}` };
      if (pace !== null && pace >= 0.05) return { text: "View growth cooled this week", short: "Views cooled" };
      return { text: "Views slowed this week", short: "Views slowed" };
    }
    case "uploads": {
      const streak = num(m.upload_streak) ?? 0;
      const idle = num(m.upload_idle_days) ?? 0;
      const week = num(m.uploads_week);
      if (up) {
        if (streak >= 2) return { text: `New uploads ${streak} days in a row`, short: `${streak}-day upload run` };
        if (week !== null && week >= 1) return { text: `${week} new upload${week === 1 ? "" : "s"} this week`, short: `${week} upload${week === 1 ? "" : "s"}` };
        return null;
      }
      if (idle >= 2) return { text: `No new uploads in ${idle} days`, short: `No uploads ${idle}d` };
      if (idle === 1) return { text: "Upload run ended", short: "Upload run ended" };
      return null;
    }
    case "quiet":
      return up ? { text: "Channel growth picked back up", short: "Growth back" } : { text: "Subscribers and views flat this month", short: "Flat month" };
    case "stream": {
      const kind = STREAM_KINDS[m.stream?.kind];
      if (!kind) return up ? { text: "Big stream this week", short: "Big stream" } : null;
      const words = dayWords(m.stream.date, context.tickDay);
      if (up) {
        const peak = num(m.stream.peak);
        return { text: `${capitalize(kind.phrase)} ${words.adverb}${peak ? ` (${compactCount(peak)} peak)` : ""}`, short: kind.short };
      }
      return { text: `Boost from ${words.possessive} ${kind.phrase} faded`, short: `${kind.short} faded` };
    }
    case "players": {
      const net = num(m.net_shares) ?? 0;
      const since = m.since ? ` since the ${m.since} tick` : " earlier";
      const detail = (verb) => `${Math.abs(net).toLocaleString("en-US", { maximumFractionDigits: 2 })} shares net ${verb}${m.since ? ` since the ${m.since} tick` : ""}`;
      if (!up && net > 0) return { text: `Eased after player buying${since}`, short: "Player buying", detail: detail("bought") };
      if (up && net < 0) return { text: `Bounced after player selling${since}`, short: "Player selling", detail: detail("sold") };
      return null;
    }
    case "players_earlier":
      return up ? { text: "Bounced after earlier player selling", short: "Player selling" } : { text: "Eased after earlier player buying", short: "Player buying" };
    default:
      return null;
  }
}

// ── The tick ─────────────────────────────────────────────────────────────

function addInto(target, parts, factor = 1) {
  for (const [key, value] of Object.entries(parts ?? {})) {
    const v = num(value);
    if (v === null || v === 0) continue;
    target[key] = (target[key] ?? 0) + v * factor;
  }
  return target;
}

function sumParts(parts) {
  return Object.values(parts).reduce((sum, value) => sum + value, 0);
}

/**
 * Explains one tick and returns the split to carry into the next.
 *
 * - priceBefore, priceAfter, fairValue: this tick (fairValue is its base rate). Private inputs; the
 *   reasons never quote them.
 * - previous: the stock's last applied tick ({ fairValue, priceAfter, state }) or null.
 * - channel: { parts, meta } when the fair value changed since then (a settlement): parts from
 *   splitFairValueChange, meta from channelMetrics.
 * - players: { push, net_shares, since } from playerPush, for fills since the previous tick.
 * - tickDay: the tick's calendar day in market time (for "yesterday").
 *
 * Returns { reasons: [{ kind, text, short, detail? }], state }. The state is private (see the top).
 */
function explainTick({ priceBefore, priceAfter, fairValue, previous = null, channel = null, players = null, tickDay = null }) {
  const before = num(priceBefore);
  const after = num(priceAfter);
  const fair = num(fairValue);
  if (!(before > 0) || !(after > 0) || !(fair > 0)) return { reasons: [], state: null };

  const gapBefore = Math.log(fair / before);
  const gapAfter = Math.log(fair / after);
  const meta = {};
  const parts = {};

  // 1. What this tick's distance was made of: what's left of the last split, the fair value's change
  //    since (channel drivers) and the trading since (players). Whatever none of them covers is `other`.
  const prevFair = num(previous?.fairValue);
  const prevAfter = num(previous?.priceAfter);
  let explained = 0;
  if (prevFair > 0 && prevAfter > 0) {
    const fairChange = Math.log(fair / prevFair);
    if (Math.abs(fairChange) > EPS) {
      const split = channel?.parts ? { ...channel.parts } : {};
      const placed = sumParts(split);
      if (Math.abs(fairChange - placed) > EPS) split.other = (split.other ?? 0) + (fairChange - placed);
      addInto(parts, split);
      explained += fairChange;
    }
    const push = num(players?.push) ?? 0;
    if (push) {
      parts.players = (parts.players ?? 0) + push;
      explained += push;
      meta.players = { net_shares: num(players.net_shares) ?? 0, since: players.since ?? null };
    }

    // The last split shrinks as later trades fade the old distance; anything beyond it is `other`.
    const carried = Math.log(prevFair / prevAfter);
    const rest = gapBefore - explained;
    const prevParts = previous.state?.parts && typeof previous.state.parts === "object" ? previous.state.parts : { other: carried };
    const prevSum = sumParts(Object.fromEntries(Object.entries(prevParts).map(([key, value]) => [key, num(value) ?? 0])));
    let keep = 0;
    if (Math.abs(carried) > EPS && Math.abs(prevSum) > EPS) {
      const ratio = rest / carried;
      keep = ratio > 0 ? Math.min(ratio, 1) : 0;
      // Rescale the stored split to the carried distance first (rounding), then keep what's left.
      const factor = (keep * carried) / prevSum;
      for (const [key, value] of Object.entries(prevParts)) {
        const v = num(value);
        if (!v) continue;
        // Last time's player trading is earlier trading now.
        const target = key === "players" ? "players_earlier" : key;
        parts[target] = (parts[target] ?? 0) + v * factor;
      }
      if (previous.state?.meta?.channel) meta.channel = previous.state.meta.channel;
    }
    const leftover = rest - keep * carried;
    if (Math.abs(leftover) > EPS) parts.other = (parts.other ?? 0) + leftover;
  } else {
    parts.other = gapBefore;
  }
  if (channel?.meta) meta.channel = channel.meta;

  // 2. The reasons: the biggest named parts that pushed the way the price went.
  const move = after / before - 1;
  const reasons = [];
  if (Math.abs(move) >= MIN_MOVE && Math.sign(move) === Math.sign(gapBefore)) {
    const up = move > 0;
    const sign = up ? 1 : -1;
    const pushing = Object.entries(parts).filter(([, value]) => sign * value > 0);
    const total = pushing.reduce((sum, [, value]) => sum + sign * value, 0);
    const ranked = pushing.filter(([key]) => NAMED_KEYS.includes(key)).sort((a, b) => sign * b[1] - sign * a[1]);
    for (const [key, value] of ranked) {
      const share = (sign * value) / total;
      if (share < (reasons.length ? SECOND_SHARE : PRIMARY_SHARE) || reasons.length >= MAX_REASONS) break;
      const line = describe(key, up, CHANNEL_KEYS.includes(key) ? meta.channel : meta[key], { tickDay });
      if (!line) continue;
      const kind = key === "players_earlier" ? "players" : key;
      if (reasons.some((reason) => reason.kind === kind)) continue;
      reasons.push({ kind, ...line });
    }
    if (!reasons.length) reasons.push({ kind: "mixed", text: "No single driver stood out", short: "No standout" });
  }

  // 3. What carries into the next tick: the same split, scaled to the distance left. A tick that
  //    lands past the fair value leaves a distance none of these explain, so that's `other`.
  let nextParts = {};
  if (Math.abs(gapAfter) > EPS) {
    const ratio = Math.abs(gapBefore) > EPS ? gapAfter / gapBefore : 0;
    if (ratio > 0) addInto(nextParts, parts, Math.min(ratio, 1));
    else nextParts = { other: gapAfter };
    const placed = sumParts(nextParts);
    if (Math.abs(gapAfter - placed) > EPS) nextParts.other = (nextParts.other ?? 0) + (gapAfter - placed);
  }
  const rounded = Object.fromEntries(
    Object.entries(nextParts)
      .map(([key, value]) => [key, Number(value.toFixed(10))])
      .filter(([, value]) => value !== 0)
  );
  // The channel numbers ride along while a channel part is left to explain; this tick's fills don't.
  const keptMeta = meta.channel && CHANNEL_KEYS.some((key) => rounded[key] !== undefined) ? { channel: meta.channel } : {};
  return { reasons, state: { v: 1, parts: rounded, meta: keptMeta } };
}

// ── Loading a batch of ticks' inputs ─────────────────────────────────────

/**
 * Everything explainTick needs for a batch of due ticks, in a few queries: each stock's last applied
 * tick, its fills since, and (when a settlement came in between) its channel snapshots and big streams.
 */
async function loadTickContext(client, intervals, { now = new Date(), timeZone = "America/New_York" } = {}) {
  const context = { timeZone, previous: new Map(), fills: new Map(), channelOf: new Map(), snapshots: new Map(), peaks: new Map() };
  const assetIds = [...new Set(intervals.map((interval) => String(interval.asset_id)))];
  if (!assetIds.length) return context;

  const { rows: previousRows } = await client.query(
    `
    SELECT a.id::text AS asset_id, p.interval_key, p.applied_at, p.price_after, p.base_rate, p.driver_state_json, p.market_day
    FROM unnest($1::bigint[]) AS a(id)
    CROSS JOIN LATERAL (
      SELECT i.interval_key, i.applied_at, i.price_after::float8 AS price_after, i.base_rate::float8 AS base_rate, i.driver_state_json,
        s.market_date::text AS market_day
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.asset_id = a.id AND i.status = 'applied'
      ORDER BY i.scheduled_at DESC, i.id DESC
      LIMIT 1
    ) p
  `,
    [assetIds]
  );
  for (const row of previousRows) context.previous.set(row.asset_id, row);

  const { rows: assetRows } = await client.query(`SELECT id::text AS id, youtube_channel_id FROM market.market_assets WHERE id = ANY($1::bigint[])`, [assetIds]);
  for (const row of assetRows) context.channelOf.set(row.id, row.youtube_channel_id);

  const since = previousRows
    .map((row) => (row.applied_at ? new Date(row.applied_at).getTime() : null))
    .filter((value) => value !== null);
  if (since.length) {
    const from = new Date(Math.max(Math.min(...since), now.getTime() - MAX_FILL_LOOKBACK_MS));
    const { rows: fills } = await client.query(
      `
      SELECT asset_id::text AS asset_id, side, quantity::float8 AS quantity, ts
      FROM market.trade_fills
      WHERE asset_id = ANY($1::bigint[]) AND ts > $2 AND ts <= $3
      ORDER BY ts ASC
    `,
      [assetIds, from, now]
    );
    for (const fill of fills) {
      if (!context.fills.has(fill.asset_id)) context.fills.set(fill.asset_id, []);
      context.fills.get(fill.asset_id).push(fill);
    }
  }

  // Stocks with a settlement since their last tick: the fair value moved, so read the channel numbers.
  const days = new Map();
  for (const interval of intervals) {
    const id = String(interval.asset_id);
    const prev = context.previous.get(id);
    const day = dateKey(interval.market_day ?? interval.market_date);
    if (!prev?.market_day || !day || prev.market_day >= day) continue;
    const span = days.get(id) ?? { from: prev.market_day, to: day };
    if (day > span.to) span.to = day;
    days.set(id, span);
  }
  const channels = [...new Set([...days.keys()].map((id) => context.channelOf.get(id)).filter(Boolean))];
  if (channels.length) {
    const spans = [...days.values()];
    const latest = spans.reduce((max, span) => (span.to > max ? span.to : max), spans[0].to);
    const earliest = spans.reduce((min, span) => (span.from < min ? span.from : min), spans[0].from);
    const start = [shiftDay(earliest, -(SMOOTHING_LAGS + 2)), shiftDay(latest, -36)].sort()[0];
    const { rows: snapshots } = await client.query(
      `
      SELECT youtube_channel_id, snapshot_date::text AS snapshot_date, subscriber_count::float8 AS subscriber_count,
        view_count::float8 AS view_count, video_count::float8 AS video_count, size_anchor_raw::float8 AS size_anchor_raw,
        view_signal::float8 AS view_signal, sub_signal::float8 AS sub_signal, upload_signal::float8 AS upload_signal,
        event_signal::float8 AS event_signal, momentum_raw::float8 AS momentum_raw, event_kinds
      FROM market.channel_daily_snapshots
      WHERE youtube_channel_id = ANY($1::text[]) AND snapshot_date BETWEEN $2::date AND $3::date AND calculation_status = 'complete'
    `,
      [channels, start, latest]
    );
    for (const row of snapshots) {
      if (!context.snapshots.has(row.youtube_channel_id)) context.snapshots.set(row.youtube_channel_id, new Map());
      context.snapshots.get(row.youtube_channel_id).set(row.snapshot_date, row);
    }

    // Peaks of the labeled big streams those snapshots counted (the Wire's labels; none before it exists).
    const eventDays = snapshots.filter((row) => (num(row.event_signal) ?? 0) > 0 && Array.isArray(row.event_kinds) && row.event_kinds.length);
    if (eventDays.length) {
      const { rows: exists } = await client.query(`SELECT to_regclass('content.wire_stream_labels') IS NOT NULL AS ok`);
      if (exists[0]?.ok) {
        const firstDay = eventDays.reduce((min, row) => (row.snapshot_date < min ? row.snapshot_date : min), eventDays[0].snapshot_date);
        const { rows: peaks } = await client.query(
          `
          SELECT s.youtube_channel_id, to_char((s.actual_start_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, l.event,
            MAX(s.max_concurrent_viewers)::float8 AS peak
          FROM yt.livestream_sessions s
          JOIN content.wire_stream_labels l ON l.video_id = s.video_id
          WHERE s.youtube_channel_id = ANY($2::text[])
            AND s.actual_start_at >= ($3::date - 1)::timestamp AT TIME ZONE $1
            AND s.actual_start_at < ($4::date + 1)::timestamp AT TIME ZONE $1
            AND l.event = ANY($5::text[])
          GROUP BY 1, 2, 3
        `,
          [timeZone, [...new Set(eventDays.map((row) => row.youtube_channel_id))], firstDay, latest, Object.keys(STREAM_KINDS)]
        );
        for (const row of peaks) context.peaks.set(`${row.youtube_channel_id}|${row.day}|${row.event}`, row.peak);
      }
    }
  }
  return context;
}

/**
 * explainTick's input for one due tick, from the batch context. `previousLabel` names the tick the
 * fills count from ("Open").
 */
function tickInput(context, interval, { priceBefore, priceAfter, fairValue, liquidityDepth, now, labelOf = (key) => key }) {
  const id = String(interval.asset_id);
  const prev = context.previous.get(id) ?? null;
  const previous = prev ? { fairValue: prev.base_rate, priceAfter: prev.price_after, state: prev.driver_state_json ?? null } : null;
  const since = prev?.applied_at ? new Date(prev.applied_at).getTime() : null;
  const fills = since === null ? [] : (context.fills.get(id) ?? []).filter((fill) => new Date(fill.ts).getTime() > since && new Date(fill.ts).getTime() <= now.getTime());
  const players = { ...playerPush(fills, liquidityDepth), since: prev ? labelOf(prev.interval_key) : null };

  let channel = null;
  const day = dateKey(interval.market_day ?? interval.market_date);
  const byDate = context.snapshots.get(context.channelOf.get(id));
  if (prev?.market_day && day && prev.market_day < day && byDate && num(prev.base_rate) > 0) {
    const total = Math.log(num(fairValue) / num(prev.base_rate));
    const metrics = channelMetrics(byDate, day);
    if (metrics.stream) {
      const peak = context.peaks.get(`${context.channelOf.get(id)}|${metrics.stream.date}|${metrics.stream.kind}`);
      if (num(peak) > 0) metrics.stream.peak = num(peak);
    }
    channel = { parts: splitFairValueChange({ byDate, from: prev.market_day, to: day, total }), meta: metrics };
  }
  return { priceBefore, priceAfter, fairValue, previous, channel, players, tickDay: zonedDay(now, context.timeZone) };
}

/** After a tick lands, the next tick in the same batch for that stock counts from it. */
function rememberTick(context, interval, { priceAfter, fairValue, state, now }) {
  context.previous.set(String(interval.asset_id), {
    asset_id: String(interval.asset_id),
    interval_key: interval.interval_key,
    applied_at: now,
    price_after: priceAfter,
    base_rate: fairValue,
    driver_state_json: state,
    market_day: dateKey(interval.market_day ?? interval.market_date),
  });
}

/** The public form of a tick's reasons: kind and wording only. */
function publicReasons(reasons) {
  if (!Array.isArray(reasons)) return null;
  return reasons
    .filter((reason) => reason && typeof reason.text === "string")
    .map((reason) => ({ kind: String(reason.kind), text: reason.text, short: reason.short ?? reason.text, ...(reason.detail ? { detail: reason.detail } : {}) }));
}

module.exports = {
  MIN_MOVE,
  NAMED_KEYS,
  STREAM_KINDS,
  channelMetrics,
  describe,
  explainTick,
  loadTickContext,
  playerPush,
  publicReasons,
  rememberTick,
  snapshotParts,
  splitFairValueChange,
  tickInput,
  zonedDay,
};
