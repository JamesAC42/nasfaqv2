// The Wire: short automatic headlines from facts the site already has, so the front page has
// news every day even when no HoloNews rollup is out. Every item is a checked fact (a stream the
// talent scheduled, a subscriber count, a sale); code writes the words from templates, so nothing
// here can invent a claim about a real person.
//
// Sources: stream events judged from titles (streams.js; Jev when configured), subscriber
// milestones, viewer records, the day's top superchat stream, market movers, IPOs, big card-exchange
// sales, UR pulls and resolved prediction markets. A scheduler runs every 10 minutes; items are
// keyed (dedupe_key) so each fact is posted once. Stream items refresh their live/upcoming state.

const crypto = require("node:crypto");
const streams = require("./streams");
const chatter = require("../chatter");
const autotag = require("../autotag");
const newsMoods = require("../newsMoods");
const { BUYBACK_START, BUYBACK_DAILY_STEP } = require("../marketSupply");

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

// ── /vt/ chatter ───────────────────────────────────────────────────────────
const CHATTER_TOPIC_BLURB = { stream: "Mostly about her streams.", music: "Mostly about her music.", collab: "Mostly about her collabs.", hype: "Mostly hype.", market: "Mostly about her stock." };

async function chatterSpikes(pool) {
  const summary = await chatter.getSummary(pool);
  if (!summary.ready) return { items: 0, ready: false };
  const { rows: assets } = await pool.query(`SELECT symbol, display_name FROM market.market_assets WHERE status = 'active'`);
  const names = new Map(assets.map((row) => [row.symbol, row.display_name]));
  const day = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const entry of summary.talents) {
    if (!(entry.heat >= 3) || entry.posts_recent < 25 || !names.has(entry.symbol)) continue;
    const name = names.get(entry.symbol);
    added += await upsert(pool, {
      kind: "chatter_spike",
      dedupe_key: `chatter:${entry.symbol}:${day}`,
      headline: pick(`${entry.symbol}${day}`, ["{name} is the talk of /vt/", "/vt/ can't stop talking about {name}", "All eyes on {name} in the threads"]).replace("{name}", name),
      blurb: `${entry.posts_recent} posts in ${summary.recent_hours} hours, ${entry.heat.toFixed(1)}× the usual. ${CHATTER_TOPIC_BLURB[entry.topic] ?? ""}`.trim(),
      symbols: [entry.symbol],
      link_url: `/stocks/${entry.symbol}`,
      importance: entry.heat >= 5 ? 3 : 2,
      occurred_at: new Date(),
      meta: { heat: entry.heat, posts: entry.posts_recent, topic: entry.topic },
    });
  }
  return { items: added };
}

async function autotagArticles(pool) {
  return autotag.runAutotag(pool);
}

/** Talents' reaction faces for recent headlines (after tagging, so new tags get a mood too). */
async function newsReactions(pool) {
  return newsMoods.runNewsMoods(pool);
}

