const test = require("node:test");
const assert = require("node:assert/strict");
const { computeDerivedSnapshot } = require("../src/services/fundamentals");
const { generateStrengths } = require("../src/services/marketAdjustments");
const drivers = require("../src/services/tickDrivers");

// Why a tick moved (services/tickDrivers.js): each line names a real, public input that pushed the
// way the price went, and nothing in it gives away the fair value, the distance to it, a strength or
// the next move.

const DAY = 86_400_000;
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const LABELS = { open: "Open", lunch: "Lunch", late: "Late", overnight: "Overnight" };
// Tick times in UTC for November (ET = UTC-5): 09:00, 15:00, 21:00, 03:00 the next day.
const TICKS = [
  ["open", 14],
  ["lunch", 20],
  ["late", 26],
  ["overnight", 32],
];

let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A channel's stored daily snapshots, computed by the real fair value formula. */
function channelHistory({ start = "2026-09-20", days = 50, subs = 1_200_000, subsPerDay = 900, viewsPerDay = 250_000, uploadEvery = 2, overrides = {} } = {}) {
  const points = [];
  let subscribers = subs;
  let views = 80_000_000;
  let videos = 600;
  for (let index = 0; index < days; index += 1) {
    const date = shift(start, index);
    const day = overrides[date] ?? {};
    subscribers += day.subs ?? subsPerDay;
    views += day.views ?? viewsPerDay;
    if (day.upload ?? index % uploadEvery === 0) videos += 1;
    points.push({ youtube_channel_id: "UC_TEST", snapshot_date: date, subscriber_count: subscribers, view_count: views, video_count: videos, has_video_count_data: true, events: day.events ?? null });
  }
  const historyByDate = new Map(points.map((point) => [point.snapshot_date, point]));
  const byDate = new Map();
  let previous = null;
  for (const point of points) {
    const derived = computeDerivedSnapshot(point, historyByDate, previous, 1, point.events, null);
    previous = derived;
    byDate.set(point.snapshot_date, derived);
  }
  return byDate;
}

/**
 * A small copy of the market's price mechanics (settlement.js, trading.js, marketAdjustments.js) to
 * run ticks through: settlement carries the price and resets the fair value, trades shock the
 * offsets (the transient part fading at each later trade), a tick moves the price `strength` of the
 * way to the fair value. Each tick is explained the way the live tick is.
 */
function simulate({ byDate, from, to, depth = 2_000, scale = 40, strengths = () => generateStrengths(), trades = () => [] }) {
  const log = [];
  let price = null;
  let persistent = 0;
  let transient = 0;
  let updatedAt = null;
  let fair = null;
  let previous = null;
  let prevMeta = null;
  for (let day = from; day <= to; day = shift(day, 1)) {
    const snapshot = byDate.get(day);
    const nextFair = snapshot.fundamental_value_smoothed / scale;
    const settleAt = Date.parse(`${day}T14:00:00Z`);
    if (price === null) price = nextFair;
    // Settlement: persistent offset fades, price carried, fair value moves.
    persistent *= 0.9;
    fair = nextFair;
    transient = Math.log(price / fair) - persistent;
    updatedAt = settleAt;
    const dayStrengths = strengths(day);
    TICKS.forEach(([key, hour], index) => {
      const at = Date.parse(`${day}T00:00:00Z`) + hour * 3_600_000;
      const fills = (trades(day, key) ?? []).map((fill) => ({ ...fill, ts: new Date(at - fill.minutesBefore * 60_000).toISOString() })).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      for (const fill of fills) {
        const t = Date.parse(fill.ts);
        transient *= 0.5 ** ((t - updatedAt) / 60_000 / 60);
        const sign = fill.side === "buy" ? 1 : -1;
        persistent += sign * 0.15 * (fill.quantity / depth);
        transient += sign * 0.7 * (fill.quantity / depth);
        updatedAt = t;
        price = fair * Math.exp(persistent + transient);
      }
      const before = price;
      const strength = dayStrengths[index];
      const after = Math.max(0.000001, before + (fair - before) * (strength / 100));
      transient = Math.log(after / fair) - persistent;
      updatedAt = at;
      price = after;

      const now = new Date(at);
      const sinceMs = previous ? Date.parse(previous.at) : null;
      const windowFills = sinceMs === null ? [] : fills.filter((fill) => Date.parse(fill.ts) > sinceMs);
      const channel =
        previous && previous.day < day
          ? { parts: drivers.splitFairValueChange({ byDate, from: previous.day, to: day, total: Math.log(fair / previous.fair) }), meta: drivers.channelMetrics(byDate, day) }
          : null;
      const input = {
        priceBefore: before,
        priceAfter: after,
        fairValue: fair,
        previous: previous ? { fairValue: previous.fair, priceAfter: previous.after, state: previous.state } : null,
        channel,
        players: { ...drivers.playerPush(windowFills, depth), since: previous ? LABELS[previous.key] : null },
        tickDay: drivers.zonedDay(now, "America/New_York"),
      };
      const result = drivers.explainTick(input);
      if (channel) prevMeta = channel.meta;
      log.push({ day, key, at: now.toISOString(), before, after, fair, strength, fills: windowFills, input, result, metrics: prevMeta });
      previous = { day, key, at: now.toISOString(), fair, after, state: result.state };
    });
  }
  return log;
}

