// Auto markets (docs/predictions/PREDICTIONS_DESIGN.md §6): opened and resolved by the scheduler
// from site data. Idempotent: each market has a unique auto_key, so reruns never duplicate.
//
//   tick-direction   "PEK up on the Lunch tick?"         ← asset_adjustment_intervals
//   tick-top-gainer  "Top gainer on the Lunch tick?"     ← asset_adjustment_intervals
//   stream-peak      "Marine's stream peaks above 45k?"  ← yt.livestream_sessions
//
// stream-peak-pool and top-gainer-pool are the same questions as player pools
// (docs/design/predictions-pools.md §4). They start off, and stay separate from the market-maker
// templates so each can be turned on alone.
//
// Betting must end before the outcome can be known. closes_at is the schedule; guards.js checks the
// data on every bet. How many markets get made is set by each template's params, in the admin
// console: see generateTickMarkets and generateStreamMarkets.

const core = require("./core");
const guards = require("./guards");
const markets = require("./markets");
const features = require("../../features");
const pools = require("./pools");
const resolution = require("./resolution");

const POOL_TEMPLATES = new Set(["stream-peak-pool", "top-gainer-pool"]);
const STREAM_TEMPLATES = new Set(["stream-peak", "stream-peak-pool"]);
const TICK_TEMPLATES = new Set(["tick-direction", "tick-top-gainer", "top-gainer-pool"]);

const { num, predictionError } = core;

const TICK_LABEL = { open: "Open", lunch: "Lunch", late: "Late", overnight: "Overnight" };
const CLOSE_BEFORE_TICK_MS = 5 * 60_000;
const TICK_GRACE_MS = 2 * 3_600_000;
// The only ticks that get markets. All four of a day's ticks pull toward one hidden target, so each
// tick's move gives away part of what the next will do. Open can't have a market: settlement creates
// its row and it lands a minute later. That leaves Lunch as the one with the least given away.
const TICKS_WITH_MARKETS = ["lunch"];
const STREAM_GIVE_UP_MS = 12 * 3_600_000;
// A stream market gets at least this long to take bets.
const MIN_BETTING_MS = 30 * 60_000;
const STREAM_DEFAULTS = { talents: 15, daily_cap: 5, close_lead_minutes: guards.DEFAULT_CLOSE_LEAD_MINUTES, open_lead_hours: 24, min_past_streams: 3 };
// What the admin console may set; updateTemplate clamps to these.
const PARAM_LIMITS = {
  count: [1, 20],
  liquidity_b: [10, 100_000],
  fee_bps: [0, 1000],
  min_past_streams: [1, 50],
  talents: [1, 200],
  daily_cap: [0, 50],
  close_lead_minutes: [5, 180],
  open_lead_hours: [1, 72],
};
const clampParam = (field, value) => Math.min(PARAM_LIMITS[field][1], Math.max(PARAM_LIMITS[field][0], field === "liquidity_b" ? num(value) : Math.round(num(value))));
const streamParam = (params, field) => clampParam(field, params[field] ?? STREAM_DEFAULTS[field]);

