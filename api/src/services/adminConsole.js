// Admin console: site-wide activity numbers and user role management.
// Used by routes/admin.js (mounted at /api/admin). Every export here assumes the caller already
// checked that the requester is a site admin.

const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

/** Role flags an admin can toggle from /admin/people, in display order. */
const ROLE_FLAGS = [
  "is_admin",
  "can_manage_assets",
  "can_create_prediction_markets",
  "can_approve_prediction_markets",
  "can_resolve_prediction_markets",
  "can_void_prediction_markets",
];

/** Games whose "sessions" are really pulls; they're counted separately from rounds. */
const PULL_GAME_KEYS = ["talent-cards", "capsule-gacha"];

const USER_SEARCH_LIMIT = 50;

function roleError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * Validate a role patch and work out the column updates. Pure, so the rules are testable.
 * Rules:
 * - only role flags and email_verified are accepted, and each must be a boolean;
 * - email_verified can only be switched on (verifying on someone's behalf); never off;
 * - changing is_admin needs `confirm: true` in the body (the UI's second step);
 * - an admin can't remove their own admin flag.
 * Returns { updates: {column: value}, changed: [column] } listing only real changes.
 */
function planRoleChange({ actor, target, body }) {
  if (!actor?.is_admin) throw roleError("forbidden");
  if (!target) throw roleError("user_not_found");
  const input = body && typeof body === "object" ? body : {};
  const updates = {};
  const allowed = new Set([...ROLE_FLAGS, "email_verified", "confirm"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw roleError("invalid_role", { field: key });
  }
  for (const key of [...ROLE_FLAGS, "email_verified"]) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "boolean") throw roleError("invalid_role", { field: key });
    updates[key] = input[key];
  }
  if (!Object.keys(updates).length) throw roleError("invalid_role", { field: null });

  if (updates.email_verified === false) throw roleError("cannot_unverify_email", { field: "email_verified" });

  const changed = Object.keys(updates).filter((key) => Boolean(target[key]) !== updates[key]);

  if (changed.includes("is_admin")) {
    if (String(actor.id) === String(target.id) && updates.is_admin === false) {
      throw roleError("cannot_remove_own_admin", { field: "is_admin" });
    }
    if (input.confirm !== true) throw roleError("admin_change_needs_confirm", { field: "is_admin" });
  }

  const effective = {};
  for (const key of changed) effective[key] = updates[key];
  return { updates: effective, changed };
}

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, Math.min(6, local.length - head.length)))}@${domain}`;
}

const USER_COLUMNS = `
  u.id,
  u.username,
  u.email,
  u.email_verified,
  u.email_verified_at,
  u.profile_color,
  CASE WHEN pp.id IS NULL OR pp.is_deleted THEN NULL
       ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/small/' || pp.filename_small END AS profile_picture_url,
  ${ROLE_FLAGS.map((flag) => `u.${flag}`).join(",\n  ")},
  u.created_at,
  cb.cash_balance,
  seen.last_seen_at
`;

const USER_FROM = `
  FROM market.users u
  LEFT JOIN market.profile_pictures pp ON pp.id = u.profile_picture_id
  LEFT JOIN market.portfolio_cash_balances cb ON cb.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT max(s.last_seen_at) AS last_seen_at
    FROM market.user_sessions s
    WHERE s.user_id = u.id
  ) seen ON true
