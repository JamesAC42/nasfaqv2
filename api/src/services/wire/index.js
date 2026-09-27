// The Wire: short automatic headlines from facts the site already has, so the front page has
// news every day even when no HoloNews rollup is out. Every item is a checked fact (a stream the
// talent scheduled, a subscriber count, a sale); code writes the words from templates, so nothing
// here can invent a claim about a real person.
//
// Sources: stream events judged from titles (streams.js; Jev when configured), subscriber
// milestones, viewer records, the day's top superchat stream, market movers, big card-exchange
// sales, UR pulls and resolved prediction markets. A scheduler runs every 10 minutes; items are
// keyed (dedupe_key) so each fact is posted once. Stream items refresh their live/upcoming state.

const crypto = require("node:crypto");
const streams = require("./streams");

const THUMB = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
const WATCH = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

const pick = (seed, options) => options[parseInt(crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 8), 16) % options.length];
const compact = (value) => {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
};
const money = (value) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yen = (value) => `¥${Math.round(Number(value)).toLocaleString("en-US")}`;
const quote = (title) => `“${String(title).replace(/\s+/g, " ").trim().slice(0, 140)}”`;

async function upsert(pool, item, { refresh = false } = {}) {
  const { rowCount } = await pool.query(
    `
    INSERT INTO content.wire_items (kind, dedupe_key, headline, blurb, symbols, image_url, link_url, importance, occurred_at, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (dedupe_key) DO ${refresh ? "UPDATE SET meta = EXCLUDED.meta, occurred_at = EXCLUDED.occurred_at, image_url = COALESCE(EXCLUDED.image_url, content.wire_items.image_url)" : "NOTHING"}
  `,
    [item.kind, item.dedupe_key, item.headline, item.blurb ?? null, item.symbols ?? [], item.image_url ?? null, item.link_url ?? null, item.importance ?? 1, item.occurred_at, JSON.stringify(item.meta ?? {})]
  );
  return rowCount;
}

// ── Stream events ──────────────────────────────────────────────────────────
const STREAM_HEADLINES = {
  three_d: ["{name} is going 3D", "{name} steps into 3D", "3D LIVE: {name}"],
  new_outfit: ["{name} has a new look", "New outfit reveal from {name}", "{name} unveils a new outfit"],
  original_song: ["New original song from {name}", "{name} premieres an original song", "{name} drops a new song"],
  cover_song: ["{name} releases a new cover", "New cover from {name}"],
  birthday: ["It's {name}'s birthday", "Happy birthday, {name}", "{name}'s birthday stream"],
  anniversary: ["{name} celebrates an anniversary", "Anniversary stream for {name}"],
  milestone: ["{name} celebrates a subscriber milestone", "Milestone stream for {name}"],
  announcement: ["{name} has an announcement stream scheduled", "Announcement stream from {name}"],
  endurance: ["{name} is on an endurance stream", "Endurance run: {name}"],
};
const STREAM_IMPORTANCE = { three_d: 5, new_outfit: 4, original_song: 4, anniversary: 4, birthday: 3, milestone: 3, announcement: 3, cover_song: 2, endurance: 2 };

async function streamEvents(pool) {
  const labeled = await streams.labelRecentStreams(pool);
  const { rows } = await pool.query(
    `
    SELECT s.video_id, s.video_title, s.status, s.scheduled_start_at, s.actual_start_at, s.ended_at, s.thumbnail_url,
           s.max_concurrent_viewers, l.event, l.classifier, l.confidence,
           COALESCE(c.name_english, c.name_short) AS name, a.symbol
    FROM yt.livestream_sessions s
    JOIN content.wire_stream_labels l ON l.video_id = s.video_id
    JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    LEFT JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE l.event = ANY($1::text[])
      AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) > now() - interval '72 hours'
  `,
    [[...streams.NEWSWORTHY]]
  );
  let added = 0;
  for (const row of rows) {
    const headline = pick(row.video_id, STREAM_HEADLINES[row.event] ?? ["{name} is streaming"]).replace("{name}", row.name);
    added += await upsert(
      pool,
      {
        kind: `stream_${row.event}`,
        dedupe_key: `stream:${row.video_id}`,
        headline,
        blurb: quote(row.video_title),
        symbols: row.symbol ? [row.symbol] : [],
        image_url: row.thumbnail_url || THUMB(row.video_id),
        link_url: WATCH(row.video_id),
        importance: STREAM_IMPORTANCE[row.event] ?? 2,
        occurred_at: row.actual_start_at || row.scheduled_start_at || new Date(),
        meta: {
          event: row.event,
          status: row.status,
          starts_at: row.scheduled_start_at,
          started_at: row.actual_start_at,
          ended_at: row.ended_at,
          peak_viewers: row.max_concurrent_viewers ? Number(row.max_concurrent_viewers) : null,
          judged_by: row.classifier,
          confidence: row.confidence === null ? null : Number(row.confidence),
          video_id: row.video_id,
        },
      },
      { refresh: true }
    );
  }
  return { ...labeled, items: added };
}