const etTime = (date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", weekday: "short" }).format(date) + " ET";

async function loadTemplates(pool) {
  const { rows } = await pool.query(`SELECT * FROM market.prediction_auto_templates`);
  return new Map(rows.map((row) => [row.key, { enabled: row.enabled, params: row.params_json || {} }]));
}

async function recordRun(pool, key, result) {
  await pool.query(`UPDATE market.prediction_auto_templates SET last_run_at = now(), last_result_json = $2 WHERE key = $1`, [key, JSON.stringify(result)]);
}

async function marketExists(pool, autoKey) {
  const { rows } = await pool.query(`SELECT 1 FROM market.prediction_markets WHERE auto_key = $1`, [autoKey]);
  return rows.length > 0;
}

async function createAuto(pool, input, { template, autoKey, autoData }) {
  if (await marketExists(pool, autoKey)) return null;
  try {
    return await core.inTransaction(pool, (client) =>
      POOL_TEMPLATES.has(template)
        ? pools.insertPoolWithClient(client, input, { kind: "auto", autoTemplate: template, autoKey, autoData })
        : markets.createMarketWithClient(client, { ...input, publish: true }, { status: "open", kind: "auto", autoTemplate: template, autoKey, autoData })
    );
  } catch (error) {
    if (error?.code === "23505") return null; // another instance created it first
    throw error;
  }
}

// ── Ticks ──────────────────────────────────────────────────────────────────
async function nextTick(pool) {
  const { rows } = await pool.query(
    `SELECT scheduled_at, interval_key, COUNT(*)::int AS assets FROM market.asset_adjustment_intervals
     WHERE status = 'scheduled' AND interval_key = ANY($1::text[]) AND scheduled_at > now() + interval '10 minutes'
     GROUP BY scheduled_at, interval_key ORDER BY scheduled_at LIMIT 1`,
    [TICKS_WITH_MARKETS]
  );
  return rows[0] || null;
}

/** The K most active talents, by shares traded in 24 h and then holders; with `tickAt`, only those on that tick. */
async function activeAssets(pool, { tickAt = null, count }) {
  const { rows } = await pool.query(
    `SELECT a.id, a.symbol, a.display_name, COALESCE(v.volume, 0) AS volume, COALESCE(h.holders, 0) AS holders
     FROM market.market_assets a
     LEFT JOIN (SELECT asset_id, SUM(quantity) AS volume FROM market.trade_fills WHERE ts > now() - interval '24 hours' GROUP BY asset_id) v ON v.asset_id = a.id
     LEFT JOIN (SELECT asset_id, COUNT(*) AS holders FROM market.portfolio_holdings WHERE quantity > 0 GROUP BY asset_id) h ON h.asset_id = a.id
     WHERE a.status = 'active'
       AND a.trading_state IS DISTINCT FROM 'buyback'
       AND ($1::timestamptz IS NULL OR EXISTS (
         SELECT 1 FROM market.asset_adjustment_intervals i WHERE i.asset_id = a.id AND i.scheduled_at = $1 AND i.status = 'scheduled'
       ))
     ORDER BY volume DESC, holders DESC, a.id ASC
     LIMIT $2`,
    [tickAt, count]
  );
  return rows;
}

async function generateTickMarkets(pool, templates) {
  const direction = templates.get("tick-direction");
  const gainer = templates.get("tick-top-gainer");
  if (!direction?.enabled && !gainer?.enabled) return { created: 0 };
  const tick = await nextTick(pool);
  if (!tick) return { created: 0, note: "no scheduled tick" };
  const tickAt = new Date(tick.scheduled_at);
  const closesAt = new Date(tickAt.getTime() - CLOSE_BEFORE_TICK_MS);
  if (closesAt.getTime() - Date.now() < 5 * 60_000) return { created: 0, note: "tick too close" };
  const label = TICK_LABEL[tick.interval_key] || tick.interval_key;
  const when = etTime(tickAt);
  let created = 0;

  if (direction?.enabled) {
    const assets = await activeAssets(pool, { tickAt, count: clampParam("count", direction.params.count ?? 3) });
    for (const asset of assets) {
      const autoKey = `tick-direction:${tickAt.toISOString()}:${asset.symbol}`;
      const market = await createAuto(
        pool,
        {
          title: `${asset.symbol} up on the ${label} tick?`,
          subtitle: `${asset.display_name} · ${when}`,
          rules_text: `Resolves Up if ${asset.display_name} (${asset.symbol}) is priced higher right after the ${label} tick (${when}) than right before it. Down if lower or unchanged. The tick pulls each price toward the talent's fair value. Voids if the tick is skipped.`,
          resolution_source_text: `NASFAQ tick record for ${asset.symbol} at ${when}.`,
          category: "ticks",
          market_type: "binary",
          yes_label: "Up",
          no_label: "Down",
          probability: 0.5,
          closes_at: closesAt,
          resolves_after: tickAt,
          liquidity_b: num(direction.params.liquidity_b, 400),
          fee_bps: num(direction.params.fee_bps, 100),
        },
        { template: "tick-direction", autoKey, autoData: { asset_id: Number(asset.id), symbol: asset.symbol, tick_at: tickAt.toISOString(), interval_key: tick.interval_key } }
      );
      if (market) created += 1;
    }
  }

  if (gainer?.enabled) {
    const count = Math.min(11, Math.max(2, num(gainer.params.count, 6)));
    const assets = await activeAssets(pool, { tickAt, count });
    if (assets.length >= 2) {
      const autoKey = `tick-top-gainer:${tickAt.toISOString()}`;
      const each = 0.45 / assets.length;
      const market = await createAuto(
        pool,
        {
          title: `Top gainer on the ${label} tick?`,
          subtitle: when,
          rules_text: `Resolves to the talent with the biggest percentage move up on the ${label} tick (${when}), measured right before vs right after the tick, across every listed talent. If that isn't one of the named talents, resolves to Someone else. Voids if the tick doesn't run.`,
          resolution_source_text: `NASFAQ tick records at ${when}.`,
          category: "ticks",
          market_type: "multi",
          outcomes: [...assets.map((asset) => ({ label: asset.display_name, asset_symbol: asset.symbol, probability: each })), { label: "Someone else", probability: 0.55 }],
          closes_at: closesAt,
          resolves_after: tickAt,
          liquidity_b: num(gainer.params.liquidity_b, 500),
          fee_bps: num(gainer.params.fee_bps, 100),
        },
        { template: "tick-top-gainer", autoKey, autoData: { tick_at: tickAt.toISOString(), interval_key: tick.interval_key, asset_ids: assets.map((asset) => Number(asset.id)) } }
      );
      if (market) created += 1;
    }
  }
  return { created, tick_at: tickAt.toISOString() };
}

/** The top-gainer question as a pool: the K most active talents on the tick, plus Someone else. */
async function generateTopGainerPool(pool, templates) {
  const template = templates.get("top-gainer-pool");
  if (!template?.enabled) return { created: 0 };
  const tick = await nextTick(pool);
  if (!tick) return { created: 0, note: "no scheduled tick" };
  const tickAt = new Date(tick.scheduled_at);
  const closesAt = new Date(tickAt.getTime() - CLOSE_BEFORE_TICK_MS);
  if (closesAt.getTime() - Date.now() < 5 * 60_000) return { created: 0, note: "tick too close" };
  const label = TICK_LABEL[tick.interval_key] || tick.interval_key;
  const when = etTime(tickAt);
  const assets = await activeAssets(pool, { tickAt, count: Math.min(11, Math.max(2, num(template.params.count, 6))) });
  if (assets.length < 2) return { created: 0, note: "not enough talents on the tick" };
  const market = await createAuto(
    pool,
    {
      title: `Top gainer on the ${label} tick?`,
      subtitle: `Pool · ${when}`,
      rules_text: `The winner is the talent with the biggest percentage move up on the ${label} tick (${when}), measured right before vs right after the tick, across every listed talent. If that isn't one of the named talents, Someone else wins. Voids if the tick doesn't run. Betting closes 5 minutes before the tick.`,
      resolution_source_text: `NASFAQ tick records at ${when}.`,
      category: "ticks",
      options: [...assets.map((asset) => ({ label: asset.display_name, asset_id: Number(asset.id) })), { label: "Someone else" }],
      closes_at: closesAt,
    },
    { template: "top-gainer-pool", autoKey: `top-gainer-pool:${tickAt.toISOString()}`, autoData: { tick_at: tickAt.toISOString(), interval_key: tick.interval_key, asset_ids: assets.map((asset) => Number(asset.id)) } }
  );
  return { created: market ? 1 : 0, tick_at: tickAt.toISOString() };
}

async function resolveTickMarket(pool, market) {
  const data = market.auto_data || {};
  const tickAt = new Date(data.tick_at);
  if (Number.isNaN(tickAt.getTime())) return null;
  // Resolve as soon as the tick's rows are applied (an admin can force a tick early), so nobody
  // trades on a known result; give up and void 2 h after the scheduled time.
  const late = Date.now() - tickAt.getTime() > TICK_GRACE_MS;
  const { rows } = await pool.query(
    `SELECT asset_id, status, price_before, price_after FROM market.asset_adjustment_intervals WHERE scheduled_at = $1 ORDER BY asset_id`,
    [tickAt]
  );
  if (market.auto_template === "tick-direction") {
    const row = rows.find((entry) => String(entry.asset_id) === String(data.asset_id));
    if (!row || row.status === "scheduled") return late ? { outcome: "void", evidence: { reason: "tick did not run" } } : null;
    if (row.status !== "applied") return { outcome: "void", evidence: { reason: `tick ${row.status}` } };
    const before = num(row.price_before);
    const after = num(row.price_after);
    return { outcome: after > before ? "yes" : "no", evidence: { symbol: data.symbol, price_before: before, price_after: after } };
  }
  // top gainer: wait for the whole tick
  if (rows.some((entry) => entry.status === "scheduled") && !late) return null;
  const applied = rows.filter((entry) => entry.status === "applied" && num(entry.price_before) > 0);
  if (!applied.length) return { outcome: "void", evidence: { reason: "tick did not run" } };
  const best = applied.reduce((top, entry) => {
    const move = num(entry.price_after) / num(entry.price_before) - 1;
    return !top || move > top.move ? { asset_id: entry.asset_id, move } : top;
  }, null);
  const outcomes = await core.loadOutcomes(pool, market.id);
  const named = outcomes.find((outcome) => outcome.asset_id && String(outcome.asset_id) === String(best.asset_id));
  const winner = named ?? outcomes[outcomes.length - 1];
  const symbol = (await pool.query(`SELECT symbol FROM market.market_assets WHERE id = $1`, [best.asset_id])).rows[0]?.symbol;
  return { outcome: winner.outcome_code, evidence: { top_gainer: symbol, move_pct: Math.round(best.move * 10_000) / 100 } };
}

// ── Streams ────────────────────────────────────────────────────────────────
/** The median rounded to two significant figures, so the line is readable and stays within 5% of it. */
function niceLine(median) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(median, 1))) - 1);
  return Math.max(step, Math.round(median / step) * step);
}

