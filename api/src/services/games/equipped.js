// What a player has equipped from the capsule, as one small object the site can draw anywhere their
// name shows: { hat, profile_frame, profile_badge, chat_flair, item, ... } keyed by slot, each
// { key, type, rarity, display_name, image_url }.

/** A SQL expression (jsonb) with the equipped cosmetics of the user in `userIdSql`. */
function equippedJsonSql(userIdSql) {
  return `(
    SELECT jsonb_object_agg(ec.slot_key, jsonb_build_object(
      'key', uc.cosmetic_key,
      'type', uc.cosmetic_type,
      'rarity', uc.rarity,
      'display_name', COALESCE(uc.metadata_json->>'display_name', uc.cosmetic_key),
      'image_url', uc.metadata_json->>'image_url'
    ))
    FROM games.user_equipped_cosmetics ec
    JOIN games.user_cosmetics uc ON uc.id = ec.user_cosmetic_id
    WHERE ec.user_id = ${userIdSql}
  )`;
}

function normalizeEquipped(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [slot, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue;
    out[slot] = {
      key: String(entry.key || ""),
      type: String(entry.type || slot),
      rarity: String(entry.rarity || "common"),
      display_name: String(entry.display_name || entry.key || slot),
      image_url: entry.image_url ? String(entry.image_url) : null,
    };
  }
  return out;
}

/** Equipped cosmetics for many users at once: Map(userId → equipped). */
async function loadEquipped(pool, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map(ids.map((id) => [id, {}]));
  if (!ids.length) return out;
  const { rows } = await pool.query(`SELECT u.id, ${equippedJsonSql("u.id")} AS equipped FROM unnest($1::bigint[]) AS u(id)`, [ids]);
  for (const row of rows) out.set(Number(row.id), normalizeEquipped(row.equipped));
  return out;
}

module.exports = { equippedJsonSql, loadEquipped, normalizeEquipped };
