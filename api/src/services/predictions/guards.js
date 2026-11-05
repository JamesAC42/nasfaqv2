// Server-side locks on auto markets (docs/predictions/PREDICTIONS_DESIGN.md §6). closes_at is only
// the schedule. These read the data an auto market's outcome depends on, so a bet is refused as soon
// as that data could give the result away, even if the scheduler hasn't closed the market yet.
//
// trading.js checks them on every buy, sell and limit-order fill, with the market row locked. The
// scheduler closes whatever they lock (auto.closeLockedMarkets). They fail closed: if the data is
// missing or stale, nobody bets.

const core = require("./core");

const { num } = core;

// The scraper writes last_seen_at for every open stream each poll (LIVE_POLL_SECONDS, 30 minutes in
// production). Three missed polls means it's down or out of quota, so "not started" means nothing.
const STREAM_STALE_MS = 90 * 60_000;
const DEFAULT_CLOSE_LEAD_MINUTES = 15;

async function streamLock(db, market, now) {
  const data = market.auto_data || {};
  const { rows } = await db.query(`SELECT status, scheduled_start_at, actual_start_at, last_seen_at FROM yt.livestream_sessions WHERE video_id = $1`, [data.video_id]);
  const stream = rows[0];
  if (!stream) return "stream_missing";
  if (stream.status !== "upcoming" || stream.actual_start_at) return "stream_started";
  if (!stream.scheduled_start_at) return "stream_unscheduled";
  const leadMs = num(data.close_lead_minutes, DEFAULT_CLOSE_LEAD_MINUTES) * 60_000;
  if (now.getTime() >= new Date(stream.scheduled_start_at).getTime() - leadMs) return "stream_starting";
  if (now.getTime() - new Date(stream.last_seen_at).getTime() > STREAM_STALE_MS) return "stream_data_stale";
  return null;
}

/** A tick an admin forced early, or one that's already landing: its result is public. */
async function tickLock(db, market) {
  const data = market.auto_data || {};
  if (!data.tick_at) return "tick_unknown";
  if (market.auto_template === "tick-direction") {
    const { rows } = await db.query(`SELECT status FROM market.asset_adjustment_intervals WHERE scheduled_at = $1 AND asset_id = $2`, [data.tick_at, data.asset_id]);
    return rows.some((row) => row.status === "scheduled") ? null : "tick_landed";
  }
  const { rows } = await db.query(`SELECT status FROM market.asset_adjustment_intervals WHERE scheduled_at = $1`, [data.tick_at]);
  return rows.length && rows.every((row) => row.status === "scheduled") ? null : "tick_landed";
}

/** Why betting is shut on this market right now, or null. Event markets have no data to check. */
async function autoMarketLock(db, market, now = new Date()) {
  if (market.kind !== "auto") return null;
  const { rows } = await db.query(`SELECT enabled FROM market.prediction_auto_templates WHERE key = $1`, [market.auto_template]);
  if (!rows[0]?.enabled) return "template_off";
  if (market.auto_template === "stream-peak") return streamLock(db, market, now);
  if (market.auto_template === "tick-direction" || market.auto_template === "tick-top-gainer") return tickLock(db, market);
  return "template_unknown";
}

module.exports = { DEFAULT_CLOSE_LEAD_MINUTES, STREAM_STALE_MS, autoMarketLock };
