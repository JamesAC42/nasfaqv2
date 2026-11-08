// The dividend spotlight (the dividend-spotlight feature flag): who earned the most from the Saturday
// review down to who paid the most in share fees, and each player's own week for the front page. All
// of it reads market.dividend_payouts, which every review already fills, so nothing is written here.
//
// The cost: one aggregate per window and audience, kept for RANKING_TTL_SECONDS and shared by every
// API pod (rankingFor). Pages, a player's own rank and the front page's card all read that one list,
// so traffic doesn't add aggregates. Only a player's breakdown has its own query, by the
// (user_id, evaluation_id) index and only when someone opens it.
//
// Who can be named: headlinePlayerSql, the Wire's rule. It's the net worth leaderboard's rule (a
// verified email, no suspension) plus no site-wide chat ban, so it's the stricter of the two.
//
// Oshi protection (the oshi-protection flag) must reach only viewers it's on for:
//   - its figures are oshi_waived and oshi_protected_quantity, the flag's own `fields`, so the routes'
//     forAudience drops them at any depth;
//   - a row with amount 0 only exists because the fee was skipped, so without the flag those rows are
//     left out (withOshi), and a player with nothing else isn't on the board at all;
//   - shares and per-share rates are left out for everyone: on a protected fee, amount differs from
//     quantity × per_share, and that gap is the skipped fee.
// Each answer depends on withOshi, so it's part of every cache key.

const features = require("../features");
const netWorth = require("./netWorth");
const oshi = require("./oshi");
const weeklyEvaluation = require("./weeklyEvaluation");
const { headlinePlayerSql } = require("./wire/players");
const { getCachedBody } = require("../responseCache");

const FLAG = "dividend-spotlight";
/** How long the ranking is kept: a review changes it once a week, and a ban shows within this long. */
const RANKING_TTL_SECONDS = 60;
const RANKING_MEMO_MS = 10_000;
/** The front page's card shows a review for this long: Saturday 00:00 ET until Wednesday 00:00 ET. */
const WEEK_CARD_DAYS = 4;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cents = (value) => Math.round(value * 100) / 100;

/** Whether this viewer gets oshi protection's figures. */
const withOshiFor = (user) => features.isEnabled(oshi.FLAG, user);
const oshiKey = (withOshi) => (withOshi ? "oshi" : "-");

const parseWindow = (value) => (value === "all" ? "all" : "latest");