// ── The formula ──────────────────────────────────────────────────────────

test("the split's parts add up to the fair value formula", () => {
  const byDate = channelHistory({ overrides: { "2026-10-30": { events: ["three_d"], views: 2_000_000 }, "2026-11-02": { subs: 25_000 } } });
  for (const [day, snapshot] of byDate) {
    const parts = drivers.snapshotParts(snapshot);
    const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - Math.log(snapshot.fundamental_value_raw)) < 1e-9, `${day}: ${total} vs ${Math.log(snapshot.fundamental_value_raw)}`);
  }
});

test("a settlement's change lands on the driver that caused it", () => {
  const byDate = channelHistory({ overrides: { "2026-11-02": { subs: 30_000 }, "2026-11-04": { events: ["three_d"] } } });
  const total = (from, to) => Math.log(byDate.get(to).fundamental_value_smoothed / byDate.get(from).fundamental_value_smoothed);
  const biggest = (parts) => Object.entries(parts).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  const subsDay = drivers.splitFairValueChange({ byDate, from: "2026-11-01", to: "2026-11-02", total: total("2026-11-01", "2026-11-02") });
  assert.equal(biggest(subsDay)[0], "subs");
  assert.ok(subsDay.subs > 0);

  const streamDay = drivers.splitFairValueChange({ byDate, from: "2026-11-03", to: "2026-11-04", total: total("2026-11-03", "2026-11-04") });
  assert.equal(biggest(streamDay)[0], "stream");
  assert.ok(streamDay.stream > 0);

  // The day after, the lift fades: the stream part turns negative.
  const after = drivers.splitFairValueChange({ byDate, from: "2026-11-04", to: "2026-11-05", total: total("2026-11-04", "2026-11-05") });
  assert.ok(after.stream < 0);

  // Every split adds up to the change it splits.
  for (const parts of [subsDay, streamDay, after]) assert.ok(Number.isFinite(Object.values(parts).reduce((a, b) => a + b, 0)));
});

// ── Lines ────────────────────────────────────────────────────────────────

test("the Open tick after a subscriber jump names the subscribers", () => {
  const byDate = channelHistory({ overrides: { "2026-11-02": { subs: 30_000 } } });
  const log = simulate({ byDate, from: "2026-10-25", to: "2026-11-02", strengths: () => [40, 50, 60, 50] });
  const open = log.find((entry) => entry.day === "2026-11-02" && entry.key === "open");
  assert.ok(open.after > open.before);
  assert.equal(open.result.reasons[0].kind, "subs");
  assert.match(open.result.reasons[0].text, /^Subscribers up \d+(\.\d+)?% this week$/);
  // Lunch closes more of the same distance, with no trading in between: same reason.
  const lunch = log.find((entry) => entry.day === "2026-11-02" && entry.key === "lunch");
  assert.equal(lunch.result.reasons[0].kind, "subs");
});

