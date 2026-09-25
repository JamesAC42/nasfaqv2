// Auto markets (docs/predictions/PREDICTIONS_DESIGN.md §6): opened and resolved by the scheduler
// from site data. Idempotent: each market has a unique auto_key, so reruns never duplicate.
//
//   tick-direction   "PEK up on the Late tick?"          ← asset_adjustment_intervals
//   tick-top-gainer  "Top gainer on the Late tick?"      ← asset_adjustment_intervals
//   stream-peak      "Marine's stream peaks above 45k?"  ← yt.livestream_sessions

const core = require("./core");
const markets = require("./markets");
const resolution = require("./resolution");

const { num, predictionError } = core;

const TICK_LABEL = { open: "Open", lunch: "Lunch", late: "Late", overnight: "Overnight" };
const CLOSE_BEFORE_TICK_MS = 5 * 60_000;
const TICK_GRACE_MS = 2 * 3_600_000;
const STREAM_WINDOW_MS = 30 * 60_000;
const STREAM_GIVE_UP_MS = 12 * 3_600_000;

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
      markets.createMarketWithClient(client, { ...input, publish: true }, { status: "open", kind: "auto", autoTemplate: template, autoKey, autoData })
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
     WHERE status = 'scheduled' AND scheduled_at > now() + interval '10 minutes'
     GROUP BY scheduled_at, interval_key ORDER BY scheduled_at LIMIT 1`
  );
  return rows[0] || null;
}

/** The K most active talents that have a scheduled interval at this tick. */
async function activeAssets(pool, tickAt, count) {
  const { rows } = await pool.query(
    `SELECT a.id, a.symbol, a.display_name, COALESCE(v.volume, 0) AS volume, COALESCE(h.holders, 0) AS holders
     FROM market.market_assets a
     JOIN market.asset_adjustment_intervals i ON i.asset_id = a.id AND i.scheduled_at = $1 AND i.status = 'scheduled'
     LEFT JOIN (SELECT asset_id, SUM(quantity) AS volume FROM market.trade_fills WHERE ts > now() - interval '24 hours' GROUP BY asset_id) v ON v.asset_id = a.id
     LEFT JOIN (SELECT asset_id, COUNT(*) AS holders FROM market.portfolio_holdings WHERE quantity > 0 GROUP BY asset_id) h ON h.asset_id = a.id
     WHERE a.status = 'active'
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
    const assets = await activeAssets(pool, tickAt, Math.min(20, Math.max(1, num(direction.params.count, 6))));
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
          liquidity_b: num(direction.params.liquidity_b, 120),
          fee_bps: num(direction.params.fee_bps, 100),
        },
        { template: "tick-direction", autoKey, autoData: { asset_id: Number(asset.id), symbol: asset.symbol, tick_at: tickAt.toISOString(), interval_key: tick.interval_key } }
      );
      if (market) created += 1;
    }
  }

  if (gainer?.enabled) {
    const count = Math.min(11, Math.max(2, num(gainer.params.count, 6)));
    const assets = await activeAssets(pool, tickAt, count);
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
          liquidity_b: num(gainer.params.liquidity_b, 150),
          fee_bps: num(gainer.params.fee_bps, 100),
        },
        { template: "tick-top-gainer", autoKey, autoData: { tick_at: tickAt.toISOString(), interval_key: tick.interval_key, asset_ids: assets.map((asset) => Number(asset.id)) } }
      );
      if (market) created += 1;
    }
  }
  return { created, tick_at: tickAt.toISOString() };
}

async function resolveTickMarket(pool, market) {
  const data = market.auto_data || {};
  const tickAt = new Date(data.tick_at);
  if (Number.isNaN(tickAt.getTime())) return null;
  // Resolve as soon as the tick's rows are applied (an admin can force a tick early), so nobody
  // trades on a known result; give up and void 2 h after the scheduled time.
  const late = Date.now() - tickAt.getTime() > TICK_GRACE_MS;
  const { rows } = await pool.query(
    `SELECT asset_id, status, price_before, price_after FROM market.asset_adjustment_intervals WHERE scheduled_at = $1`,
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
function niceLine(median) {
  if (median < 20_000) return Math.max(1000, Math.round(median / 1000) * 1000);
  return Math.round(median / 5000) * 5000;
}

const fmtViewers = (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k`.replace(".0k", "k") : String(value));

async function generateStreamMarkets(pool, templates) {
  const template = templates.get("stream-peak");
  if (!template?.enabled) return { created: 0 };
  const minPast = Math.max(1, num(template.params.min_past_streams, 3));
  const { rows: live } = await pool.query(
    `SELECT s.video_id, s.video_title, s.actual_start_at, s.youtube_channel_id, a.id AS asset_id, a.symbol, a.display_name
     FROM yt.livestream_sessions s JOIN market.market_assets a ON a.youtube_channel_id = s.youtube_channel_id
     WHERE s.status = 'live' AND s.actual_start_at > now() - interval '20 minutes' AND a.status = 'active'`
  );
  let created = 0;
  for (const stream of live) {
    const autoKey = `stream-peak:${stream.video_id}`;
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
    const closesAt = new Date(new Date(stream.actual_start_at).getTime() + STREAM_WINDOW_MS);
    if (closesAt.getTime() - Date.now() < 3 * 60_000) continue;
    const firstName = stream.display_name.split(" ").pop();
    const market = await createAuto(
      pool,
      {
        title: `${firstName}'s stream peaks above ${fmtViewers(line)}?`,
        subtitle: stream.video_title ? String(stream.video_title).slice(0, 200) : stream.display_name,
        rules_text: `Resolves YES if this stream's peak concurrent viewers reach ${line.toLocaleString("en-US")} or more, as recorded by NASFAQ's stream tracker when the stream ends. The line is ${stream.display_name}'s median peak over their last ${peaks.length} streams. Resolves YES as soon as the peak crosses the line. Voids if the tracker has no peak within 12 hours.`,
        resolution_source_text: `NASFAQ stream tracker for YouTube video ${stream.video_id}.`,
        category: "streams",
        market_type: "binary",
        probability: 0.5,
        closes_at: closesAt,
        resolves_after: closesAt,
        liquidity_b: num(template.params.liquidity_b, 150),
        fee_bps: num(template.params.fee_bps, 100),
      },
      { template: "stream-peak", autoKey, autoData: { video_id: stream.video_id, asset_id: Number(stream.asset_id), symbol: stream.symbol, line, median, sample: peaks.length, started_at: stream.actual_start_at } }
    );
    if (market) created += 1;
  }
  return { created };
}

