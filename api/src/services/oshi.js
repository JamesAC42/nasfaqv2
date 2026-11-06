// The oshi: a player's favorite talent (market.users.oshi_coin_asset_id). Their mark follows the
// player's name, and since the oshi protection their shares can skip the Saturday share fee
// (weeklyEvaluation.js). So the choice is kept from being aimed at whichever stock is about to charge:
//
//   - The oshi changes at most once every CHANGE_COOLDOWN_DAYS. The first pick (no oshi before,
//     ever) is free and doesn't count, and going back to no oshi is always allowed; picking again
//     after that counts as the change.
//   - Every pick, change and clear is a row in market.user_oshi_changes.
//   - Protection covers only an oshi held the whole week (no row since the week started) and only
//     the shares held all week: the fewest the player held at any moment since then.

const CHANGE_COOLDOWN_DAYS = 30;

function oshiError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

/** Where a player's 30-day rule stands: whether a change is open and when the next one is. */
async function readChangeRule(db, userId) {
  const { rows } = await db.query(
    `
    SELECT COUNT(*)::int AS rows,
           MAX(changed_at) FILTER (WHERE kind = 'change') AS last_change_at,
           MAX(changed_at) FILTER (WHERE kind = 'change') + make_interval(days => $2) AS next_change_at,
           COALESCE(MAX(changed_at) FILTER (WHERE kind = 'change') + make_interval(days => $2) > now(), false) AS cooling,
           MAX(changed_at) AS set_at
    FROM market.user_oshi_changes
    WHERE user_id = $1
  `,
    [userId, CHANGE_COOLDOWN_DAYS]
  );
  const row = rows[0];
  return { hasHistory: row.rows > 0, cooling: row.cooling, nextChangeAt: row.cooling ? row.next_change_at : null, lastChangeAt: row.last_change_at, setAt: row.set_at };
}

/** What a move from `before` to `after` would be: 'first_pick', 'change' or 'clear' (null: no move). */
function kindOf(before, after, hasHistory) {
  if (before === after) return null;
  if (after === null) return "clear";
  return before === null && !hasHistory ? "first_pick" : "change";
}

/**
 * Checks a change without making it (the profile save runs it first, so a refused oshi saves
 * nothing). Throws oshi_change_cooldown with available_at.
 */