test("a big stream is named with its peak, and its fading the days after", () => {
  const byDate = channelHistory({ overrides: { "2026-11-03": { events: ["three_d"] } } });
  const log = simulate({ byDate, from: "2026-10-25", to: "2026-11-05", strengths: () => [50, 50, 50, 50] });
  const open = log.find((entry) => entry.day === "2026-11-03" && entry.key === "open");
  const meta = { ...open.input.channel.meta, stream: { ...open.input.channel.meta.stream, peak: 18_234 } };
  const withPeak = drivers.explainTick({ ...open.input, channel: { ...open.input.channel, meta } });
  assert.equal(withPeak.reasons[0].kind, "stream");
  assert.equal(withPeak.reasons[0].text, "3D live today (18k peak)");

  const fading = log.find((entry) => entry.day === "2026-11-05" && entry.key === "open");
  assert.ok(fading.after < fading.before);
  assert.ok(fading.result.reasons.some((reason) => reason.kind === "stream" && /^Boost from .*3D live faded$/.test(reason.text)), JSON.stringify(fading.result.reasons));
});

test("player buying before a tick is named when the tick takes it back", () => {
  const byDate = channelHistory({});
  const log = simulate({
    byDate,
    from: "2026-10-28",
    to: "2026-11-01",
    strengths: () => [50, 50, 50, 50],
    trades: (day, key) => (day === "2026-11-01" && key === "lunch" ? [{ side: "buy", quantity: 120, minutesBefore: 50 }, { side: "buy", quantity: 90, minutesBefore: 20 }] : []),
  });
  const lunch = log.find((entry) => entry.day === "2026-11-01" && entry.key === "lunch");
  assert.ok(lunch.after < lunch.before);
  assert.equal(lunch.result.reasons[0].kind, "players");
  assert.equal(lunch.result.reasons[0].text, "Eased after player buying since the Open tick");
  assert.equal(lunch.result.reasons[0].detail, "210 shares net bought since the Open tick");
  // The next tick counts that buying as earlier trading.
  const late = log.find((entry) => entry.day === "2026-11-01" && entry.key === "late");
  assert.equal(late.result.reasons[0].text, "Eased after earlier player buying");
});

test("a tick past the fair value leaves nothing named for the move back", () => {
  const byDate = channelHistory({ overrides: { "2026-11-02": { subs: 30_000 } } });
  const log = simulate({ byDate, from: "2026-10-30", to: "2026-11-02", strengths: (day) => (day === "2026-11-02" ? [170, 10, 10, 10] : [50, 50, 50, 50]) });
  const lunch = log.find((entry) => entry.day === "2026-11-02" && entry.key === "lunch");
  assert.ok(lunch.after < lunch.before, "the lunch tick moves back");
  assert.deepEqual(lunch.result.reasons.map((reason) => reason.kind), ["mixed"]);
});

test("a line never claims what the public numbers contradict", () => {
  // Views below last month's pace can't be the reason a stock went up.
  assert.equal(drivers.describe("views", true, { views_pace: -0.2 }, {}), null);
  assert.equal(drivers.describe("subs", false, { subs_week: 0.004 }, {}).text, "Subscriber growth slowed this week");
  assert.equal(drivers.describe("subs", true, { subs_week: -0.001 }, {}).text, "Fewer subscribers lost this week");
  assert.equal(drivers.describe("players", false, { net_shares: -50, since: "Open" }, {}), null, "selling can't explain a drop the tick made");
  assert.equal(drivers.describe("uploads", true, { upload_streak: 0, uploads_week: 0 }, {}), null);
  assert.equal(drivers.describe("uploads", false, { upload_streak: 0, upload_idle_days: 9 }, {}).text, "No new uploads in 9 days");
});

test("tiny moves get no line, and a stock with no history gets a neutral one", () => {
  assert.deepEqual(drivers.explainTick({ priceBefore: 100, priceAfter: 100.01, fairValue: 101 }).reasons, []);
  assert.deepEqual(drivers.explainTick({ priceBefore: 100, priceAfter: 103, fairValue: 106 }).reasons.map((reason) => reason.kind), ["mixed"]);
});

// ── Secrecy ──────────────────────────────────────────────────────────────