// ── Subscriber milestones ─────────────────────────────────────────────────
function milestoneStep(count) {
  if (count < 1_000_000) return 100_000;
  if (count < 3_000_000) return 250_000;
  return 500_000;
}

async function subscriberMilestones(pool) {
  const { rows } = await pool.query(`
    WITH days AS (
      SELECT s.youtube_channel_id, s.time, s.subscriber_count,
             LAG(s.subscriber_count) OVER (PARTITION BY s.youtube_channel_id ORDER BY s.time) AS previous
      FROM yt.youtube_channel_daily_stats s
      WHERE s.time > now() - interval '5 days' AND NOT COALESCE(s.hidden_subscriber_count, false)
    )
    SELECT d.*, COALESCE(c.name_english, c.name_short) AS name, a.symbol
    FROM days d
    JOIN yt.youtube_channels c ON c.youtube_channel_id = d.youtube_channel_id
    LEFT JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE d.previous IS NOT NULL AND d.subscriber_count > d.previous AND d.time > now() - interval '3 days'
  `);
  let added = 0;
  for (const row of rows) {
    const now = Number(row.subscriber_count);
    const before = Number(row.previous);
    const step = milestoneStep(before);
    const crossed = Math.floor(now / step) * step;
    if (crossed <= before || crossed < 100_000) continue;
    added += await upsert(pool, {
      kind: "subscriber_milestone",
      dedupe_key: `subs:${row.youtube_channel_id}:${crossed}`,
      headline: pick(`${row.youtube_channel_id}:${crossed}`, ["{name} passes {n} subscribers", "{name} hits {n} subscribers", "{n} subscribers for {name}"])
        .replace("{name}", row.name)
        .replace("{n}", compact(crossed)),
      blurb: `Now at ${now.toLocaleString("en-US")} subscribers.`,
      symbols: row.symbol ? [row.symbol] : [],
      link_url: row.symbol ? `/stocks/${row.symbol}` : null,
      importance: crossed % 1_000_000 === 0 ? 5 : 3,
      occurred_at: row.time,
      meta: { subscribers: now, milestone: crossed },
    });
  }
  return { items: added };
}

// ── Viewer records ────────────────────────────────────────────────────────
async function viewerRecords(pool) {
  const { rows } = await pool.query(`
    SELECT s.video_id, s.video_title, s.max_concurrent_viewers AS peak, s.actual_start_at, s.ended_at, s.thumbnail_url,
           COALESCE(c.name_english, c.name_short) AS name, a.symbol,
           (SELECT max(p.max_concurrent_viewers) FROM yt.livestream_sessions p
             WHERE p.youtube_channel_id = s.youtube_channel_id AND p.video_id <> s.video_id
               AND p.actual_start_at > s.actual_start_at - interval '90 days' AND p.actual_start_at < s.actual_start_at) AS previous_best
    FROM yt.livestream_sessions s
    JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    LEFT JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE s.status = 'ended' AND s.ended_at > now() - interval '36 hours' AND s.max_concurrent_viewers >= 5000
  `);
  let added = 0;
  for (const row of rows) {
    const peak = Number(row.peak);
    const best = row.previous_best === null ? null : Number(row.previous_best);
    if (best === null || peak <= best * 1.05) continue;
    added += await upsert(pool, {
      kind: "viewer_record",
      dedupe_key: `peak:${row.video_id}`,
      headline: `${row.name} pulls ${compact(peak)} live viewers, a 90-day high`,
      blurb: `${quote(row.video_title)} beat the channel's previous best of ${compact(best)}.`,
      symbols: row.symbol ? [row.symbol] : [],
      image_url: row.thumbnail_url || THUMB(row.video_id),
      link_url: WATCH(row.video_id),
      importance: 4,
      occurred_at: row.ended_at,
      meta: { peak, previous_best: best, video_id: row.video_id },
    });
  }
  return { items: added };
}

