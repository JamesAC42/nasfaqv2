// The /admin/users page: every account (searchable, sortable, a page at a time), one account in
// detail, and the account fixes that only an admin can make: rename, change the email, clear a bio,
// sign out everywhere, and send the verification or password reset email. Mounted by routes/admin.js,
// which checks the caller is a site admin before any of this runs.
//
// Roles, freezes, suspensions, profile resets and chat mutes keep their own routes
// (adminConsole.js, moderation.js, routes/chat.js); the page calls those. Every write here goes
// through moderation.logAction, in the same transaction wherever it changes a row, so it's on
// /admin/moderation with who, what and when.
//
// Addresses stay private: nothing here returns one (toAdminUser masks it), the log only keeps the
// masked form, and looking an account up by address takes the whole address, in a POST body, so
// it can't be read off letter by letter or land in an access log. Password hashes, tokens and
// session rows are never selected.

const auth = require("./auth");
const netWorth = require("./netWorth");
const profileDb = require("../profileDb");
const chatDb = require("../chatDb");
const { ROLE_FLAGS, USER_COLUMNS, USER_FROM, maskEmail, toAdminUser, withSharedIps } = require("./adminConsole");
const { activeSuspensionSql, cleanText, inTransaction, listActions, logAction } = require("./moderation");
const { appUrl, sendEmail } = require("./email");
const { emailChangedEmail } = require("./emailTemplates");
const { canonicalEmail, isDisposableEmail } = require("./emailRules");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const QUERY_MAX = 64;
const HISTORY_LIMIT = 50;

/** Columns the list can sort by, and which way each starts. Only these keys ever reach the SQL. */
const SORTS = {
  username: { sql: "u.username_normalized", dir: "asc" },
  joined: { sql: "u.created_at", dir: "desc" },
  last_seen: { sql: "seen.last_seen_at", dir: "desc" },
  cash: { sql: "cb.cash_balance", dir: "desc" },
  net_worth: { sql: "lb.total_equity", dir: "desc" },
};

/** The list's filters, in display order. Only these keys ever reach the SQL. */
const FILTERS = {
  all: "true",
  unverified: "NOT u.email_verified",
  suspended: activeSuspensionSql("u"),
  frozen: "u.exchange_frozen_at IS NOT NULL",
  staff: `(${ROLE_FLAGS.map((flag) => `u.${flag}`).join(" OR ")})`,
  new: "u.created_at > now() - interval '7 days'",
};

const NET_WORTH_JOIN = "LEFT JOIN market.user_leaderboard_current lb ON lb.user_id = u.id";

function accountError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/** Cleans the list's query string. Pure, so the allow-lists are testable. Anything unknown falls back. */
function parseListQuery(query = {}) {
  const pick = (allowed, value, fallback) => (typeof value === "string" && Object.hasOwn(allowed, value) ? value : fallback);
  const sort = pick(SORTS, query.sort, "joined");
  const filter = pick(FILTERS, query.filter, "all");
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : SORTS[sort].dir;
  const page = Math.max(1, Number.parseInt(String(query.page), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(String(query.limit), 10) || DEFAULT_PAGE_SIZE));
  return { q: String(query.q ?? "").trim().toLowerCase().slice(0, QUERY_MAX), filter, sort, dir, page, limit };
}

/** The search as SQL over `params`: a username fragment or an account number ("12", "#12"). */
function searchSql(q, params) {
  params.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  const byName = `u.username_normalized LIKE $${params.length}`;
  const id = /^#?(\d{1,18})$/.exec(q)?.[1];
  if (!id) return byName;
  params.push(id);
  return `(${byName} OR u.id = $${params.length}::bigint)`;
}