const fmtViewers = (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k`.replace(".0k", "k") : String(value));

/**
 * Opens a market on a scheduled stream before it starts. Never on one already live: once a stream
 * is on, anyone can watch the viewer count. A stream with no schedule, or one announced too late for
 * MIN_BETTING_MS of betting, gets no market.
 *
 * At most daily_cap in any 24 hours and one per talent, from the `talents` most active talents.
 */
async function generateStreamMarkets(pool, templates, key = "stream-peak") {
  const template = templates.get(key);
  if (!template?.enabled) return { created: 0 };
  const asPool = POOL_TEMPLATES.has(key);
  const params = template.params;
  const dailyCap = streamParam(params, "daily_cap");
  const { rows: recent } = await pool.query(
    `SELECT auto_data->>'symbol' AS symbol FROM market.prediction_markets WHERE auto_template = $1 AND created_at > now() - interval '24 hours'`,
    [key]
  );
  let room = dailyCap - recent.length;
  if (room <= 0) return { created: 0, note: `daily cap of ${dailyCap} reached` };
  const taken = new Set(recent.map((row) => row.symbol));
  const closeLeadMinutes = streamParam(params, "close_lead_minutes");
  const closeLeadMs = closeLeadMinutes * 60_000;
  const minPast = streamParam(params, "min_past_streams");
  const talents = await activeAssets(pool, { count: streamParam(params, "talents") });
  const { rows: upcoming } = await pool.query(
    `SELECT s.video_id, s.video_title, s.scheduled_start_at, s.youtube_channel_id, a.id AS asset_id, a.symbol, a.display_name
     FROM yt.livestream_sessions s JOIN market.market_assets a ON a.youtube_channel_id = s.youtube_channel_id
     WHERE s.status = 'upcoming' AND s.actual_start_at IS NULL
       AND s.last_seen_at > now() - make_interval(secs => $1)
       AND s.scheduled_start_at > now() + make_interval(secs => $2)
       AND s.scheduled_start_at <= now() + make_interval(hours => $3)
       AND a.id = ANY($4::bigint[])
     ORDER BY array_position($4::bigint[], a.id), s.scheduled_start_at`,
    [guards.STREAM_STALE_MS / 1000, (closeLeadMs + MIN_BETTING_MS) / 1000, streamParam(params, "open_lead_hours"), talents.map((talent) => talent.id)]
  );
  let created = 0;
  for (const stream of upcoming) {
    if (room <= 0) break;
    if (taken.has(stream.symbol)) continue;
    const autoKey = `${key}:${stream.video_id}`;
    if (await marketExists(pool, autoKey)) continue;
    const { rows: past } = await pool.query(
      `SELECT max_concurrent_viewers FROM yt.livestream_sessions
       WHERE youtube_channel_id = $1 AND status = 'ended' AND max_concurrent_viewers IS NOT NULL AND video_id <> $2
       ORDER BY actual_start_at DESC LIMIT 10`,
      [stream.youtube_channel_id, stream.video_id]
    );
    if (past.length < minPast) continue;
    const peaks = past.map((row) => num(row.max_concurrent_viewers)).sort((a, b) => a - b);
    const mid = Math.floor(peaks.length / 2);
    const median = peaks.length % 2 ? peaks[mid] : (peaks[mid - 1] + peaks[mid]) / 2;
    const line = niceLine(median);
    const scheduledAt = new Date(stream.scheduled_start_at);
    const closesAt = new Date(scheduledAt.getTime() - closeLeadMs);
    const firstName = stream.display_name.split(" ").pop();
    const market = await createAuto(
      pool,
      {
        title: `${firstName}'s stream peaks above ${fmtViewers(line)}?`,
        subtitle: stream.video_title ? String(stream.video_title).slice(0, 200) : stream.display_name,
        rules_text: `Resolves YES if this stream's peak concurrent viewers reach ${line.toLocaleString("en-US")} or more, as recorded by NASFAQ's stream tracker. The line is ${stream.display_name}'s median peak over their last ${peaks.length} streams. Betting closes ${closeLeadMinutes} minutes before the scheduled start (${etTime(scheduledAt)}), or as soon as the tracker sees the stream go live if that's sooner. If a bet still lands after the real start, the ${asPool ? "pool" : "market"} voids and everyone gets their money back. It also voids if the stream hasn't started within 12 hours of its scheduled time, or ends with no peak on record.`,
        resolution_source_text: `NASFAQ stream tracker for YouTube video ${stream.video_id}.`,
        category: "streams",
        market_type: "binary",
        options: [{ code: "yes", label: "Yes" }, { code: "no", label: "No" }],
        probability: 0.5,
        closes_at: closesAt,
        resolves_after: scheduledAt,
        liquidity_b: num(params.liquidity_b, 500),
        fee_bps: num(params.fee_bps, 100),
      },
      {
        template: key,
        autoKey,
        autoData: {
          video_id: stream.video_id,
          asset_id: Number(stream.asset_id),
          symbol: stream.symbol,
          line,
          median,
          sample: peaks.length,
          scheduled_at: scheduledAt.toISOString(),
          close_lead_minutes: closeLeadMinutes,
          closes_before_start: true,
        },
      }
    );
    if (market) {
      created += 1;
      room -= 1;
      taken.add(stream.symbol);
    }
  }
  return { created };
}

