// Shareable game moments: one settled blackjack hand, or one card-pull batch, as public read-only
// facts for the share card (app-client/app/games/moments). Everything returned here was already
// public when it happened (the table shows every seat's hand and payout; the pull feed shows SSR and
// UR pulls by name). No balances, emails or ids beyond the moment's own.

const { RARITY_INFO } = require("./cards");
const dealers = require("./dealers");

const TABLE_NAMES = { low: "Low table", mid: "Mid table", high: "High table" };
const SEATS = 5;
const RARITY_ORDER = ["C", "R", "SR", "SSR", "UR"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (value) => (value === null || value === undefined ? 0 : Math.round(Number(value) * 100) / 100);

function momentError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const PLAYER_SQL = `
  u.username,
  u.profile_color,
  oa.symbol AS oshi_symbol,
  oa.display_name AS oshi_name,
  oc.color AS oshi_color
`;
const PLAYER_JOIN = `
  JOIN market.users u ON u.id = {user}
  LEFT JOIN market.market_assets oa ON oa.id = u.oshi_coin_asset_id
  LEFT JOIN yt.youtube_channels oc ON oc.youtube_channel_id = oa.youtube_channel_id
`;

function playerOf(row) {
  return {
    username: row.username,
    profile_color: row.profile_color || null,
    oshi: row.oshi_symbol ? { symbol: String(row.oshi_symbol).toUpperCase(), display_name: row.oshi_name, color: row.oshi_color || null } : null,
  };
}

/** A settled blackjack hand, by "<round id>-<seat>". Refunded rounds and open rounds aren't moments. */
async function blackjackMoment(pool, id) {
  const match = /^(\d{1,15})-(\d)$/.exec(String(id));
  if (!match || Number(match[2]) >= SEATS) throw momentError("moment_not_found");
  const { rows } = await pool.query(
    `
    SELECT b.round_id, b.seat, b.bet_cash, b.doubled, b.outcome, b.payout_cash,
           r.table_key, r.settled_at, r.dealer_json, r.seats_json,
           ${PLAYER_SQL}
    FROM games.blackjack_bets b
    JOIN games.blackjack_rounds r ON r.id = b.round_id
    ${PLAYER_JOIN.replace("{user}", "b.user_id")}
    WHERE b.round_id = $1 AND b.seat = $2 AND r.status = 'settled' AND b.outcome IS NOT NULL AND b.outcome <> 'refund'
  `,
    [match[1], Number(match[2])]
  );
  const row = rows[0];
  if (!row) throw momentError("moment_not_found");
  const seats = Array.isArray(row.seats_json) ? row.seats_json : [];
  const seat = seats.find((entry) => Number(entry?.seat) === Number(row.seat)) || {};
  const wager = num(row.bet_cash) * (row.doubled ? 2 : 1);
  const dealer = row.dealer_json && typeof row.dealer_json === "object" ? row.dealer_json : {};
  // Who dealt: that table's dealer on the ET day the hand settled.
  const host = await dealers.dealerAt(pool, row.table_key, row.settled_at).catch(() => null);
  return {
    kind: "blackjack",
    id: `${row.round_id}-${row.seat}`,
    at: row.settled_at,
    player: playerOf(row),
    table: { key: row.table_key, name: TABLE_NAMES[row.table_key] || "Blackjack" },
    round_id: Number(row.round_id),
    outcome: row.outcome,
    wager,
    doubled: Boolean(row.doubled),
    payout: num(row.payout_cash),
    net: Math.round((num(row.payout_cash) - wager) * 100) / 100,
    hand: Array.isArray(seat.hand) ? seat.hand : [],
    dealer: {
      hand: Array.isArray(dealer.hand) ? dealer.hand : [],
      value: Number.isFinite(Number(dealer.value)) ? Number(dealer.value) : null,
      talent: host?.symbol ? { symbol: host.symbol, name: host.name, color: host.color } : null,
    },
    others: seats.filter((entry) => Number(entry?.seat) !== Number(row.seat)).length,
  };
}

/** A card-pull batch (one pull or a ten-pull), by its batch id. The best card leads. */
async function cardsMoment(pool, id) {
  if (!UUID_RE.test(String(id))) throw momentError("moment_not_found");
  const { rows } = await pool.query(
    `
    SELECT p.id, p.card_key, p.rarity, p.was_new, p.was_featured, p.stars_after, p.banner_key, p.created_at,
           a.symbol, a.display_name, c.color,
           ${PLAYER_SQL}
    FROM games.card_pulls p
    JOIN market.market_assets a ON a.id = p.asset_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    ${PLAYER_JOIN.replace("{user}", "p.user_id")}
    WHERE p.batch_id = $1
    ORDER BY p.id
  `,
    [String(id).toLowerCase()]
  );
  if (!rows.length) throw momentError("moment_not_found");
  const cards = rows.map((row) => ({
    key: row.card_key,
    symbol: String(row.symbol).toUpperCase(),
    name: row.display_name,
    color: row.color || null,
    rarity: row.rarity,
    rarity_name: RARITY_INFO[row.rarity]?.name ?? row.rarity,
    was_new: Boolean(row.was_new),
    was_featured: Boolean(row.was_featured),
    stars: Number(row.stars_after),
  }));
  const rank = (card) => RARITY_ORDER.indexOf(card.rarity);
  const best = cards.reduce((top, card) => (rank(card) > rank(top) ? card : top), cards[0]);
  return {
    kind: "cards",
    id: String(id).toLowerCase(),
    at: rows[0].created_at,
    player: playerOf(rows[0]),
    banner: rows[0].banner_key,
    count: cards.length,
    best,
    cards,
  };
}

const KINDS = { blackjack: blackjackMoment, cards: cardsMoment };

async function getMoment(pool, kind, id) {
  const load = KINDS[String(kind)];
  if (!load) throw momentError("moment_not_found");
  return load(pool, String(id));
}

module.exports = { KINDS: Object.keys(KINDS), getMoment, blackjackMoment, cardsMoment };