/** One page of accounts, with the total for this search and filter and the count behind each filter. */
async function listUsers(pool, query) {
  const { q, filter, sort, dir, page, limit } = parseListQuery(query);
  const where = [FILTERS[filter]];
  const params = [];
  if (q) where.push(searchSql(q, params));
  const whereSql = where.join(" AND ");
  const fromSql = `${USER_FROM} ${NET_WORTH_JOIN}`;

  const [countRows, pageRows, filterRows] = await Promise.all([
    pool.query(`SELECT count(*) AS total FROM market.users u WHERE ${whereSql}`, params),
    pool.query(
      `SELECT ${USER_COLUMNS}, lb.total_equity AS net_worth ${fromSql}
       WHERE ${whereSql}
       ORDER BY ${SORTS[sort].sql} ${dir === "asc" ? "ASC" : "DESC"} NULLS LAST, u.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
    pool.query(`SELECT ${Object.entries(FILTERS).map(([key, sql]) => `count(*) FILTER (WHERE ${sql}) AS "${key}"`).join(", ")} FROM market.users u`),
  ]);

  const users = await withSharedIps(pool, pageRows.rows.map(toDirectoryUser));
  const counts = {};
  for (const key of Object.keys(FILTERS)) counts[key] = Number(filterRows.rows[0][key]);
  return { users, total: Number(countRows.rows[0].total), page, limit, filter, sort, dir, counts };
}

function toDirectoryUser(row) {
  return { ...toAdminUser(row), net_worth: row.net_worth === null || row.net_worth === undefined ? null : Number(row.net_worth) };
}

/**
 * The account on this exact address, if any, as its inbox sees it (Gmail dots and +tags count as
 * the same address). No partial matches. Returns { users } with zero or one account.
 */
async function findUsersByEmail(pool, body) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 320) throw accountError("invalid_email");
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, lb.total_equity AS net_worth ${USER_FROM} ${NET_WORTH_JOIN}
     WHERE lower(u.email) = $1 OR u.email_normalized = $2
     ORDER BY u.id
     LIMIT 5`,
    [email, canonicalEmail(email)]
  );
  return { users: await withSharedIps(pool, rows.map(toDirectoryUser)) };
}

/** Everything the one-account page shows. Throws user_not_found. */
async function getUserDetail(pool, userId) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS},
            lb.total_equity AS net_worth,
            lb.holdings_market_value,
            u.username_changed_at,
            u.bio AS bio_text,
            (SELECT max(created_at) FROM market.user_email_verification_tokens t WHERE t.user_id = u.id) AS verification_sent_at,
            (SELECT max(created_at) FROM market.user_password_reset_tokens t WHERE t.user_id = u.id) AS password_reset_sent_at,
            (SELECT count(*) FROM chat.message_reports r JOIN chat.messages m ON m.id = r.message_id WHERE m.author_id = u.id) AS reports_total,
            (SELECT count(*) FROM chat.message_reports r JOIN chat.messages m ON m.id = r.message_id WHERE m.author_id = u.id AND r.status = 'open') AS reports_open
     ${USER_FROM} ${NET_WORTH_JOIN}
     WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw accountError("user_not_found");

  const [[user], chatRestrictions, v1Links, history] = await Promise.all([
    withSharedIps(pool, [toDirectoryUser(row)]),
    chatDb.listActiveModerationActions(pool, { userId }),
    pool.query(`SELECT v1_username, v1_joined_at, linked_at FROM market.v1_account_links WHERE user_id = $1`, [userId]),
    listActions(pool, { targetType: "user", targetId: userId, limit: HISTORY_LIMIT }),
  ]);
  return {
    user,
    bio: row.bio_text ?? null,
    holdings_value: row.holdings_market_value === null || row.holdings_market_value === undefined ? null : Number(row.holdings_market_value),
    username_changed_at: row.username_changed_at ?? null,
    verification_sent_at: row.verification_sent_at ?? null,
    password_reset_sent_at: row.password_reset_sent_at ?? null,
    chat_reports: { open: Number(row.reports_open), total: Number(row.reports_total) },
    chat_restrictions: chatRestrictions,
    v1_link: v1Links.rows[0] ?? null,
    history,
  };
}

