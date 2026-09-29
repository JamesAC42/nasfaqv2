// Card reactions: owning any card of a talent unlocks her six reaction poses, which players can
// send as chat stickers and use as their avatar. Ownership is checked when a sticker is sent or an
// avatar is picked.

const REACTION_POSES = ["idle", "hype", "moon", "cope", "smug", "shock"];

// A chat message that is exactly one sticker: [[sticker:PEK/hype]]
const STICKER_PATTERN = /^\[\[sticker:([A-Z0-9_]{1,16})\/(idle|hype|moon|cope|smug|shock)\]\]$/;

function reactionError(code) {
  return Object.assign(new Error(code), { code });
}

/** { symbol, pose } for a sticker message body, else null. */
function parseSticker(body) {
  const match = STICKER_PATTERN.exec(String(body ?? "").trim());
  return match ? { symbol: match[1], pose: match[2] } : null;
}

/** "PEK/hype" -> { symbol, pose }; throws invalid_reaction. */
function parseReactionId(value) {
  const match = /^([A-Za-z0-9_]{1,16})\/(idle|hype|moon|cope|smug|shock)$/.exec(String(value ?? "").trim());
  if (!match) throw reactionError("invalid_reaction");
  return { symbol: match[1].toUpperCase(), pose: match[2] };
}

/** Talents whose reactions the user has unlocked. */
async function listUnlockedReactions(db, userId) {
  const { rows } = await db.query(
    `
    SELECT a.id AS asset_id, a.symbol, a.display_name, c.icon, c.color, COUNT(*)::int AS cards
    FROM games.user_cards uc
    JOIN market.market_assets a ON a.id = uc.asset_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE uc.user_id = $1
    GROUP BY a.id, a.symbol, a.display_name, c.icon, c.color
    ORDER BY a.symbol ASC
  `,
    [userId]
  );
  return rows.map((row) => ({
    asset_id: Number(row.asset_id),
    symbol: row.symbol,
    display_name: row.display_name,
    icon: row.icon || null,
    color: row.color || null,
    cards: row.cards,
    poses: REACTION_POSES,
  }));
}

async function ownsReaction(db, userId, symbol) {
  const { rows } = await db.query(
    `
    SELECT 1
    FROM games.user_cards uc
    JOIN market.market_assets a ON a.id = uc.asset_id
    WHERE uc.user_id = $1 AND a.symbol = $2
    LIMIT 1
  `,
    [userId, symbol]
  );
  return rows.length > 0;
}

/** Throws reaction_locked unless the user owns a card of `symbol`. */
async function assertOwnsReaction(db, userId, symbol, code = "reaction_locked") {
  if (!(await ownsReaction(db, userId, symbol))) throw reactionError(code);
}

module.exports = {
  REACTION_POSES,
  assertOwnsReaction,
  listUnlockedReactions,
  ownsReaction,
  parseReactionId,
  parseSticker,
};