// Words that would point at the hidden target or say what comes next.
const FORBIDDEN = /target|fair|value|gap|catch|still|toward|next|remain|expect|will|continu|predict|pull|overshoot|strength|upcoming|more to come|keeps?\b|until|soon/i;
const DOWN_WORDS = /\bdown\b|slowed|slipped|eased|faded|no new uploads|flat|ended|cooled/i;
const UP_WORDS = /\bup\b|bounced|picked|(?<!no )new uploads?\b|days in a row|-day upload run|peak\)|steadier|fewer subscribers lost/i;

/** Every way a public number may be written in a line. */
function publicTokens(entry) {
  const tokens = new Set();
  const addPct = (fraction) => {
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) return;
    const value = Math.abs(fraction) * 100;
    for (const digits of [0, 1, 2]) tokens.add(String(Number(value.toFixed(digits))));
  };
  const add = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    tokens.add(String(Math.abs(value)));
    tokens.add(Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  };
  const meta = entry.input.channel?.meta ?? entry.result.state?.meta?.channel ?? entry.metrics ?? {};
  for (const source of [meta, entry.metrics ?? {}]) {
    addPct(source.subs_week);
    addPct(source.views_pace);
    add(source.upload_streak);
    add(source.upload_idle_days);
    add(source.uploads_week);
    if (source.stream?.date) tokens.add(String(Number(source.stream.date.slice(8, 10))));
  }
  add(entry.input.players?.net_shares);
  return tokens;
}

/** A spread of scenarios: growth, decline, big streams, idle channels, heavy trading, random strengths. */
function sweep() {
  const runs = [];
  for (let run = 0; run < 24; run += 1) {
    const overrides = {};
    for (let index = 0; index < 50; index += 1) {
      const date = shift("2026-09-20", index);
      const roll = random();
      if (roll < 0.06) overrides[date] = { events: [["three_d", "new_outfit", "birthday", "original_song"][Math.floor(random() * 4)]] };
      else if (roll < 0.12) overrides[date] = { subs: Math.round((random() - 0.4) * 40_000) };
      else if (roll < 0.18) overrides[date] = { views: Math.round(random() * 3_000_000), upload: random() < 0.5 };
    }
    const byDate = channelHistory({ overrides, subsPerDay: Math.round((random() - 0.2) * 3_000), viewsPerDay: Math.round(random() * 600_000), uploadEvery: 1 + Math.floor(random() * 9) });
    runs.push(
      ...simulate({
        byDate,
        from: "2026-10-26",
        to: "2026-11-08",
        depth: 500 + random() * 4_000,
        trades: () =>
          random() < 0.5
            ? Array.from({ length: 1 + Math.floor(random() * 6) }, () => ({ side: random() < 0.5 ? "buy" : "sell", quantity: Math.round(1 + random() * 180), minutesBefore: Math.round(1 + random() * 340) }))
            : [],
      })
    );
  }
  return runs;
}

test("no line names the fair value, the distance to it, a strength or what comes next", () => {
  const log = sweep();
  let lines = 0;
  const kinds = new Set();
  for (const entry of log) {
    const up = entry.after > entry.before;
    for (const reason of entry.result.reasons) {
      lines += 1;
      kinds.add(reason.kind);
      assert.deepEqual(Object.keys(reason).filter((key) => !["kind", "text", "short", "detail"].includes(key)), [], "only kind and wording");
      for (const text of [reason.text, reason.short, reason.detail].filter(Boolean)) {
        assert.doesNotMatch(text, FORBIDDEN, text);
        // A line says why the price went the way it went, never the opposite.
        if (reason.kind !== "mixed") assert.doesNotMatch(text, up ? DOWN_WORDS : UP_WORDS, `${up ? "up" : "down"} move: ${text}`);
        // Every number in it is a public count or a date: never a price, a fair value, a move or a strength.
        const allowed = publicTokens(entry);
        for (const token of text.replace(/\b3D\b/g, "").match(/\d[\d,]*(\.\d+)?/g) ?? []) {
          const bare = token.replace(/k$|M$/, "");
          const peak = /\(\d[\d.]*[kM]? peak\)/.test(text) && text.includes(`${token}k peak`);
          assert.ok(allowed.has(bare) || allowed.has(token) || peak || /^\d+-day upload run$/.test(text) || /^\d+d$/.test(token), `"${token}" in "${text}" is not a public number`);
        }
      }
    }
  }
  assert.ok(lines > 500, `the sweep produced ${lines} lines`);
  for (const kind of ["subs", "views", "stream", "players", "mixed"]) assert.ok(kinds.has(kind), `the sweep covered ${kind}`);
});

