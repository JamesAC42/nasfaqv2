// Talent cards: one card per listed talent at each rarity. See docs/games/GAMES_DESIGN.md §1.

const RARITIES = ["C", "R", "SR", "SSR", "UR"];

const RARITY_INFO = {
  C: { name: "Standard", power: 10, rateBps: 5500, dupShards: 5, craftShards: 50 },
  R: { name: "On stream", power: 14, rateBps: 3000, dupShards: 15, craftShards: 150 },
  SR: { name: "Outfit", power: 19, rateBps: 1100, dupShards: 50, craftShards: 500 },
  SSR: { name: "Idol", power: 25, rateBps: 350, dupShards: 200, craftShards: 2000 },
  UR: { name: "Legend", power: 32, rateBps: 50, dupShards: 800, craftShards: 8000 },
};

const MAX_STARS = 5;
const MOMENTUM_CAP = 8;

function rarityRank(rarity) {
  return RARITIES.indexOf(rarity);
}

function isRarity(value) {
  return RARITIES.includes(value);
}

function cardKey(symbol, rarity) {
  return `card:${String(symbol).toUpperCase()}:${rarity}`;
}

function parseCardKey(key) {
  const match = /^card:([A-Z0-9]{1,12}):(C|R|SR|SSR|UR)$/.exec(String(key || ""));
  return match ? { symbol: match[1], rarity: match[2] } : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Listed talents with what the cards need: unit, icon, colour, price and today's move. */
async function listTalents(db) {
  const { rows } = await db.query(`
    WITH latest_daily AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, d.mid_open
      FROM market.asset_daily_market_state d
      ORDER BY d.asset_id, d.market_date DESC
    )
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      a.current_mid_price,
      ld.mid_open,
      c.unit,
      c.icon,
      c.color
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN latest_daily ld ON ld.asset_id = a.id
    WHERE a.status <> 'delisted'
    ORDER BY a.symbol ASC
  `);
  return rows.map((row) => {
    const price = toNumber(row.current_mid_price);
    const open = toNumber(row.mid_open);
    return {
      asset_id: Number(row.id),
      symbol: row.symbol,
      name: row.display_name,
      unit: row.unit || null,
      icon: row.icon || null,
      color: row.color || null,
      price,
      move_pct: price !== null && open ? (price - open) / open : null,
    };
  });
}

function talentMap(talents) {
  return new Map(talents.map((talent) => [talent.symbol, talent]));
}

/** Whole-percent move today, clamped. Used by the card duel. */
function momentumOf(movePct) {
  if (movePct === null || movePct === undefined || !Number.isFinite(movePct)) return 0;
  return Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, Math.round(movePct * 100)));
}

function basePower(rarity, stars = 1) {
  const info = RARITY_INFO[rarity];
  if (!info) return 0;
  return info.power + Math.max(0, Math.min(MAX_STARS, stars) - 1);
}

function publicCard(talent, rarity, extra = {}) {
  return {
    key: cardKey(talent.symbol, rarity),
    symbol: talent.symbol,
    name: talent.name,
    unit: talent.unit,
    icon: talent.icon,
    color: talent.color,
    rarity,
    rarity_name: RARITY_INFO[rarity].name,
    power: basePower(rarity, extra.stars ?? 1),
    ...extra,
  };
}

module.exports = {
  MAX_STARS,
  MOMENTUM_CAP,
  RARITIES,
  RARITY_INFO,
  basePower,
  cardKey,
  isRarity,
  listTalents,
  momentumOf,
  parseCardKey,
  publicCard,
  rarityRank,
  talentMap,
};