// ── The day's top superchat stream ────────────────────────────────────────
async function superchatLeader(pool) {
  const { rows } = await pool.query(`
    SELECT sc.date, sc.video_id, sc.superchat_total, s.video_title, s.thumbnail_url,
           COALESCE(c.name_english, c.name_short) AS name, a.symbol
    FROM yt.youtube_superchats sc
    LEFT JOIN yt.livestream_sessions s ON s.video_id = sc.video_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    LEFT JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE sc.date >= current_date - 2 AND c.youtube_channel_id IS NOT NULL
    ORDER BY sc.date DESC, sc.superchat_total DESC
  `);
  const topByDay = new Map();
  for (const row of rows) if (!topByDay.has(String(row.date))) topByDay.set(String(row.date), row);
  let added = 0;
  for (const row of topByDay.values()) {
    if (Number(row.superchat_total) < 100_000) continue;
    const day = new Date(row.date).toISOString().slice(0, 10);
    added += await upsert(pool, {
      kind: "superchat_leader",
      dedupe_key: `sc:${day}`,
      headline: `${row.name} tops the day's superchats with ${yen(row.superchat_total)}`,
      blurb: row.video_title ? quote(row.video_title) : null,
      symbols: row.symbol ? [row.symbol] : [],
      image_url: row.thumbnail_url || THUMB(row.video_id),
      link_url: WATCH(row.video_id),
      importance: 3,
      occurred_at: new Date(`${day}T23:00:00Z`),
      meta: { total_yen: Number(row.superchat_total), video_id: row.video_id, date: day },
    });
  }
  return { items: added };
}

// ── Market movers (after each settlement) ─────────────────────────────────
async function marketMovers(pool) {
  const { rows } = await pool.query(`
    WITH dates AS (SELECT DISTINCT market_date FROM market.asset_daily_market_state ORDER BY market_date DESC LIMIT 2),
    pair AS (
      SELECT a.symbol, a.display_name, d.market_date, d.mid_close,
             LAG(d.mid_close) OVER (PARTITION BY d.asset_id ORDER BY d.market_date) AS previous
      FROM market.asset_daily_market_state d
      JOIN market.market_assets a ON a.id = d.asset_id
      WHERE d.market_date IN (SELECT market_date FROM dates) AND a.status = 'active'
    )
    SELECT symbol, display_name, market_date, mid_close, previous, (mid_close - previous) / NULLIF(previous, 0) AS change
    FROM pair WHERE previous IS NOT NULL AND previous > 0
  `);
  if (!rows.length) return { items: 0 };
  const sorted = [...rows].sort((a, b) => Number(b.change) - Number(a.change));
  const day = new Date(rows[0].market_date).toISOString().slice(0, 10);
  let added = 0;
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (Number(top.change) >= 0.03) {
    added += await upsert(pool, {
      kind: "market_mover",
      dedupe_key: `mover:${day}:up`,
      headline: pick(day, ["{sym} leads the board, up {pct}", "{name} stock jumps {pct}", "Top gainer: {sym} +{pct}"])
        .replace("{sym}", top.symbol)
        .replace("{name}", top.display_name)
        .replace("{pct}", `${(Number(top.change) * 100).toFixed(1)}%`),
      blurb: `Closed at ${money(top.mid_close)} after the ${day} settlement.`,
      symbols: [top.symbol],
      link_url: `/stocks/${top.symbol}`,
      importance: 2,
      occurred_at: new Date(),
      meta: { change: Number(top.change), close: Number(top.mid_close), date: day },
    });
  }
  if (Number(bottom.change) <= -0.03) {
    added += await upsert(pool, {
      kind: "market_mover",
      dedupe_key: `mover:${day}:down`,
      headline: pick(`${day}d`, ["{sym} slides {pct}", "{name} stock falls {pct}", "Biggest drop: {sym} −{pct}"])
        .replace("{sym}", bottom.symbol)
        .replace("{name}", bottom.display_name)
        .replace("{pct}", `${Math.abs(Number(bottom.change) * 100).toFixed(1)}%`),
      blurb: `Closed at ${money(bottom.mid_close)} after the ${day} settlement.`,
      symbols: [bottom.symbol],
      link_url: `/stocks/${bottom.symbol}`,
      importance: 2,
      occurred_at: new Date(),
      meta: { change: Number(bottom.change), close: Number(bottom.mid_close), date: day },
    });
  }
  return { items: added };
}

