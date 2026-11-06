// What players did on the site lately, for the live band on the front page (GET /api/overview/activity).
//
// Real rows only: counts over the window, plus the newest public action of each kind. Every name and
// action here is already public elsewhere: the trade tape (/market/activity), the prediction tape,
// the arcade's pull feed and the blackjack tables. Chat only counts toward "players": no text.

const cardGacha = require("./games/cardGacha");
const predictionMarkets = require("./predictions/markets");
const { TABLES } = require("./games/tables/blackjack");

const WINDOW_HOURS = 24;

const num = (value) => (value === null || value === undefined ? 0 : Number(value));
const round2 = (value) => Math.round(value * 100) / 100;
const tableName = (key) => TABLES.find((table) => table.key === key)?.name ?? "a table";

async function totals(pool, hours) {
  const { rows } = await pool.query(
    `
    WITH acts AS (
      SELECT 'trade' AS kind, user_id, ts AS at FROM market.trade_fills WHERE ts > now() - make_interval(hours => $1::int)
      UNION ALL
      SELECT 'blackjack', user_id, created_at FROM games.blackjack_bets
      WHERE created_at > now() - make_interval(hours => $1::int) AND outcome IS DISTINCT FROM 'refund'
      UNION ALL
      SELECT 'card', user_id, created_at FROM games.card_pulls WHERE created_at > now() - make_interval(hours => $1::int)
      UNION ALL
      SELECT 'prediction', t.taker_user_id, t.matched_at
      FROM market.prediction_market_trades t
      JOIN market.prediction_markets pm ON pm.id = t.market_id
      WHERE t.matched_at > now() - make_interval(hours => $1::int) AND t.trade_kind = 'amm' AND pm.visibility = 'public' AND t.taker_user_id IS NOT NULL
      UNION ALL
      SELECT 'chat', author_id, created_at FROM chat.messages WHERE created_at > now() - make_interval(hours => $1::int) AND status = 'active'
    )
    SELECT
      COUNT(DISTINCT user_id) AS players,
      COUNT(*) FILTER (WHERE kind = 'trade') AS trades,
      COUNT(DISTINCT user_id) FILTER (WHERE kind = 'trade') AS traders,
      COUNT(*) FILTER (WHERE kind = 'blackjack') AS blackjack_hands,
      COUNT(DISTINCT user_id) FILTER (WHERE kind = 'blackjack') AS blackjack_players,
      COUNT(*) FILTER (WHERE kind = 'card') AS card_pulls,
      COUNT(DISTINCT user_id) FILTER (WHERE kind = 'card') AS card_pullers,
      COUNT(*) FILTER (WHERE kind = 'prediction') AS prediction_bets,
      COUNT(DISTINCT user_id) FILTER (WHERE kind = 'prediction') AS prediction_players,
      COUNT(*) FILTER (WHERE at > now() - interval '1 hour') AS last_hour,
      MAX(at) AS last_action_at
    FROM acts
  `,
    [hours]
  );
  const row = rows[0] ?? {};
  return {
    players: num(row.players),
    trades: num(row.trades),
    traders: num(row.traders),
    blackjack_hands: num(row.blackjack_hands),
    blackjack_players: num(row.blackjack_players),
    card_pulls: num(row.card_pulls),
    card_pullers: num(row.card_pullers),
    prediction_bets: num(row.prediction_bets),
    prediction_players: num(row.prediction_players),
    last_hour: num(row.last_hour),
    last_action_at: row.last_action_at ?? null,
  };
}

async function latestTrade(pool) {
  const { rows } = await pool.query(`
    SELECT f.ts, f.side, f.quantity, a.symbol, u.username
    FROM market.trade_fills f
    JOIN market.market_assets a ON a.id = f.asset_id
    JOIN market.users u ON u.id = f.user_id
    ORDER BY f.ts DESC, f.id DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return { kind: "trade", at: row.ts, username: row.username, side: row.side, quantity: num(row.quantity), symbol: row.symbol };
}

async function latestBlackjack(pool) {
  const { rows } = await pool.query(`
    SELECT b.bet_cash, b.doubled, b.outcome, b.payout_cash, r.table_key, COALESCE(r.settled_at, b.created_at) AS at, u.username
    FROM games.blackjack_bets b
    JOIN games.blackjack_rounds r ON r.id = b.round_id
    JOIN market.users u ON u.id = b.user_id
    WHERE r.status = 'settled' AND b.outcome IS NOT NULL AND b.outcome <> 'refund'
    ORDER BY r.settled_at DESC NULLS LAST, b.id DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const wager = num(row.bet_cash) * (row.doubled ? 2 : 1);
  return { kind: "blackjack", at: row.at, username: row.username, outcome: row.outcome, net: round2(num(row.payout_cash) - wager), table: tableName(row.table_key) };
}

async function latestPull(pool) {
  const [pull] = await cardGacha.listRecentTopPulls(pool, { limit: 1 });
  if (!pull) return null;
  return { kind: "card", at: pull.created_at, username: pull.username, rarity: pull.rarity, name: pull.name, symbol: pull.symbol };
}

async function latestPrediction(pool) {
  const [bet] = await predictionMarkets.listTape(pool, { limit: 1 });
  if (!bet || !bet.username) return null;
  return { kind: "prediction", at: bet.at, username: bet.username, side: bet.side, outcome: bet.outcome_label, cash: Math.abs(num(bet.cash)), title: bet.market_title, slug: bet.slug };
}

/** The live band's data: totals over the last WINDOW_HOURS and the newest action of each kind, newest first. */
async function getActivity(pool, { hours = WINDOW_HOURS } = {}) {
  const [sums, ...latest] = await Promise.all([totals(pool, hours), latestTrade(pool), latestBlackjack(pool), latestPull(pool), latestPrediction(pool)]);
  return {
    generated_at: new Date().toISOString(),
    window_hours: hours,
    totals: sums,
    latest: latest.filter(Boolean).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
  };
}

module.exports = { WINDOW_HOURS, getActivity };