test("a line is the same whatever the tick's strength, the price level or the size of the distance", () => {
  const log = sweep();
  let checked = 0;
  for (const entry of log) {
    const { input, result } = entry;
    if (!result.reasons.length) continue;
    // Another strength (same direction, not past the fair value): the same line. The strength of
    // this tick, and of every tick after it, never reaches the wording.
    for (const strength of [0.05, 0.37, 0.81, 1]) {
      const after = input.priceBefore + (input.fairValue - input.priceBefore) * strength;
      if (Math.abs(after / input.priceBefore - 1) < drivers.MIN_MOVE) continue;
      assert.deepEqual(drivers.explainTick({ ...input, priceAfter: after }).reasons, result.reasons);
    }
    // Every price and fair value times a constant: the same line and the same carried split.
    const k = 3.7;
    const scaled = drivers.explainTick({
      ...input,
      priceBefore: input.priceBefore * k,
      priceAfter: input.priceAfter * k,
      fairValue: input.fairValue * k,
      previous: input.previous ? { ...input.previous, fairValue: input.previous.fairValue * k, priceAfter: input.previous.priceAfter * k } : null,
    });
    assert.deepEqual(scaled.reasons, result.reasons);
    checked += 1;
  }
  assert.ok(checked > 300);

  // The same channel numbers behind a small or a large fair value move: the same line, so the
  // wording says nothing about how far the price has to go.
  const byDate = channelHistory({ overrides: { "2026-11-02": { subs: 30_000 } } });
  const meta = drivers.channelMetrics(byDate, "2026-11-02");
  const lines = [0.004, 0.02, 0.08, 0.2].map((total) => {
    const fair = 100 * Math.exp(total);
    return drivers.explainTick({
      priceBefore: 100,
      priceAfter: 100 + (fair - 100) * 0.4,
      fairValue: fair,
      previous: { fairValue: 100, priceAfter: 100, state: { v: 1, parts: {}, meta: {} } },
      channel: { parts: { subs: total }, meta },
      players: { push: 0, net_shares: 0, since: "Overnight" },
      tickDay: "2026-11-03",
    }).reasons;
  });
  for (const reasons of lines) assert.deepEqual(reasons, lines[0]);
});

test("the carried split is private: the public form keeps only kind and wording", () => {
  const out = drivers.publicReasons([{ kind: "subs", text: "Subscribers up 0.6% this week", short: "Subs +0.6%", parts: { subs: 0.01 }, gap: 0.02 }]);
  assert.deepEqual(out, [{ kind: "subs", text: "Subscribers up 0.6% this week", short: "Subs +0.6%" }]);
  const secrecy = require("../src/services/marketSecrecy");
  const scrubbed = secrecy.scrubPublicMarketPayload({ items: [{ reasons: out, driver_state_json: { parts: { subs: 0.01 } }, driver_state: {} }] });
  assert.deepEqual(scrubbed, { items: [{ reasons: out }] });
});

test("player push follows trading.js: buying is a negative push, older fills have faded", () => {
  const at = Date.parse("2026-11-01T19:00:00Z");
  const fills = [
    { side: "buy", quantity: 100, ts: new Date(at - 120 * 60_000).toISOString() },
    { side: "sell", quantity: 40, ts: new Date(at).toISOString() },
  ];
  const { push, net_shares } = drivers.playerPush(fills, 1_000);
  // Buy: 0.1 × (0.15 + 0.7 × 0.25); sell: −0.04 × 0.85.
  const price = 0.1 * (0.15 + 0.7 * 0.25) - 0.04 * 0.85;
  assert.ok(Math.abs(push + price) < 1e-12);
  assert.equal(net_shares, 60);
});