// ── Fixes ────────────────────────────────────────────────────────────────

/**
 * Fixes a player's username ({ username, reason? }). The format and name rules still apply; see
 * profileDb.renameByAdmin for what doesn't. Returns { before, after, changed }.
 */
async function renameUser(pool, actor, userId, body) {
  const reason = cleanText(body?.reason);
  const result = await inTransaction(pool, async (client) => {
    const rename = await profileDb.renameByAdmin(client, userId, body?.username);
    if (rename.changed) {
      await logAction(client, {
        actor,
        action: "user.rename",
        targetType: "user",
        targetId: userId,
        targetLabel: rename.after,
        reason,
        details: { before: rename.before, after: rename.after },
      });
    }
    return rename;
  });
  if (result.changed) await refreshNameCopies(pool, userId);
  return result;
}

/** The leaderboard and oshiboards keep a copy of the name. Their next refresh catches a failure here. */
async function refreshNameCopies(pool, userId) {
  try {
    await netWorth.refreshCurrentLeaderboard(pool, { userIds: [userId] });
    await netWorth.refreshCurrentOshiboards(pool, { userIds: [userId] });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[admin] leaderboard refresh after rename failed for user ${userId}:`, error?.message || error);
  }
}

/**
 * Changes a player's email ({ email, reason, confirm: true }), for an address typed wrong at sign-up
 * or one they've lost: players can't change their own. This can hand over an account, because the
 * password reset goes to the new address, so:
 *  - it needs a reason and `confirm`, and it's refused on admins (and on yourself);
 *  - the new address passes the sign-up rules (no throwaway domains, one inbox per account);
 *  - the account goes back to unverified until the link sent to the new address is used;
 *  - links already sent to the old address stop working;
 *  - a previously verified old address gets a notice, with the new one masked.
 * Returns { verification_email, notice_email }: "sent", "failed", "not_configured" or "skipped".
 */
async function changeUserEmail(pool, actor, userId, body, { send = sendEmail } = {}) {
  const reason = cleanText(body?.reason);
  if (!reason) throw accountError("reason_required", { field: "reason" });
  if (body?.confirm !== true) throw accountError("email_change_needs_confirm");
  const email = auth.validateEmail(body?.email);
  if (isDisposableEmail(email)) throw accountError("disposable_email");

  const { target, wasVerified, oldEmail } = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT id, username, email, email_verified, is_admin FROM market.users WHERE id = $1 FOR UPDATE`, [userId]);
    const row = rows[0];
    if (!row) throw accountError("user_not_found");
    if (String(row.id) === String(actor.id)) throw accountError("cannot_change_own_email");
    if (row.is_admin) throw accountError("cannot_change_admin_email");
    if (row.email && row.email.toLowerCase() === email) throw accountError("email_unchanged");
    try {
      await client.query(
        `UPDATE market.users
         SET email = $2, email_normalized = $3, email_verified = false, email_verified_at = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, email, canonicalEmail(email)]
      );
    } catch (error) {
      if (error?.code === "23505") throw accountError("email_taken");
      throw error;
    }
    // Reset links only work while the account has the address they went to, and verification links
    // would "succeed" without verifying anything. Spend them so an old link just says it's expired.
    await client.query(`UPDATE market.user_email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [row.id]);
    await client.query(`UPDATE market.user_password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [row.id]);
    await logAction(client, {
      actor,
      action: "user.email_change",
      targetType: "user",
      targetId: row.id,
      targetLabel: row.username,
      reason,
      details: { before: maskEmail(row.email), after: maskEmail(email), was_verified: Boolean(row.email_verified) },
    });
    return { target: row, wasVerified: Boolean(row.email_verified), oldEmail: row.email };
  });

  // After the commit: nothing holds the row while Resend answers, and a failed send can be redone.
  const verification = await auth.sendVerificationEmail(pool, { id: target.id, username: target.username, email, email_verified: false }, { send });
  let notice = "skipped";
  const contactUrl = appUrl("/rules");
  if (wasVerified && oldEmail && contactUrl) {
    notice = await send({ to: oldEmail, ...emailChangedEmail({ username: target.username, newEmailMasked: maskEmail(email), url: contactUrl }) });
  }
  return { verification_email: verification, notice_email: notice };
}

/** Clears a bio without touching the name ({ reason? }). The log keeps what it said. Returns { changed }. */
async function clearBio(pool, actor, userId, body) {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT id, username, bio FROM market.users WHERE id = $1 FOR UPDATE`, [userId]);
    const row = rows[0];
    if (!row) throw accountError("user_not_found");
    if (!row.bio) return { changed: false };
    await client.query(`UPDATE market.users SET bio = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    await logAction(client, {
      actor,
      action: "user.clear_bio",
      targetType: "user",
      targetId: row.id,
      targetLabel: row.username,
      reason: cleanText(body?.reason),
      details: { bio: row.bio },
    });
    return { changed: true };
  });
}

/**
 * Ends every session the player has and closes their open sockets ({ reason? }). Not for yourself:
 * Account security in your profile settings does that and keeps this browser signed in.
 * Returns { sessions_revoked }.
 */
async function signOutUser(pool, redis, actor, userId, body) {
  if (String(userId) === String(actor.id)) throw accountError("cannot_sign_out_self");
  const result = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT id, username FROM market.users WHERE id = $1`, [userId]);
    const row = rows[0];
    if (!row) throw accountError("user_not_found");
    const revoked = await client.query(`UPDATE market.user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.id]);
    await logAction(client, {
      actor,
      action: "user.sign_out",
      targetType: "user",
      targetId: row.id,
      targetLabel: row.username,
      reason: cleanText(body?.reason),
      details: { sessions_revoked: revoked.rowCount },
    });
    return { sessions_revoked: revoked.rowCount };
  });
  await auth.announceSessionsRevoked(redis, userId);
  return result;
}

async function emailTarget(pool, userId) {
  const { rows } = await pool.query(`SELECT id, username, email, email_verified FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw accountError("user_not_found");
  if (!rows[0].email) throw accountError("no_email");
  return rows[0];
}

/** Sends the verification link again, to the address on file. One a minute. Returns { status }. */
async function sendVerification(pool, actor, userId, { send = sendEmail } = {}) {
  const target = await emailTarget(pool, userId);
  if (target.email_verified) throw accountError("already_verified");
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM market.user_email_verification_tokens WHERE user_id = $1 AND created_at > now() - interval '1 minute' LIMIT 1`,
    [target.id]
  );
  if (recent.length) throw accountError("too_soon");
  const status = await auth.sendVerificationEmail(pool, target, { send });
  await logAction(pool, { actor, action: "user.verification_email", targetType: "user", targetId: target.id, targetLabel: target.username, details: { status } });
  return { status };
}

/**
 * Sends a password reset link to the address on file, the same one a player can ask for themselves
 * (one a minute). The admin never sees the link and nothing changes until the player uses it.
 * Returns { status }.
 */
async function sendPasswordReset(pool, actor, userId, { send = sendEmail } = {}) {
  const target = await emailTarget(pool, userId);
  const status = await auth.requestPasswordReset(pool, target.username, { send });
  if (status === "too_soon") throw accountError("too_soon");
  if (status === "no_account") throw accountError("no_email");
  await logAction(pool, { actor, action: "user.password_reset_email", targetType: "user", targetId: target.id, targetLabel: target.username, details: { status } });
  return { status };
}

module.exports = {
  FILTERS,
  SORTS,
  changeUserEmail,
  clearBio,
  findUsersByEmail,
  getUserDetail,
  listUsers,
  parseListQuery,
  renameUser,
  sendPasswordReset,
  sendVerification,
  signOutUser,
};
