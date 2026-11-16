// The stream calendar (/livestreams/calendar): listed talents' streams from a day ago to a week out,
// live and upcoming first-class, finished ones kept so today's column reads whole.
//
// Same source as the stream-peak predictions (services/predictions/auto.js): yt.livestream_sessions,
// which the scraper refreshes on every poll (LIVE_POLL_SECONDS, 30 minutes in production). An
// upcoming slot counts while the scraper still sees it (guards.STREAM_STALE_MS, three missed polls);
// one that stops showing up was cancelled or made private.
//
// A stream's bet is its open stream-peak market or stream-peak pool. This response is cached once for
// everyone, so pools only show here while the prediction-pools flag is on for everyone.

const features = require("../features");
const { STREAM_STALE_MS } = require("./predictions/guards");

const HOUR_MS = 3_600_000;
/** How far back finished streams go: yesterday evening still shows in a viewer's "today". */
const PAST_HOURS = 30;
/** How long an upcoming slot can run late and still be "waiting to start". */
const LATE_HOURS = 12;
const MAX_DAYS = 8;

function clampDays(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_DAYS) : 7;
}

async function getStreamCalendar(pool, { now = new Date(), days = 7 } = {}) {
  const span = clampDays(days);
  const from = new Date(now.getTime() - PAST_HOURS * HOUR_MS);
  const to = new Date(now.getTime() + span * 24 * HOUR_MS);
  const poolKey = features.enabledFor("prediction-pools", "everyone") ? `, 'stream-peak-pool:' || s.video_id` : "";
  const { rows } = await pool.query(
    `
    SELECT
      s.video_id,
      s.status,
      s.video_title AS title,
      s.thumbnail_url,
      s.scheduled_start_at,
      s.actual_start_at,
      s.ended_at,
      s.max_concurrent_viewers::float8 AS peak_viewers,
      a.symbol,
      a.display_name,
      c.icon,
      c.color,
      pm.slug AS prediction_slug,
      pm.title AS prediction_title,
      pm.pricing AS prediction_pricing
    FROM yt.livestream_sessions s
    JOIN market.market_assets a ON a.youtube_channel_id = s.youtube_channel_id AND a.status IN ('active', 'halted')
    JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    LEFT JOIN LATERAL (
      SELECT m.slug, m.title, m.pricing
      FROM market.prediction_markets m
      WHERE m.auto_key IN ('stream-peak:' || s.video_id${poolKey}) AND m.status = 'open' AND m.closes_at > $1
      ORDER BY m.pricing = 'pool' DESC
      LIMIT 1
    ) pm ON true
    WHERE (
        s.status = 'upcoming' AND s.actual_start_at IS NULL
        AND s.last_seen_at > $1 - make_interval(secs => $4)
        AND s.scheduled_start_at > $1 - make_interval(hours => $5)
        AND s.scheduled_start_at <= $3
      )
      OR (s.status = 'live' AND s.last_seen_at > $1 - make_interval(secs => $4))
      OR (s.status = 'ended' AND s.actual_start_at >= $2 AND s.actual_start_at <= $1)
    ORDER BY COALESCE(s.actual_start_at, s.scheduled_start_at) ASC, s.video_id ASC
    LIMIT 2000
  `,
    [now, from, to, STREAM_STALE_MS / 1000, LATE_HOURS]
  );

  return {
    generated_at: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    streams: rows.map((row) => {
      const startsAt = row.actual_start_at ?? row.scheduled_start_at;
      return {
        video_id: row.video_id,
        state: row.status === "live" ? "live" : row.status === "ended" ? "ended" : startsAt && new Date(startsAt) < now ? "late" : "upcoming",
        title: row.title ?? null,
        thumbnail_url: row.thumbnail_url ?? null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        scheduled_at: row.scheduled_start_at ? new Date(row.scheduled_start_at).toISOString() : null,
        ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
        peak_viewers: row.status === "upcoming" ? null : row.peak_viewers,
        symbol: row.symbol,
        display_name: row.display_name,
        icon: row.icon ?? null,
        color: row.color ?? null,
        prediction: row.prediction_slug ? { slug: row.prediction_slug, title: row.prediction_title, pricing: row.prediction_pricing } : null,
      };
    }),
  };
}

module.exports = { getStreamCalendar };