async function resolveStreamMarket(pool, market) {
  const data = market.auto_data || {};
  const { rows } = await pool.query(`SELECT status, max_concurrent_viewers, ended_at FROM yt.livestream_sessions WHERE video_id = $1`, [data.video_id]);
  const stream = rows[0];
  const line = num(data.line);
  const peak = stream?.max_concurrent_viewers === null || stream?.max_concurrent_viewers === undefined ? null : num(stream.max_concurrent_viewers);
  if (peak !== null && peak >= line) return { outcome: "yes", evidence: { peak, line } };
  if (stream?.status === "ended") return peak === null ? { outcome: "void", evidence: { reason: "no peak recorded", line } } : { outcome: "no", evidence: { peak, line } };
  const started = new Date(data.started_at || market.opens_at).getTime();
  if (Date.now() - started > STREAM_GIVE_UP_MS) return { outcome: "void", evidence: { reason: "stream still unresolved after 12h", line } };
  return null;
}

// ── Resolution ─────────────────────────────────────────────────────────────
/** System resolution: closes if needed, records a finalized proposal with the data, settles. */
async function resolveBySystem(pool, marketId, { outcome, evidence }) {
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (!["open", "closed", "resolving"].includes(market.status)) return null;
    if (market.status === "open") await resolution.closeWithClient(client, market, { reason: "resolved_by_data" });
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

async function resolveAutoMarkets(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM market.prediction_markets WHERE kind = 'auto' AND status IN ('open', 'closed') ORDER BY closes_at LIMIT 200`
  );
  const resolved = [];
  for (const market of rows) {
    let call = null;
    try {
      if (market.auto_template === "tick-direction" || market.auto_template === "tick-top-gainer") call = await resolveTickMarket(pool, market);
      else if (market.auto_template === "stream-peak") call = await resolveStreamMarket(pool, market);
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
  ]) {
    try {
      results[key] = await run(pool, templates);
    } catch (error) {
      results[key] = { error: String(error?.message || error) };
    }
  }
  for (const key of ["tick-direction", "tick-top-gainer"]) if (templates.get(key)?.enabled) await recordRun(pool, key, results.tick);
  if (templates.get("stream-peak")?.enabled) await recordRun(pool, "stream-peak", results["stream-peak"]);
  return results;
}

async function updateTemplate(pool, actor, key, { enabled, params }) {
  if (!actor?.is_admin && !actor?.can_resolve_prediction_markets) throw predictionError("forbidden");
  const { rows } = await pool.query(`SELECT * FROM market.prediction_auto_templates WHERE key = $1`, [key]);
  if (!rows[0]) throw predictionError("template_not_found");
  const next = { ...(rows[0].params_json || {}) };
  for (const field of ["count", "liquidity_b", "fee_bps", "min_past_streams"]) {
    if (params && params[field] !== undefined && Number.isFinite(Number(params[field]))) next[field] = Number(params[field]);
  }
  if (next.liquidity_b !== undefined) next.liquidity_b = Math.min(100_000, Math.max(10, next.liquidity_b));
  if (next.fee_bps !== undefined) next.fee_bps = Math.min(1000, Math.max(0, Math.round(next.fee_bps)));
  if (next.count !== undefined) next.count = Math.min(20, Math.max(1, Math.round(next.count)));
  const { rows: updated } = await pool.query(
    `UPDATE market.prediction_auto_templates SET enabled = COALESCE($2, enabled), params_json = $3, updated_at = now() WHERE key = $1 RETURNING *`,
    [key, typeof enabled === "boolean" ? enabled : null, JSON.stringify(next)]
  );
  return { key, enabled: updated[0].enabled, params: updated[0].params_json };
}

module.exports = { niceLine, resolveAutoMarkets, resolveBySystem, runAutoTemplates, updateTemplate };