async function resolveStreamMarket(pool, market) {
  const data = market.auto_data || {};
  const { rows } = await pool.query(
    `SELECT s.status, s.actual_start_at, s.max_concurrent_viewers,
            (SELECT MAX(b.max_viewers) FROM yt.livestream_viewer_buckets_5m b WHERE b.livestream_video_id = s.video_id) AS bucket_peak
     FROM yt.livestream_sessions s WHERE s.video_id = $1`,
    [data.video_id]
  );
  const stream = rows[0];
  const line = num(data.line);
  const startedAt = stream?.actual_start_at ? new Date(stream.actual_start_at) : null;
  // The last line of defense: the tracker can learn of a start after the fact, and a bet placed in
  // between must never pay. Markets from before this rule opened after the start, so it can't apply.
  if (data.closes_before_start && startedAt) {
    const { rows: late } = await pool.query(
      market.pricing === "pool"
        ? `SELECT COUNT(*)::int AS trades FROM market.prediction_pool_bets WHERE market_id = $1 AND created_at >= $2`
        : `SELECT COUNT(*)::int AS trades FROM market.prediction_market_trades WHERE market_id = $1 AND matched_at >= $2`,
      [market.id, startedAt]
    );
    if (late[0].trades > 0) return { outcome: "void", evidence: { reason: "A bet landed after the stream started", late_trades: late[0].trades, started_at: startedAt.toISOString(), line } };
  }
  // The session's peak is only written when the stream ends; its 5-minute buckets have the running one.
  const known = [stream?.max_concurrent_viewers, stream?.bucket_peak].filter((value) => value !== null && value !== undefined).map((value) => num(value));
  const peak = known.length ? Math.max(...known) : null;
  if (peak !== null && peak >= line) return { outcome: "yes", evidence: { peak, line } };
  if (stream?.status === "ended") return peak === null ? { outcome: "void", evidence: { reason: "no peak recorded", line } } : { outcome: "no", evidence: { peak, line } };
  const since = new Date(startedAt || data.started_at || data.scheduled_at || market.opens_at).getTime();
  if (Date.now() - since > STREAM_GIVE_UP_MS) return { outcome: "void", evidence: { reason: startedAt || data.started_at ? "stream still unresolved after 12h" : "stream didn't start within 12h of its scheduled time", line } };
  return null;
}

