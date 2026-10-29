// Moderation: site-wide suspensions, hidden comments and the admin audit log.
//
// A suspended player can still sign in and read everything (so they can see why). Every write they
// try gets 403 account_suspended with the reason and the end date (userContext.js), their sessions
// are signed out when it starts, and they're left off the leaderboards (netWorth.js). Admins can't
// be suspended: take admin away first.
//
// Every action from the moderation tools goes through logAction into market.admin_actions, listed
// on /admin/moderation. Tables are in migrations.js; routes in routes/admin.js, routes/chat.js and
// routes/internalSite.js.

/** Suspension lengths the admin tools offer; null is permanent (until an admin lifts it). */
const SUSPENSION_HOURS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, permanent: null };

/** Comment tables an admin can hide rows in, by the kind the API names them with. */
const COMMENT_TABLES = {
  stock: "content.asset_comments",
  article: "content.article_comments",
  prediction: "content.prediction_market_comments",
};

const REASON_MAX = 280;

function moderationError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/** One line of text, trimmed and capped; null when empty. */
function cleanText(value, max = REASON_MAX) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

/** SQL that's true while the market.users row `alias` is suspended. */
function activeSuspensionSql(alias = "u") {
  return `(${alias}.suspended_at IS NOT NULL AND (${alias}.suspended_until IS NULL OR ${alias}.suspended_until > now()))`;
}

/** SQL that's true when the player `userIdSql` points at isn't suspended. */
function notSuspendedSql(userIdSql) {
  return `NOT EXISTS (SELECT 1 FROM market.users su WHERE su.id = ${userIdSql} AND ${activeSuspensionSql("su")})`;
}

/**
 * SQL that's true when the player `userIdSql` points at belongs on the leaderboards and oshiboards:
 * a verified email (so an unverified alt can't take a place) and no suspension.
 */
function leaderboardPlayerSql(userIdSql) {
  return `EXISTS (SELECT 1 FROM market.users lu WHERE lu.id = ${userIdSql} AND lu.email_verified AND NOT ${activeSuspensionSql("lu")})`;
}

