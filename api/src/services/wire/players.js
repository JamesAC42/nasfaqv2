// Who the Wire may name. Every headline that names a player (a UR pull, a card-exchange buyer, an
// oshi move) keeps that player's id as meta.user_id, and is written and shown only while the player
// may be named:
//   - their email is verified (the leaderboards' bar, so an alt can't fill the feed);
//   - they aren't suspended (moderation.js);
//   - they have no site-wide chat ban. A mute or a ban from one room is about chat posts only.
//
// Generators check headlinePlayerSql in the query that finds the facts, so nothing is written about
// such a player. The Wire's reads (listWire, countWire) check visibleSql, so a headline written
// before a suspension or ban disappears while it lasts and comes back when it's lifted or runs out.
// An item without meta.user_id names nobody and is always shown: a generator that names a player
// must set it.

const { leaderboardPlayerSql } = require("../moderation");

/** SQL that's true when the player `userIdSql` points at may be named in a headline. */
function headlinePlayerSql(userIdSql) {
  return `(${leaderboardPlayerSql(userIdSql)} AND NOT EXISTS (
    SELECT 1 FROM chat.user_moderation_actions cb
    WHERE cb.user_id = ${userIdSql} AND cb.action_type = 'ban' AND cb.channel_id IS NULL
      AND cb.revoked_at IS NULL AND (cb.expires_at IS NULL OR cb.expires_at > now())
  ))`;
}

/** For the Wire's reads (a condition on content.wire_items): true unless the item names a player who may not be named now. */
const visibleSql = () => `(NOT (meta ? 'user_id') OR ${headlinePlayerSql("(meta->>'user_id')::bigint")})`;

module.exports = { headlinePlayerSql, visibleSql };