`;

function toAdminUser(row) {
  if (!row) return null;
  const user = {
    id: Number(row.id),
    username: row.username,
    email_masked: maskEmail(row.email),
    has_email: Boolean(row.email),
    email_verified: Boolean(row.email_verified),
    email_verified_at: row.email_verified_at || null,
    profile_color: row.profile_color || null,
    profile_picture_url: row.profile_picture_url || null,
    created_at: row.created_at,
    cash: row.cash_balance === null || row.cash_balance === undefined ? null : Number(row.cash_balance),
    last_seen_at: row.last_seen_at || null,
  };
  for (const flag of ROLE_FLAGS) user[flag] = Boolean(row[flag]);
  return user;
}

/**
 * Search users by username (or exact email). With no query, lists staff: anyone holding a role.
 * `role` narrows to holders of one flag (or "staff" for any).
 */
async function searchUsers(pool, { q = "", role = "" } = {}) {
  const query = String(q || "").trim().toLowerCase().slice(0, 64);
  const roleKey = String(role || "").trim();
  const where = [];
  const params = [];
  if (query) {
    params.push(`%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    params.push(query);
    where.push(`(u.username_normalized LIKE $${params.length - 1} OR lower(u.email) = $${params.length})`);
  }
  if (ROLE_FLAGS.includes(roleKey)) {
    where.push(`u.${roleKey} = true`);
  } else if (roleKey === "staff" || !query) {
    where.push(`(${ROLE_FLAGS.map((flag) => `u.${flag}`).join(" OR ")})`);
  }
  params.push(USER_SEARCH_LIMIT);
  const order = query
    ? `CASE WHEN u.username_normalized = $2 THEN 0 WHEN u.username_normalized LIKE $2 || '%' THEN 1 ELSE 2 END, u.username_normalized`
    : "u.is_admin DESC, u.username_normalized";
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} ${USER_FROM}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${order}
     LIMIT $${params.length}`,
    params
  );
  return rows.map(toAdminUser);
}

async function getAdminUser(pool, userId) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [userId]);
  return toAdminUser(rows[0]);
}

/** Apply a role patch. Returns { user, changed }. Logs every real change to the server log. */
async function updateUserRoles(pool, actor, userId, body) {
  const target = await getAdminUser(pool, userId);
  const { updates, changed } = planRoleChange({ actor, target, body });
  if (!changed.length) return { user: target, changed };

  const sets = [];
  const params = [userId];
  for (const [column, value] of Object.entries(updates)) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
    if (column === "email_verified" && value) sets.push("email_verified_at = COALESCE(email_verified_at, now())");
  }
  sets.push("updated_at = now()");
  await pool.query(`UPDATE market.users SET ${sets.join(", ")} WHERE id = $1`, params);

  // There's no audit table for account changes yet; the server log is the record.
  // eslint-disable-next-line no-console
  console.info(
    `[admin] roles user=${target.id}(${target.username}) by=${actor.id}(${actor.username}) ${changed
      .map((key) => `${key}:${Boolean(target[key])}->${updates[key]}`)
      .join(" ")}`
  );

  return { user: await getAdminUser(pool, userId), changed };
}

async function count(pool, sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || {};
}

const num = (value) => (value === null || value === undefined ? 0 : Number(value));

/** Site-wide activity for the /admin hub. Each query is a cheap count over an indexed time range. */
async function getOverview(pool) {
  const [users, roles, market, gameSessions, pvp, blackjack, pulls, capsule, predictions, stale] = await Promise.all([
    count(
      pool,
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS signups_24h,
              count(*) FILTER (WHERE created_at > now() - interval '7 days') AS signups_7d,
              count(*) FILTER (WHERE email_verified) AS verified
       FROM market.users`
    ),
    count(
      pool,
      `SELECT ${ROLE_FLAGS.map((flag) => `count(*) FILTER (WHERE ${flag}) AS ${flag}`).join(", ")},
              count(*) FILTER (WHERE ${ROLE_FLAGS.join(" OR ")}) AS staff
       FROM market.users`
    ),
    count(
      pool,
      `SELECT count(*) AS trades, count(DISTINCT user_id) AS traders, COALESCE(sum(gross_cash), 0) AS volume_cash
       FROM market.trade_fills
       WHERE ts > now() - interval '24 hours'`
    ),
    pool.query(
      `SELECT c.key, c.name, count(*) AS rounds
       FROM games.game_sessions s
       JOIN games.game_catalog c ON c.id = s.game_id
       WHERE s.created_at > now() - interval '24 hours'
         AND c.key <> ALL($1::text[])
         AND s.status <> 'cancelled'
       GROUP BY c.key, c.name`,
      [PULL_GAME_KEYS]
    ),
    pool.query(
      `SELECT c.key, c.name, count(*) AS rounds
       FROM games.pvp_matches m
       JOIN games.game_catalog c ON c.id = m.game_id
       WHERE m.status = 'completed' AND m.completed_at > now() - interval '24 hours'
       GROUP BY c.key, c.name`
    ),
    count(
      pool,
      `SELECT count(*) AS rounds FROM games.blackjack_rounds
       WHERE status = 'settled' AND settled_at > now() - interval '24 hours'`
    ),
    count(
      pool,
      `SELECT count(*) AS pulls, count(DISTINCT user_id) AS pullers, COALESCE(sum(cost_cash), 0) AS spent_cash
       FROM games.card_pulls WHERE created_at > now() - interval '24 hours'`
    ),
    count(
      pool,
      `SELECT count(*) AS pulls, count(DISTINCT user_id) AS pullers, COALESCE(sum(cost_cash), 0) AS spent_cash
       FROM games.gacha_pulls WHERE created_at > now() - interval '24 hours'`
    ),
    count(
      pool,
      `SELECT count(*) AS trades, COALESCE(sum(notional_cash), 0) AS volume_cash,
              count(DISTINCT COALESCE(taker_user_id, buy_user_id)) AS traders
       FROM market.prediction_market_trades WHERE matched_at > now() - interval '24 hours'`
    ),
    count(
      pool,
      `SELECT
         (SELECT count(*) FROM games.game_sessions
           WHERE status IN ('created', 'active') AND created_at < now() - interval '1 hour') AS stale_game_sessions,
         (SELECT count(*) FROM games.pvp_matches
           WHERE status = 'active' AND COALESCE(updated_at, started_at, created_at) < now() - interval '30 minutes') AS stale_pvp_matches,
         (SELECT count(*) FROM games.blackjack_rounds
           WHERE status IN ('betting', 'playing') AND started_at < now() - interval '30 minutes') AS stale_blackjack_rounds`
    ),
  ]);

  const byGame = new Map();
  for (const row of [...gameSessions.rows, ...pvp.rows]) {
    const current = byGame.get(row.key) || { key: row.key, name: row.name, rounds: 0 };
    current.rounds += num(row.rounds);
    byGame.set(row.key, current);
  }
  if (num(blackjack.rounds)) byGame.set("blackjack", { key: "blackjack", name: "Blackjack", rounds: num(blackjack.rounds) });
  const roundsByGame = [...byGame.values()].sort((a, b) => b.rounds - a.rounds);

  const roleCounts = { staff: num(roles.staff) };
  for (const flag of ROLE_FLAGS) roleCounts[flag] = num(roles[flag]);

  return {
    generated_at: new Date().toISOString(),
    users: {
      total: num(users.total),
      signups_24h: num(users.signups_24h),
      signups_7d: num(users.signups_7d),
      verified: num(users.verified),
      roles: roleCounts,
    },
    market: {
      trades_24h: num(market.trades),
      active_traders_24h: num(market.traders),
      volume_cash_24h: num(market.volume_cash),
    },
    games: {
      rounds_24h: roundsByGame.reduce((total, game) => total + game.rounds, 0),
      rounds_by_game: roundsByGame,
      card_pulls_24h: num(pulls.pulls),
      card_pullers_24h: num(pulls.pullers),
      card_spend_24h: num(pulls.spent_cash),
      capsule_pulls_24h: num(capsule.pulls),
      capsule_pullers_24h: num(capsule.pullers),
      capsule_spend_24h: num(capsule.spent_cash),
    },
    predictions: {
      trades_24h: num(predictions.trades),
      traders_24h: num(predictions.traders),
      volume_cash_24h: num(predictions.volume_cash),
    },
    stuck: {
      game_sessions: num(stale.stale_game_sessions),
      pvp_matches: num(stale.stale_pvp_matches),
      blackjack_rounds: num(stale.stale_blackjack_rounds),
    },
  };
}

module.exports = {
  ROLE_FLAGS,
  planRoleChange,
  maskEmail,
  searchUsers,
  getAdminUser,
  updateUserRoles,
  getOverview,
};