// ── Resolution ─────────────────────────────────────────────────────────────
/** System resolution: closes if needed, records a finalized proposal with the data, settles. */
async function resolveBySystem(pool, marketId, { outcome, evidence }) {
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (!["open", "closed", "resolving"].includes(market.status)) return null;
    if (market.status === "open") await resolution.closeWithClient(client, market, { reason: "resolved_by_data" });
    if (market.pricing === "pool") {
      if (outcome === "void") return pools.voidWithClient(client, market, { reason: evidence?.reason || "Voided by data", evidence });
      const winner = (await core.loadOutcomes(client, market.id)).find((entry) => entry.outcome_code === outcome);
      if (!winner) throw predictionError("invalid_outcome");
      return pools.settleWithClient(client, market, winner, { note: "Resolved automatically from NASFAQ data.", evidence });
    }
    const proposal = await resolution.insertProposal(client, market, {
      proposerId: null,
      outcomeCode: outcome,
      sourceUrl: null,
      note: "Resolved automatically from NASFAQ data.",
      evidence,
      windowHours: 0,
    });
    await client.query(`UPDATE market.prediction_resolution_proposals SET status = 'finalized', finalized_at = now() WHERE id = $1`, [proposal.id]);
    await core.logEvent(client, market.id, "resolution_finalized", { proposal_id: Number(proposal.id), automatic: true, evidence });
    if (outcome === "void") return resolution.voidWithClient(client, market, { reason: evidence?.reason || "Voided by data" });
    return resolution.settleWithClient(client, market, proposal.outcome_id);
  });
}