async function assertCanChange(db, userId, assetId) {
  const { rows } = await db.query(`SELECT oshi_coin_asset_id FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw oshiError("profile_not_found");
  const before = rows[0].oshi_coin_asset_id === null ? null : Number(rows[0].oshi_coin_asset_id);
  const rule = await readChangeRule(db, userId);
  if (kindOf(before, assetId, rule.hasHistory) === "change" && rule.cooling) throw oshiError("oshi_change_cooldown", { available_at: rule.nextChangeAt });
}

/**
 * Sets the player's oshi (an asset id, or null for none) inside the caller's transaction, under a
 * lock on their row so two saves at once can't both use the month's change. Returns the move's kind
 * (null when nothing changed). Throws oshi_change_cooldown with available_at.
 */
async function setOshiWithClient(client, userId, assetId) {
  const { rows } = await client.query(`SELECT oshi_coin_asset_id FROM market.users WHERE id = $1 FOR UPDATE`, [userId]);
  if (!rows[0]) throw oshiError("profile_not_found");
  const before = rows[0].oshi_coin_asset_id === null ? null : Number(rows[0].oshi_coin_asset_id);
  const after = assetId === null || assetId === undefined ? null : Number(assetId);
  const rule = await readChangeRule(client, userId);
  const kind = kindOf(before, after, rule.hasHistory);
  if (!kind) return null;
  if (kind === "change" && rule.cooling) throw oshiError("oshi_change_cooldown", { available_at: rule.nextChangeAt });
  await client.query(`UPDATE market.users SET oshi_coin_asset_id = $2, updated_at = now() WHERE id = $1`, [userId, after]);
  await client.query(`INSERT INTO market.user_oshi_changes (user_id, asset_id_before, asset_id_after, kind) VALUES ($1, $2, $3, $4)`, [userId, before, after, kind]);
  return kind;
}

/**
 * For each (player, stock) pair, how many shares were added at the most since `since`: the largest
 * sum of quantity changes from some moment on (0 when the holding only shrank). The fewest shares held
 * at any moment since then is the holding before those moves minus that. Read from the ledger, which
 * carries every change to a stock holding (fills, IPO allocations and reversals, forced buybacks).
 * Returns Map "userId:assetId" → number.
 */
async function sharesAddedSince(db, pairs, since) {
  const added = new Map();
  if (!pairs.length) return added;
  const { rows } = await db.query(
    `
    WITH pairs AS (
      SELECT DISTINCT p.user_id, p.asset_id FROM unnest($1::bigint[], $2::bigint[]) AS p(user_id, asset_id)
    ),
    moves AS (
      SELECT l.user_id, l.asset_id,
             SUM(l.quantity_delta) OVER (PARTITION BY l.user_id, l.asset_id ORDER BY l.created_at DESC, l.id DESC ROWS UNBOUNDED PRECEDING) AS from_here
      FROM market.ledger_entries l
      JOIN pairs p ON p.user_id = l.user_id AND p.asset_id = l.asset_id
      WHERE l.created_at >= $3 AND l.quantity_delta <> 0
    )
    SELECT user_id, asset_id, GREATEST(MAX(from_here), 0) AS added FROM moves GROUP BY user_id, asset_id
  `,
    [pairs.map((pair) => pair.userId), pairs.map((pair) => pair.assetId), since]
  );
  for (const row of rows) added.set(`${Number(row.user_id)}:${Number(row.asset_id)}`, Number(row.added) || 0);
  return added;
}

/**
 * The players whose oshi is one of `assetIds` and has been since `since` (no pick, change or clear
 * after it), with how many of its shares they've added since then. Map userId → { assetId, added }.
 */
async function loadProtectedOshis(db, assetIds, since) {
  const { rows } = await db.query(
    `
    SELECT u.id AS user_id, u.oshi_coin_asset_id AS asset_id
    FROM market.users u
    WHERE u.oshi_coin_asset_id = ANY($1::bigint[])
      AND NOT EXISTS (SELECT 1 FROM market.user_oshi_changes c WHERE c.user_id = u.id AND c.changed_at >= $2)
  `,
    [assetIds, since]
  );
  const pairs = rows.map((row) => ({ userId: Number(row.user_id), assetId: Number(row.asset_id) }));
  const added = await sharesAddedSince(db, pairs, since);
  return new Map(pairs.map((pair) => [pair.userId, { assetId: pair.assetId, added: added.get(`${pair.userId}:${pair.assetId}`) ?? 0 }]));
}

/** Shares covered: the fewest held since the week started, never more than now, rounded to the micro-share. */
function protectedShares(heldNow, added) {
  const shares = Math.min(heldNow, heldNow - added);
  return shares > 0 ? Math.floor(shares * 1e6 + 1e-6) / 1e6 : 0;
}

/**
 * One player's oshi as the stock page and the profile show it: the talent, the 30-day rule, and this
 * week's protection (shares held since `weekStart`, the last Saturday 00:00 ET).
 */
async function getOshiStatus(pool, userId, { weekStart, nextReviewAt }) {
  const { rows } = await pool.query(
    `
    SELECT a.id, a.symbol, a.display_name, COALESCE(h.quantity, 0) AS held
    FROM market.users u
    JOIN market.market_assets a ON a.id = u.oshi_coin_asset_id
    LEFT JOIN market.portfolio_holdings h ON h.user_id = u.id AND h.asset_id = a.id
    WHERE u.id = $1
  `,
    [userId]
  );
  const rule = await readChangeRule(pool, userId);
  const change = { cooldown_days: CHANGE_COOLDOWN_DAYS, available_at: rule.nextChangeAt, first_pick: !rows[0] && !rule.hasHistory };
  const base = { week_start: weekStart.toISOString(), next_review_at: nextReviewAt.toISOString(), change };
  if (!rows[0]) return { ...base, oshi: null, set_at: rule.setAt, covered: false, held: 0, protected_shares: 0 };
  const assetId = Number(rows[0].id);
  const held = Number(rows[0].held) || 0;
  const covered = !rule.setAt || new Date(rule.setAt).getTime() < weekStart.getTime();
  const added = covered ? (await sharesAddedSince(pool, [{ userId, assetId }], weekStart)).get(`${userId}:${assetId}`) ?? 0 : 0;
  return {
    ...base,
    oshi: { id: assetId, symbol: rows[0].symbol, display_name: rows[0].display_name },
    set_at: rule.setAt,
    covered,
    held,
    protected_shares: covered ? protectedShares(held, added) : 0,
  };
}

module.exports = {
  CHANGE_COOLDOWN_DAYS,
  assertCanChange,
  getOshiStatus,
  kindOf,
  loadProtectedOshis,
  protectedShares,
  readChangeRule,
  setOshiWithClient,
  sharesAddedSince,
};