/** The most recent completed review and how many there have been; null before the first. */
async function latestEvaluation(pool) {
  const { rows } = await pool.query(`
    SELECT id, eval_date::text AS eval_date, completed_at, COUNT(*) OVER ()::int AS weeks
    FROM market.weekly_evaluations
    WHERE status = 'completed'
    ORDER BY eval_date DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/** Every player who may be named, most earned first. */
async function loadRanking(pool, { window, withOshi }) {
  const latest = await latestEvaluation(pool);
  const entries = [];
  if (latest) {
    const { rows } = await pool.query(
      `
      WITH totals AS (
        SELECT p.user_id,
               SUM(p.amount) AS net,
               COALESCE(SUM(p.amount) FILTER (WHERE p.amount > 0), 0) AS dividends,
               COALESCE(SUM(p.amount) FILTER (WHERE p.amount < 0), 0) AS fees,
               SUM(p.waived) AS waived,
               COUNT(DISTINCT p.asset_id)::int AS stocks
        FROM market.dividend_payouts p
        JOIN market.weekly_evaluations e ON e.id = p.evaluation_id AND e.status = 'completed'
        WHERE ($1::boolean OR p.amount <> 0) ${window === "latest" ? "AND p.evaluation_id = $2" : ""}
        GROUP BY p.user_id
      )
      SELECT t.*, u.username,
             ROW_NUMBER() OVER (ORDER BY t.net DESC, u.username ASC, t.user_id ASC)::int AS rank
      FROM totals t
      JOIN market.users u ON u.id = t.user_id
      WHERE ${headlinePlayerSql("t.user_id")}
      ORDER BY rank
    `,
      window === "latest" ? [withOshi, latest.id] : [withOshi]
    );
    for (const row of rows) {
      entries.push({
        rank: row.rank,
        user_id: Number(row.user_id),
        username: row.username,
        net: toNumber(row.net),
        dividends: toNumber(row.dividends),
        fees: toNumber(row.fees),
        stocks: row.stocks,
        ...(withOshi ? { oshi_waived: toNumber(row.waived) } : {}),
      });
    }
  }
  const sum = (key) => cents(entries.reduce((total, entry) => total + entry[key], 0));
  return {
    window,
    eval_date: latest?.eval_date ?? null,
    weeks: latest?.weeks ?? 0,
    totals: { players: entries.length, dividends: sum("dividends"), fees: sum("fees"), ...(withOshi ? { oshi_waived: sum("oshi_waived") } : {}) },
    entries,
  };
}

const rankingKey = (window, withOshi) => `leaderboard:dividends:ranking:${window}:${oshiKey(withOshi)}`;

/** The cached ranking for this window and audience. */
async function rankingFor({ pool, redis = null }, { window, withOshi }) {
  const body = await getCachedBody(redis, rankingKey(window, withOshi), {
    ttlSeconds: RANKING_TTL_SECONDS,
    memoMs: RANKING_MEMO_MS,
    load: () => loadRanking(pool, { window, withOshi }),
  });
  return JSON.parse(body);
}

/** Pictures, colors and what they've equipped, for the players on a page. */
async function withAvatars(pool, entries) {
  if (!entries.length) return entries;
  const ids = entries.map((entry) => entry.user_id);
  const [decorations, { rows }] = await Promise.all([
    netWorth.loadLeaderboardDecorations(pool, ids),
    pool.query(`SELECT user_id, profile_picture_url, profile_color FROM market.user_leaderboard_current WHERE user_id = ANY($1::bigint[])`, [ids]),
  ]);
  const looks = new Map(rows.map((row) => [Number(row.user_id), row]));
  return entries.map((entry) => {
    const decoration = decorations.get(entry.user_id);
    const look = looks.get(entry.user_id);
    return {
      ...entry,
      profile_picture_url: look?.profile_picture_url ?? null,
      profile_color: look?.profile_color ?? null,
      equipped_hat: decoration?.equipped_hat ?? null,
      equipped: decoration?.equipped ?? {},
    };
  });
}

const pageKey = ({ window, page, limit, withOshi }) => `leaderboard:dividends:${window}:${page}:${limit}:${oshiKey(withOshi)}`;

/** One page of the board, with who's first and who's paid the most in fees. */
async function boardPage(ctx, { window, page, limit, withOshi }) {
  const ranking = await rankingFor(ctx, { window, withOshi });
  const total = ranking.entries.length;
  const pageCount = total ? Math.ceil(total / limit) : 1;
  const start = (page - 1) * limit;
  const entries = await withAvatars(ctx.pool, ranking.entries.slice(start, start + limit));
  const brief = (entry) => (entry ? { user_id: entry.user_id, username: entry.username, net: entry.net } : null);
  const first = ranking.entries[0];
  const last = ranking.entries[total - 1];
  return {
    window,
    eval_date: ranking.eval_date,
    weeks: ranking.weeks,
    totals: ranking.totals,
    top: first?.net > 0 ? brief(first) : null,
    bottom: last?.net < 0 ? brief(last) : null,
    pagination: { total, page, limit, page_count: pageCount, has_previous_page: page > 1, has_next_page: page < pageCount },
    entries,
  };
}

/** The viewer's own place on the board; null when they aren't on it. */
async function myPlace(ctx, userId, { window, withOshi }) {
  const ranking = await rankingFor(ctx, { window, withOshi });
  return {
    window,
    eval_date: ranking.eval_date,
    players: ranking.totals.players,
    me: ranking.entries.find((entry) => entry.user_id === Number(userId)) ?? null,
  };
}

const breakdownKey = ({ userId, window, withOshi }) => `leaderboard:dividends:player:${userId}:${window}:${oshiKey(withOshi)}`;

/**
 * A player's dividends and fees by stock, most earned first; null for a player who can't be named.
 * oshi_protected_quantity only means something for one review, so all-time leaves it out.
 */
async function playerBreakdown(pool, userId, { window, withOshi }) {
  const { rows: named } = await pool.query(`SELECT u.username FROM market.users u WHERE u.id = $1 AND ${headlinePlayerSql("u.id")}`, [userId]);
  if (!named[0]) return null;
  const latest = await latestEvaluation(pool);
  const lines = [];
  if (latest) {
    const { rows } = await pool.query(
      `
      SELECT a.symbol, a.display_name,
             SUM(p.amount) AS net,
             COALESCE(SUM(p.amount) FILTER (WHERE p.amount > 0), 0) AS dividends,
             COALESCE(SUM(p.amount) FILTER (WHERE p.amount < 0), 0) AS fees,
             SUM(p.waived) AS waived,
             SUM(p.protected_quantity) AS protected_quantity,
             COUNT(*)::int AS weeks
      FROM market.dividend_payouts p
      JOIN market.weekly_evaluations e ON e.id = p.evaluation_id AND e.status = 'completed'
      JOIN market.market_assets a ON a.id = p.asset_id
      WHERE p.user_id = $1 AND ($2::boolean OR p.amount <> 0) ${window === "latest" ? "AND p.evaluation_id = $3" : ""}
      GROUP BY a.id, a.symbol, a.display_name
      ORDER BY net DESC, a.symbol ASC
    `,
      window === "latest" ? [userId, withOshi, latest.id] : [userId, withOshi]
    );
    for (const row of rows) {
      lines.push({
        symbol: row.symbol,
        display_name: row.display_name,
        net: toNumber(row.net),
        dividends: toNumber(row.dividends),
        fees: toNumber(row.fees),
        weeks: row.weeks,
        ...(withOshi ? { oshi_waived: toNumber(row.waived) } : {}),
        ...(withOshi && window === "latest" ? { oshi_protected_quantity: toNumber(row.protected_quantity) } : {}),
      });
    }
  }
  return { window, eval_date: latest?.eval_date ?? null, user_id: Number(userId), username: named[0].username, lines };
}

/**
 * The front page's card: when the next review is, whether the player holds anything, and their week
 * while the last review is recent (null after WEEK_CARD_DAYS, or when it touched nothing of theirs).
 */
async function myWeek(ctx, userId, { withOshi, now = new Date() }) {
  const { pool } = ctx;
  const [latest, pendingDate, holding] = await Promise.all([
    latestEvaluation(pool),
    weeklyEvaluation.pendingEvaluationDate(pool, now),
    pool.query(`SELECT EXISTS (SELECT 1 FROM market.portfolio_holdings WHERE user_id = $1 AND quantity > 0) AS holds`, [userId]),
  ]);
  const base = { next_review_at: weeklyEvaluation.evaluationStartsAt(pendingDate).toISOString(), holds_stocks: holding.rows[0].holds, week: null };
  if (!latest?.completed_at) return base;
  const showUntil = new Date(new Date(latest.completed_at).getTime() + WEEK_CARD_DAYS * 86_400_000);
  if (showUntil <= now) return base;

  const [mine] = await weeklyEvaluation.listUserDividends(pool, userId, { limit: 1 });
  const lines = (mine?.lines ?? []).filter((line) => withOshi || line.amount !== 0);
  if (!lines.length) return base;

  const sum = (pick) => cents(lines.reduce((total, line) => total + pick(line), 0));
  const ranking = await rankingFor(ctx, { window: "latest", withOshi });
  // In the minute after a review lands, the kept ranking can still be last week's: no rank beats a wrong one.
  const place = ranking.eval_date === mine.eval_date ? ranking.entries.find((entry) => entry.user_id === Number(userId)) : null;
  return {
    ...base,
    week: {
      eval_date: mine.eval_date,
      show_until: showUntil.toISOString(),
      net: sum((line) => line.amount),
      dividends: sum((line) => Math.max(line.amount, 0)),
      fees: sum((line) => Math.min(line.amount, 0)),
      stocks: lines.length,
      rank: place?.rank ?? null,
      players: ranking.totals.players,
      ...(withOshi ? { oshi_waived: sum((line) => line.oshi_waived) } : {}),
      // The biggest moves, for the card; the Dividend Review has the rest.
      highlights: lines.slice(0, 4).map((line) => ({ symbol: line.symbol, amount: line.amount, ...(withOshi ? { oshi_waived: line.oshi_waived } : {}) })),
    },
  };
}

module.exports = {
  FLAG,
  WEEK_CARD_DAYS,
  boardPage,
  breakdownKey,
  myPlace,
  myWeek,
  pageKey,
  parseWindow,
  playerBreakdown,
  rankingFor,
  rankingKey,
  withOshiFor,
};