// ── The weekly evaluation, buybacks, sell-outs (docs/market/core-market.md) ──
async function marketSupplyNews(pool) {
  let added = 0;
  const { rows: evaluations } = await pool.query(`
    SELECT eval_date::text AS eval_date, completed_at, report_json
    FROM market.weekly_evaluations
    WHERE status = 'completed' AND completed_at > now() - interval '7 days'
    ORDER BY eval_date DESC LIMIT 1
  `);
  for (const row of evaluations) {
    const report = row.report_json || {};
    const top = (report.top_dividends || [])[0];
    const worst = (report.top_fees || [])[0];
    const pct = (value) => `${(Math.abs(Number(value)) * 100).toFixed(1)}%`;
    added += await upsert(pool, {
      kind: "dividend_review",
      dedupe_key: `evaluation:${row.eval_date}`,
      headline: top
        ? pick(row.eval_date, ["DIVS: {sym} pays {pct} this week", "Dividend Review: {name} tops the payouts at {pct}", "{sym} leads the weekly dividends, {pct} a share"])
            .replace("{sym}", top.symbol)
            .replace("{name}", top.display_name)
            .replace("{pct}", pct(top.rate))
        : "Dividend Review: a quiet week, no dividends",
      blurb: `${money(report.dividends_total || 0)} paid out, ${money(Math.abs(report.fees_total || 0))} in share fees${worst ? `; ${worst.symbol} charged the most (${pct(worst.rate)})` : ""}.`,
      symbols: [top?.symbol, worst?.symbol].filter(Boolean),
      link_url: "/market/dividends",
      importance: 3,
      occurred_at: row.completed_at,
      meta: { eval_date: row.eval_date },
    });
  }
  const { rows: buybacks } = await pool.query(`
    SELECT b.id, b.status, b.started_at, b.ended_at, b.frozen_price, b.target_max_supply, b.held_at_start, b.forced_shares, a.symbol, a.display_name
    FROM market.asset_buybacks b
    JOIN market.market_assets a ON a.id = b.asset_id
    WHERE b.started_at > now() - interval '8 days' OR b.ended_at > now() - interval '2 days'
  `);
  for (const row of buybacks) {
    added += await upsert(pool, {
      kind: "buyback",
      dedupe_key: `buyback:${row.id}:start`,
      headline: pick(row.id, ["Buyback: {sym} frozen, broker bids {price}", "{name} stock frozen for a buyback", "Broker announces a {sym} buyback"]).replace("{sym}", row.symbol).replace("{name}", row.display_name).replace("{price}", money(Number(row.frozen_price) * BUYBACK_START)),
      blurb: `Max shares cut to ${Math.round(Number(row.target_max_supply)).toLocaleString("en-US")} with ${Math.round(Number(row.held_at_start)).toLocaleString("en-US")} held. Sell to the broker at ${Math.round(BUYBACK_START * 100)}%, ${Math.round(BUYBACK_DAILY_STEP * 100)} points less each day.`,
      symbols: [row.symbol],
      link_url: `/stocks/${row.symbol}`,
      importance: 3,
      occurred_at: row.started_at,
      meta: { buyback_id: Number(row.id) },
    });
    if (row.status !== "active" && row.ended_at) {
      added += await upsert(pool, {
        kind: "buyback",
        dedupe_key: `buyback:${row.id}:end`,
        headline: row.status === "forced" ? `${row.symbol} buyback forced: ${Number(row.forced_shares).toFixed(0)} shares taken back` : `${row.symbol} buyback over, trading resumes`,
        blurb: row.status === "forced" ? "The broker bought the excess from every holder at the base rate." : "Players sold enough; the stock is back under its max shares.",
        symbols: [row.symbol],
        link_url: `/stocks/${row.symbol}`,
        importance: 2,
        occurred_at: row.ended_at,
        meta: { buyback_id: Number(row.id), status: row.status },
      });
    }
  }
  // Sold out: nothing left for sale (once a day per stock).
  const { rows: soldOut } = await pool.query(`
    SELECT symbol, display_name, max_supply FROM market.market_assets
    WHERE status = 'active' AND trading_state = 'open' AND treasury_supply - broker_buffer_pct * max_supply <= 0 AND max_supply > 0
  `);
  const day = new Date().toISOString().slice(0, 10);
  for (const row of soldOut) {
    added += await upsert(pool, {
      kind: "sold_out",
      dedupe_key: `soldout:${row.symbol}:${day}`,
      headline: pick(`${row.symbol}${day}`, ["{sym} is sold out", "Every {sym} share is taken", "SOLD OUT: {name}"]).replace("{sym}", row.symbol).replace("{name}", row.display_name),
      blurb: `All ${Math.round(Number(row.max_supply)).toLocaleString("en-US")} shares are held. Buys wait for someone to sell.`,
      symbols: [row.symbol],
      link_url: `/stocks/${row.symbol}`,
      importance: 2,
      occurred_at: new Date(),
      meta: { date: day },
    });
  }
  return { items: added };
}

// ── IPOs (services/ipo.js): announced, window open, listed ────────────────────
function listNames(names) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