// ── Card exchange, pulls, predictions ─────────────────────────────────────
async function gameMoments(pool) {
  let added = 0;
  const [sales, pulls, calls] = await Promise.all([
    pool.query(`
      SELECT s.id, s.card_key, s.rarity, s.price, s.created_at, a.symbol, a.display_name, b.username AS buyer
      FROM games.card_sales s
      JOIN market.market_assets a ON a.id = s.asset_id
      LEFT JOIN market.users b ON b.id = s.buyer_id
      WHERE s.created_at > now() - interval '48 hours'
        AND ((s.rarity = 'UR' AND s.price >= 500) OR (s.rarity = 'SSR' AND s.price >= 1000))
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT p.id, p.rarity, p.created_at, a.symbol, a.display_name, u.username
      FROM games.card_pulls p
      JOIN market.market_assets a ON a.id = p.asset_id
      JOIN market.users u ON u.id = p.user_id
      WHERE p.rarity = 'UR' AND p.created_at > now() - interval '48 hours'
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT m.id, m.slug, m.title, m.resolved_at, o.label
      FROM market.prediction_markets m
      LEFT JOIN market.prediction_market_outcomes o ON o.id = m.winning_outcome_id
      WHERE m.status = 'resolved' AND m.resolved_at > now() - interval '48 hours'
        AND m.auto_template IS NULL -- the automatic tick markets resolve all day; players' own markets are the news
    `).catch(() => ({ rows: [] })),
  ]);
  for (const row of sales.rows) {
    added += await upsert(pool, {
      kind: "exchange_sale",
      dedupe_key: `sale:${row.id}`,
      headline: `${row.display_name} ${row.rarity} sells for ${money(row.price)}`,
      blurb: `${row.buyer ?? "A player"} bought it on the card exchange.`,
      symbols: [row.symbol],
      link_url: `/games/exchange/card/${row.symbol}/${row.rarity}`,
      importance: row.rarity === "UR" ? 2 : 1,
      occurred_at: row.created_at,
      meta: { price: Number(row.price), rarity: row.rarity },
    });
  }
  for (const row of pulls.rows) {
    added += await upsert(pool, {
      kind: "ur_pull",
      dedupe_key: `pull:${row.id}`,
      headline: `${row.username} pulls ${row.display_name} UR`,
      blurb: "A 0.5% pull in the card gacha.",
      symbols: [row.symbol],
      link_url: `/games/cards/gallery/${row.symbol}`,
      importance: 1,
      occurred_at: row.created_at,
      meta: { rarity: row.rarity },
    });
  }
  for (const row of calls.rows) {
    added += await upsert(pool, {
      kind: "prediction_resolved",
      dedupe_key: `pm:${row.id}`,
      headline: `Called: ${String(row.title).slice(0, 110)}`,
      blurb: row.label ? `Resolved “${row.label}”.` : "Resolved.",
      link_url: `/predictions/${row.slug}`,
      importance: 2,
      occurred_at: row.resolved_at,
      meta: { outcome: row.label },
    });
  }
  return { items: added };
}

const GENERATORS = { streamEvents, subscriberMilestones, viewerRecords, superchatLeader, marketMovers, gameMoments };

async function runWire(pool, logger = console) {
  const summary = {};
  for (const [name, generate] of Object.entries(GENERATORS)) {
    try {
      summary[name] = await generate(pool);
    } catch (error) {
      summary[name] = { error: String(error?.message || error) };
      logger.error?.(`wire ${name} failed`, error);
    }
  }
  return summary;
}

/** Recent items, most important and freshest first. */
async function listWire(pool, { limit = 20, hours = 72 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT id, kind, headline, blurb, symbols, image_url, link_url, importance, occurred_at, meta
    FROM content.wire_items
    WHERE NOT hidden AND occurred_at > now() - ($1 || ' hours')::interval AND occurred_at < now() + interval '7 days'
    ORDER BY (importance * 6 - EXTRACT(EPOCH FROM (now() - LEAST(occurred_at, now()))) / 3600) DESC, occurred_at DESC
    LIMIT $2
  `,
    [String(Math.min(24 * 14, Math.max(1, Number(hours) || 72))), Math.min(60, Math.max(1, Number(limit) || 20))]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    headline: row.headline,
    blurb: row.blurb,
    symbols: row.symbols ?? [],
    image_url: row.image_url,
    link_url: row.link_url,
    importance: Number(row.importance),
    occurred_at: row.occurred_at,
    meta: row.meta ?? {},
  }));
}

const WIRE_LOCK_KEY = 9_204_101;

function startWireScheduler(pool, logger = console, { intervalMs = 10 * 60_000 } = {}) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [WIRE_LOCK_KEY]);
      if (!rows[0]?.locked) return;
      try {
        const summary = await runWire(pool, logger);
        const added = Object.values(summary).reduce((sum, entry) => sum + (entry.items ?? 0), 0);
        if (added) logger.info?.("wire updated", summary);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [WIRE_LOCK_KEY]).catch(() => {});
      }
    } catch (error) {
      logger.error?.("wire scheduler failed", error);
    } finally {
      client?.release();
      running = false;
    }
  }
  const first = setTimeout(() => void tick(), 20_000);
  first.unref?.();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { listWire, milestoneStep, runWire, startWireScheduler };