/**
 * Closes whatever guards.js has locked, every scheduler cycle, so the page and the trade path agree
 * and resting orders go back. First, a stream moved earlier pulls its market's close in with it (a
 * stream moved later keeps the close it has: an early close never lets anyone bet on a known result).
 */
async function closeLockedMarkets(pool) {
  await pool.query(
    `UPDATE market.prediction_markets m
     SET closes_at = GREATEST(s.scheduled_start_at - make_interval(mins => (m.auto_data->>'close_lead_minutes')::int), m.opens_at + interval '1 second'), updated_at = now()
     FROM yt.livestream_sessions s
     WHERE m.kind = 'auto' AND m.auto_template IN ('stream-peak', 'stream-peak-pool') AND m.status = 'open' AND m.auto_data ? 'close_lead_minutes'
       AND s.video_id = m.auto_data->>'video_id' AND s.scheduled_start_at IS NOT NULL
       AND s.scheduled_start_at - make_interval(mins => (m.auto_data->>'close_lead_minutes')::int) < m.closes_at`
  );
  const { rows } = await pool.query(`SELECT * FROM market.prediction_markets WHERE kind = 'auto' AND status = 'open' ORDER BY closes_at LIMIT 200`);
  const closed = [];
  for (const market of rows) {
    const lock = await guards.autoMarketLock(pool, market);
    if (!lock) continue;
    const done = await core.inTransaction(pool, async (client) => {
      const fresh = await core.lockMarket(client, { id: market.id });
      if (fresh.status !== "open") return null;
      await resolution.closeWithClient(client, fresh, { reason: lock });
      return { id: Number(fresh.id), slug: fresh.slug, pricing: fresh.pricing };
    });
    if (done) closed.push(done);
  }
  return closed;
}