async function ipoNews(pool) {
  const { rows } = await pool.query(`
    SELECT e.id, e.title, e.status, e.listing_date::text AS listing_date, e.window_opens_at, e.created_at, e.opened_at, e.listed_at,
           COALESCE(json_agg(json_build_object('symbol', a.symbol, 'name', COALESCE(c.name_english, c.name_short), 'price', l.ipo_price,
             'allocated', l.shares_allocated) ORDER BY a.symbol) FILTER (WHERE a.id IS NOT NULL), '[]') AS talents
    FROM market.ipo_events e
    LEFT JOIN market.ipo_listings l ON l.event_id = e.id AND l.status <> 'cancelled'
    LEFT JOIN market.market_assets a ON a.id = l.asset_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE e.status <> 'cancelled' AND GREATEST(e.created_at, COALESCE(e.opened_at, e.created_at), COALESCE(e.listed_at, e.created_at)) > now() - interval '8 days'
    GROUP BY e.id
  `);
  const date = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  let added = 0;
  for (const row of rows) {
    const talents = row.talents || [];
    if (!talents.length) continue;
    const symbols = talents.map((talent) => talent.symbol);
    const names = listNames(talents.map((talent) => talent.name));
    const coming = talents.length === 1 ? `${names} is coming to market` : `${talents.length} new talents are coming to market`;
    added += await upsert(pool, {
      kind: "ipo",
      dedupe_key: `ipo:${row.id}:announced`,
      headline: `IPO: ${coming}`,
      blurb: `${row.title}: ${talents.length === 1 ? "" : `${names}. `}Subscriptions open ${new Date(row.window_opens_at).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" })}; trading starts ${date(row.listing_date)}.`,
      symbols,
      link_url: "/market/ipo",
      importance: 4,
      occurred_at: row.created_at,
      meta: { ipo_id: Number(row.id), stage: "announced" },
    });
    if (row.opened_at) {
      added += await upsert(pool, {
        kind: "ipo",
        dedupe_key: `ipo:${row.id}:open`,
        headline: `IPO window open: ${symbols.join(", ")}`,
        blurb: `Subscribe at ${talents.map((talent) => `${talent.symbol} ${money(talent.price)}`).join(", ")} until ${date(row.listing_date)}'s settlement. Oversubscribed IPOs are shared out pro rata.`,
        symbols,
        link_url: "/market/ipo",
        importance: 4,
        occurred_at: row.opened_at,
        meta: { ipo_id: Number(row.id), stage: "open" },
      });
    }
    if (row.listed_at) {
      const allocated = talents.reduce((sum, talent) => sum + Number(talent.allocated || 0), 0);
      added += await upsert(pool, {
        kind: "ipo",
        dedupe_key: `ipo:${row.id}:listed`,
        headline: talents.length === 1 ? `${names} starts trading today` : `${symbols.join(", ")} start trading today`,
        blurb: `${allocated.toLocaleString("en-US")} shares went out at the IPO. ${talents.map((talent) => `${talent.symbol} opened at ${money(talent.price)}`).join(", ")}.`,
        symbols,
        link_url: talents.length === 1 ? `/stocks/${symbols[0]}` : "/market/ipo",
        importance: 5,
        occurred_at: row.listed_at,
        meta: { ipo_id: Number(row.id), stage: "listed" },
      });
    }
  }
  return { items: added };
}

const GENERATORS = { streamEvents, subscriberMilestones, viewerRecords, superchatLeader, marketMovers, marketSupplyNews, ipoNews, gameMoments, chatterSpikes, autotagArticles, newsReactions };

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

// What the Wire page's filter chips mean, as SQL conditions on kind.
const WIRE_GROUPS = {
  streams: "kind LIKE 'stream\\_%'",
  records: "kind IN ('subscriber_milestone', 'viewer_record', 'superchat_leader')",
  market: "kind IN ('market_mover', 'dividend_review', 'buyback', 'sold_out', 'ipo')",
  games: "kind IN ('exchange_sale', 'ur_pull', 'prediction_resolved')",
  vt: "kind = 'chatter_spike'",
};

function wireRow(row) {
  return {
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
  };
}

/**
 * Recent items. The front page takes the most important and freshest first (order "rank"); the Wire
 * page reads them newest first (order "time"), optionally one group (WIRE_GROUPS) or one talent, and
 * pages back with `before` (an occurred_at).
 */
async function listWire(pool, { limit = 40, hours = 168, order = "rank", group = null, symbol = null, before = null } = {}) {
  const params = [String(Math.min(24 * 30, Math.max(1, Number(hours) || 168))), Math.min(200, Math.max(1, Number(limit) || 40))];
  const where = ["NOT hidden", "occurred_at > now() - ($1 || ' hours')::interval", "occurred_at < now() + interval '7 days'"];
  if (group && WIRE_GROUPS[group]) where.push(WIRE_GROUPS[group]);
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    where.push(`$${params.length} = ANY(symbols)`);
  }
  if (before) {
    params.push(before);
    where.push(`occurred_at < $${params.length}::timestamptz`);
  }
  const orderBy =
    order === "time"
      ? "occurred_at DESC, id DESC"
      : "(importance * 6 - EXTRACT(EPOCH FROM (now() - LEAST(occurred_at, now()))) / 3600) DESC, occurred_at DESC";
  const { rows } = await pool.query(
    `
    SELECT id, kind, headline, blurb, symbols, image_url, link_url, importance, occurred_at, meta
    FROM content.wire_items
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $2
  `,
    params
  );
  return rows.map(wireRow);
}

/** How many items each group has in the window (the Wire page's chips), plus the total. */
async function countWire(pool, { hours = 168, symbol = null } = {}) {
  const params = [String(Math.min(24 * 30, Math.max(1, Number(hours) || 168)))];
  let symbolFilter = "";
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    symbolFilter = `AND $2 = ANY(symbols)`;
  }
  const columns = Object.entries(WIRE_GROUPS).map(([key, condition]) => `COUNT(*) FILTER (WHERE ${condition})::int AS ${key}`);
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS all, ${columns.join(", ")}
    FROM content.wire_items
    WHERE NOT hidden AND occurred_at > now() - ($1 || ' hours')::interval AND occurred_at < now() + interval '7 days' ${symbolFilter}
  `,
    params
  );
  return rows[0];
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

module.exports = { WIRE_GROUPS, countWire, listWire, milestoneStep, runWire, startWireScheduler };