/** A users row's suspension as the player sees it, or null when there's none (or it has run out). */
function suspensionOf(row, now = Date.now()) {
  if (!row?.suspended_at) return null;
  const until = row.suspended_until ? new Date(row.suspended_until) : null;
  if (until && until.getTime() <= now) return null;
  return {
    reason: row.suspension_reason || null,
    since: new Date(row.suspended_at).toISOString(),
    until: until ? until.toISOString() : null,
    permanent: !until,
  };
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Audit log ────────────────────────────────────────────────────────────

/**
 * Records one admin action. `target` is what it was done to (a user, a chat message, a comment…),
 * `targetLabel` a name to show for it (it may change or go away later), `details` anything else.
 */
async function logAction(db, { actor, action, targetType = null, targetId = null, targetLabel = null, reason = null, details = {} }) {
  const { rows } = await db.query(
    `INSERT INTO market.admin_actions (actor_id, action, target_type, target_id, target_label, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, created_at`,
    [actor?.id ?? null, action, targetType, targetId === null || targetId === undefined ? null : String(targetId), targetLabel, cleanText(reason, 500), JSON.stringify(details ?? {})]
  );
  return rows[0];
}

async function listActions(db, { limit = 50 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const { rows } = await db.query(
    `SELECT a.id, a.actor_id, actor.username AS actor_username, a.action, a.target_type, a.target_id, a.target_label, a.reason, a.details, a.created_at
     FROM market.admin_actions a
     LEFT JOIN market.users actor ON actor.id = a.actor_id
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $1`,
    [safeLimit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    actor: row.actor_id ? { id: Number(row.actor_id), username: row.actor_username ?? null } : null,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    target_label: row.target_label,
    reason: row.reason,
    details: row.details && typeof row.details === "object" ? row.details : {},
    created_at: row.created_at,
  }));
}

// ── Suspensions ──────────────────────────────────────────────────────────

/**
 * Suspends ({ suspended: true, duration, reason }) or reinstates ({ suspended: false, reason? }) a
 * player. A suspension needs a reason (the player sees it) and signs them out everywhere; doing it
 * again replaces the one in force. Returns { suspension, sessions_revoked }.
 */
async function setSuspension(pool, actor, userId, body) {
  const suspended = body?.suspended;
  if (typeof suspended !== "boolean") throw moderationError("invalid_suspension", { field: "suspended" });
  const reason = cleanText(body?.reason);
  const duration = String(body?.duration ?? "");
  if (suspended) {
    if (!Object.hasOwn(SUSPENSION_HOURS, duration)) throw moderationError("invalid_suspension", { field: "duration" });
    if (!reason) throw moderationError("invalid_suspension", { field: "reason" });
  }

  return inTransaction(pool, async (client) => {
    const { rows: targets } = await client.query(
      `SELECT id, username, is_admin, suspended_at, suspended_until, suspension_reason FROM market.users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const target = targets[0];
    if (!target) throw moderationError("user_not_found");

    if (!suspended) {
      const was = suspensionOf(target);
      await client.query(
        `UPDATE market.users
         SET suspended_at = NULL, suspended_until = NULL, suspension_reason = NULL, suspended_by = NULL, updated_at = now()
         WHERE id = $1`,
        [target.id]
      );
      await logAction(client, {
        actor,
        action: "user.unsuspend",
        targetType: "user",
        targetId: target.id,
        targetLabel: target.username,
        reason,
        details: { was_suspended: Boolean(was), previous_reason: was?.reason ?? null },
      });
      return { suspension: null, sessions_revoked: 0 };
    }

    if (String(target.id) === String(actor.id)) throw moderationError("cannot_suspend_self");
    if (target.is_admin) throw moderationError("cannot_suspend_admin");
    const hours = SUSPENSION_HOURS[duration];
    const { rows } = await client.query(
      `UPDATE market.users
       SET suspended_at = now(),
           suspended_until = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(hours => $2::int) END,
           suspension_reason = $3,
           suspended_by = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING suspended_at, suspended_until, suspension_reason`,
      [target.id, hours, reason, actor.id]
    );
    // Signed out everywhere, so no open tab carries on; the next sign-in shows them why.
    const revoked = await client.query(`UPDATE market.user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [target.id]);
    const suspension = suspensionOf(rows[0]);
    await logAction(client, {
      actor,
      action: "user.suspend",
      targetType: "user",
      targetId: target.id,
      targetLabel: target.username,
      reason,
      details: { duration, until: suspension?.until ?? null, sessions_revoked: revoked.rowCount },
    });
    return { suspension, sessions_revoked: revoked.rowCount };
  });
}

// ── Hidden comments ──────────────────────────────────────────────────────

/** Hides (or brings back) a stock board, article or prediction comment. Returns { comment }. */
async function setCommentHidden(pool, actor, { kind, commentId, hidden, reason }) {
  const table = COMMENT_TABLES[kind];
  if (!table) throw moderationError("invalid_comment_kind");
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) throw moderationError("comment_not_found");
  if (typeof hidden !== "boolean") throw moderationError("invalid_request");
  const note = hidden ? cleanText(reason) : null;

  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `WITH changed AS (
         UPDATE ${table}
         SET hidden_at = CASE WHEN $2 THEN COALESCE(hidden_at, now()) ELSE NULL END,
             hidden_by = CASE WHEN $2 THEN $3::bigint ELSE NULL END,
             hidden_reason = CASE WHEN $2 THEN $4::text ELSE NULL END
         WHERE id = $1
         RETURNING id, author_id, body, hidden_at, hidden_reason
       )
       SELECT changed.*, u.username AS author_username
       FROM changed
       LEFT JOIN market.users u ON u.id = changed.author_id`,
      [id, hidden, actor.id, note]
    );
    const row = rows[0];
    if (!row) throw moderationError("comment_not_found");
    await logAction(client, {
      actor,
      action: hidden ? "comment.hide" : "comment.unhide",
      targetType: `${kind}_comment`,
      targetId: id,
      targetLabel: row.author_username ?? null,
      reason: note,
      details: { author_id: Number(row.author_id), excerpt: String(row.body || "").slice(0, 200) },
    });
    return { comment: { kind, id, hidden_at: row.hidden_at, hidden_reason: row.hidden_reason } };
  });
}

module.exports = {
  COMMENT_TABLES,
  SUSPENSION_HOURS,
  activeSuspensionSql,
  cleanText,
  listActions,
  logAction,
  moderationError,
  leaderboardPlayerSql,
  notSuspendedSql,
  setCommentHidden,
  setSuspension,
  suspensionOf,
};