async function resolveAutoMarkets(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM market.prediction_markets WHERE kind = 'auto' AND status IN ('open', 'closed') ORDER BY closes_at LIMIT 200`
  );
  const resolved = [];
  for (const market of rows) {
    let call = null;
    try {
      if (TICK_TEMPLATES.has(market.auto_template)) call = await resolveTickMarket(pool, market);
      else if (STREAM_TEMPLATES.has(market.auto_template)) call = await resolveStreamMarket(pool, market);
      if (!call) continue;
      const result = await resolveBySystem(pool, market.id, call);
      if (result) resolved.push(result);
    } catch (error) {
      console.error(`prediction auto-resolve failed for ${market.slug}:`, error?.message || error);
    }
  }
  return resolved;
}

async function runAutoTemplates(pool) {
  const templates = await loadTemplates(pool);
  const results = {};
  for (const [key, run] of [
    ["tick", generateTickMarkets],
    ["stream-peak", generateStreamMarkets],
    ["stream-peak-pool", (db, loaded) => generateStreamMarkets(db, loaded, "stream-peak-pool")],
    ["top-gainer-pool", generateTopGainerPool],
  ]) {
    try {
      results[key] = await run(pool, templates);
    } catch (error) {
      results[key] = { error: String(error?.message || error) };
    }
  }
  for (const key of ["tick-direction", "tick-top-gainer"]) if (templates.get(key)?.enabled) await recordRun(pool, key, results.tick);
  for (const key of ["stream-peak", "stream-peak-pool", "top-gainer-pool"]) if (templates.get(key)?.enabled) await recordRun(pool, key, results[key]);
  return results;
}

async function updateTemplate(pool, actor, key, { enabled, params }) {
  if (!actor?.is_admin && !actor?.can_resolve_prediction_markets) throw predictionError("forbidden");
  const { rows } = await pool.query(`SELECT * FROM market.prediction_auto_templates WHERE key = $1`, [key]);
  if (!rows[0]) throw predictionError("template_not_found");
  // Once pools are on for everyone, the market-maker templates stay off (predictions-pools.md §4).
  if (enabled === true && !POOL_TEMPLATES.has(key) && features.enabledFor("prediction-pools", "everyone")) throw predictionError("lmsr_retired");
  const next = { ...(rows[0].params_json || {}) };
  for (const field of Object.keys(PARAM_LIMITS)) {
    if (params && params[field] !== undefined && Number.isFinite(Number(params[field]))) next[field] = clampParam(field, params[field]);
  }
  const { rows: updated } = await pool.query(
    `UPDATE market.prediction_auto_templates SET enabled = COALESCE($2, enabled), params_json = $3, updated_at = now() WHERE key = $1 RETURNING *`,
    [key, typeof enabled === "boolean" ? enabled : null, JSON.stringify(next)]
  );
  return { key, enabled: updated[0].enabled, params: updated[0].params_json };
}

module.exports = { TICKS_WITH_MARKETS, closeLockedMarkets, niceLine, resolveAutoMarkets, resolveBySystem, runAutoTemplates, updateTemplate };
