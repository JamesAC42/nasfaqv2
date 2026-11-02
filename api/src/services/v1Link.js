const crypto = require("node:crypto");
const gamesInventory = require("./games/inventory");
const moderation = require("./moderation");

// Linking an account on the original NASFAQ (nasfaq.biz) to a v2 account. The player starts here, goes
// to v1 with a signed one-time request, confirms there while signed in, and comes back with a signed
// result holding their stats. This site never sees a v1 password or email, and v1 stores nothing: the
// tables here hold the links and enforce one v1 account to one v2 account.
//
// The result only counts in the browser session that started the link. Otherwise someone could start
// a link on their own account and send a v1 player the address, then collect that player's v1 account.
//
// V1_LINK_SECRET signs both directions, and v1 holds the same value in v2link.json. Its side is in
// src/controllers/linkV2/ in JamesAC42/nasfaq.

const REQUEST_LIFETIME_MS = 10 * 60 * 1000;

// v1 sign-up is still open, so only accounts from before this can link: midnight New York, Oct 1 2026.
const JOINED_BEFORE = "2026-10-01T04:00:00.000Z";
// v1 accounts made before that date, counted on the droplet 2026-11-01. The date has passed, so this
// can only fall, when someone deletes their v1 account.
const ELIGIBLE_V1_ACCOUNTS = 3286;

const TIME_ZONE = "America/New_York";
const SOURCE_TYPE = "v1_link";
const THEME_KEY = "v1_classic_theme";
const MONEY = /^-?\d{1,48}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function linkError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function linkSecret(env = process.env) {
  const secret = String(env.V1_LINK_SECRET || "").trim();
  return secret || null;
}

const hashNonce = (nonce) => crypto.createHash("sha256").update(nonce).digest("hex");

function signMessage(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The payload of a message signed with `secret`, or null. Says nothing about whether it's in date. */
function readMessage(secret, message, kind) {
  if (typeof message !== "string" || message.length > 8000) return null;
  const [body, mac, extra] = message.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload?.kind === kind ? payload : null;
  } catch {
    return null;
  }
}

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const money = (value) => (value === null ? null : typeof value === "string" && MONEY.test(value) ? value : undefined);
const time = (value) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
};

/** The stats a signed result carries, checked. The other site is trusted, but a bad row stays out. */
function parseStats(v1) {
  if (!v1 || typeof v1 !== "object" || !UUID.test(String(v1.id))) return null;
  const username = typeof v1.username === "string" ? v1.username.trim().slice(0, 500) : "";
  const joinedAt = time(v1.joined_at);
  const peak = money(v1.peak_net_worth);
  const netWorth = money(v1.net_worth);
  const hats = count(v1.hats);
  const items = count(v1.items);
  if (!username || !joinedAt || peak === undefined || netWorth === undefined || hats === null || items === null) return null;
  return {
    id: String(v1.id).toLowerCase(),
    username,
    joined_at: joinedAt,
    peak_net_worth: peak,
    peak_at: time(v1.peak_at),
    net_worth: netWorth,
    rank: count(v1.rank),
    rank_of: count(v1.rank_of),
    hats,
    items,
  };
}

/** A v1 account's join year, on New York's calendar. */
const joinYear = (joinedAt) => new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric" }).format(new Date(joinedAt));

/** What linking gives: a badge with the join year and the v1 Classic theme. Neither can be sold, since the exchange only takes pulled items. */
function rewardsFor(joinedAt) {
  const year = joinYear(joinedAt);
  return [
    {
      cosmeticKey: `v1_veteran_${year}`,
      cosmeticType: "profile_badge",
      rarity: "rare",
      metadata: {
        display_name: `v1 Veteran · ${year}`,
        description: `Played the original NASFAQ, since ${year}.`,
        slot_key: "profile_badge",
      },
    },
    {
      cosmeticKey: THEME_KEY,
      cosmeticType: "portfolio_theme",
      rarity: "rare",
      metadata: {
        display_name: "Theme: v1 Classic",
        description: "Your profile page, the way the original NASFAQ looked.",
        slot_key: "portfolio_theme",
        theme: { accent: "#38b6f6", accent2: "#75d5f7", pattern: "v1" },
      },
    },
  ];
}

function mapLink(row) {
  return {
    username: row.v1_username,
    joined_at: row.v1_joined_at,
    peak_net_worth: row.peak_net_worth === null ? null : Number(row.peak_net_worth),
    peak_at: row.peak_at,
    net_worth: row.net_worth === null ? null : Number(row.net_worth),
    rank: row.rank,
    rank_of: row.rank_of,
    hats: row.hats,
    items: row.items,
    linked_at: row.linked_at,
    show_on_profile: row.show_on_profile,
  };
}

const LINK_COLUMNS = "v1_username, v1_joined_at, peak_net_worth, peak_at, net_worth, rank, rank_of, hats, items, linked_at, show_on_profile";

async function getLink(pool, userId) {
  const { rows } = await pool.query(`SELECT ${LINK_COLUMNS} FROM market.v1_account_links WHERE user_id = $1`, [userId]);
  return rows[0] ? mapLink(rows[0]) : null;
}

/** What a profile shows: nothing when the player hid it, unless it's their own. */
async function getProfileLink(pool, userId, { isSelf = false } = {}) {
  const link = await getLink(pool, userId);
  if (!link || (!link.show_on_profile && !isSelf)) return null;
  return link;
}

/** The /link-v1 page's state for a signed-in player. */
async function getLinkPage(pool, userId, { env = process.env } = {}) {
  return { configured: Boolean(linkSecret(env)), joined_before: JOINED_BEFORE, link: await getLink(pool, userId) };
}

async function setShowOnProfile(pool, userId, show) {
  const { rows } = await pool.query(
    `UPDATE market.v1_account_links SET show_on_profile = $2 WHERE user_id = $1 RETURNING ${LINK_COLUMNS}`,
    [userId, Boolean(show)]
  );
  if (!rows[0]) throw linkError("v1_link_not_found");
  return mapLink(rows[0]);
}

/** Starts a link: records the attempt and returns the address on v1 to send the player to. */
async function startLink(pool, user, { env = process.env, now = Date.now() } = {}) {
  const secret = linkSecret(env);
  if (!secret) throw linkError("v1_link_not_configured");
  if (await getLink(pool, user.id)) throw linkError("v1_already_linked");

  const nonce = crypto.randomBytes(24).toString("base64url");
  const expiresAt = now + REQUEST_LIFETIME_MS;
  await pool.query(
    `INSERT INTO market.v1_link_attempts (user_id, session_id, nonce_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [user.id, user.session_id, hashNonce(nonce), new Date(expiresAt)]
  );
  const token = signMessage(secret, { kind: "request", nonce, username: user.username, exp: expiresAt });
  const v1Site = String(env.V1_BASE_URL || "https://nasfaq.biz").replace(/\/+$/, "");
  return { url: `${v1Site}/api/linkV2/start?token=${encodeURIComponent(token)}` };
}

/**
 * Grants what linking gives and wears the badge if the player isn't wearing one. The theme waits in
 * their locker, since it restyles their whole page.
 */
async function grantRewards(client, userId, linkId, joinedAt) {
  for (const reward of rewardsFor(joinedAt)) {
    const granted = await gamesInventory.grantCosmeticWithClient(client, { userId, ...reward, sourceType: SOURCE_TYPE, sourceReferenceId: linkId });
    if (reward.cosmeticType === "profile_badge") {
      await client.query(
        `INSERT INTO games.user_equipped_cosmetics (user_id, slot_key, user_cosmetic_id) VALUES ($1, 'profile_badge', $2) ON CONFLICT (user_id, slot_key) DO NOTHING`,
        [userId, granted.id]
      );
    }
  }
}

/**
 * The result v1 sent back, in the request that brought the browser home. Returns "linked" or the reason
 * it didn't work, which the page words for the player. A reason is also recorded against the attempt
 * when the message names one, for the admin numbers.
 */
async function finishLink(pool, user, message, { env = process.env, now = Date.now() } = {}) {
  const secret = linkSecret(env);
  if (!secret) return "not_configured";
  const result = readMessage(secret, message, "result");
  if (!result || typeof result.nonce !== "string") return "invalid";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, user_id, session_id, status, expires_at FROM market.v1_link_attempts WHERE nonce_hash = $1 FOR UPDATE`,
      [hashNonce(result.nonce)]
    );
    const attempt = rows[0];
    if (!attempt) {
      await client.query("COMMIT");
      return "invalid";
    }
    // Used already (a reload, or the back button). Whatever happened the first time stands.
    if (attempt.status !== "started") {
      await client.query("COMMIT");
      return attempt.status === "linked" && user && Number(attempt.user_id) === Number(user.id) ? "linked" : "used";
    }

    const fail = async (reason) => {
      await client.query(`UPDATE market.v1_link_attempts SET status = 'failed', reason = $2, finished_at = now() WHERE id = $1`, [attempt.id, reason]);
      await client.query("COMMIT");
      return reason;
    };

    if (!user) return await fail("signed_out");
    if (Number(attempt.user_id) !== Number(user.id)) return await fail("wrong_account");
    if (Number(attempt.session_id) !== Number(user.session_id)) return await fail("other_session");
    if (user.suspension) return await fail("suspended");
    if (new Date(attempt.expires_at).getTime() <= now || typeof result.exp !== "number" || result.exp <= now) return await fail("expired");

    const stats = parseStats(result.v1);
    if (!stats) return await fail("invalid");
    if (stats.joined_at >= JOINED_BEFORE) return await fail("too_new");

    const inserted = await client.query(
      `
      INSERT INTO market.v1_account_links (user_id, v1_user_id, v1_username, v1_joined_at, peak_net_worth, peak_at, net_worth, rank, rank_of, hats, items)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
      [user.id, stats.id, stats.username, stats.joined_at, stats.peak_net_worth, stats.peak_at, stats.net_worth, stats.rank, stats.rank_of, stats.hats, stats.items]
    );
    if (!inserted.rows[0]) {
      const taken = await client.query(`SELECT 1 FROM market.v1_account_links WHERE user_id = $1`, [user.id]);
      return await fail(taken.rows[0] ? "already_linked" : "v1_taken");
    }

    await grantRewards(client, user.id, Number(inserted.rows[0].id), stats.joined_at);
    await client.query(`UPDATE market.v1_link_attempts SET status = 'linked', finished_at = now() WHERE id = $1`, [attempt.id]);
    await client.query("COMMIT");
    return "linked";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Admin: undoes a link. Takes back what it gave and frees the v1 account to link again. */
async function unlink(pool, { userId, actor, reason = null }) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) throw linkError("v1_link_not_found");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      DELETE FROM market.v1_account_links l
      USING market.users u
      WHERE l.user_id = $1 AND u.id = l.user_id
      RETURNING l.v1_user_id, l.v1_username, l.v1_joined_at, l.peak_net_worth, l.linked_at, u.username
    `,
      [safeUserId]
    );
    const link = rows[0];
    if (!link) throw linkError("v1_link_not_found");
    await client.query(
      `DELETE FROM games.user_equipped_cosmetics WHERE user_id = $1 AND user_cosmetic_id IN (SELECT id FROM games.user_cosmetics WHERE user_id = $1 AND source_type = $2)`,
      [safeUserId, SOURCE_TYPE]
    );
    await client.query(`DELETE FROM games.user_cosmetics WHERE user_id = $1 AND source_type = $2`, [safeUserId, SOURCE_TYPE]);
    await moderation.logAction(client, {
      actor,
      action: "user.v1_unlink",
      targetType: "user",
      targetId: safeUserId,
      targetLabel: link.username,
      reason,
      details: { v1_username: link.v1_username, v1_user_id: link.v1_user_id, v1_joined_at: link.v1_joined_at, linked_at: link.linked_at },
    });
    await client.query("COMMIT");
    return { user_id: safeUserId, username: link.username, v1_username: link.v1_username };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The "v1 players" numbers on /admin/analytics. Days are New York days. */
async function adminSummary(pool, { limit = 50, search = "" } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const term = String(search || "").trim().slice(0, 64);
  const [totals, byDay, stuck, recent] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*)::int FROM market.v1_account_links) AS linked,
        (SELECT count(*)::int FROM market.v1_account_links l
          WHERE EXISTS (SELECT 1 FROM market.user_sessions s WHERE s.user_id = l.user_id AND s.last_seen_at > now() - interval '7 days')) AS active_7d,
        (SELECT count(DISTINCT user_id)::int FROM market.v1_link_attempts) AS players_started,
        (SELECT count(*)::int FROM market.v1_link_attempts WHERE status = 'started' AND expires_at > now()) AS in_progress
    `),
    pool.query(`
      SELECT to_char(linked_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS day, count(*)::int AS linked
      FROM market.v1_account_links
      GROUP BY 1
      ORDER BY 1
    `),
    // Why each player who tried and hasn't linked stopped: their last attempt.
    pool.query(`
      SELECT reason, count(*)::int AS players
      FROM (
        SELECT DISTINCT ON (a.user_id) COALESCE(a.reason, 'abandoned') AS reason
        FROM market.v1_link_attempts a
        WHERE NOT EXISTS (SELECT 1 FROM market.v1_account_links l WHERE l.user_id = a.user_id)
          AND (a.status = 'failed' OR a.expires_at <= now())
        ORDER BY a.user_id, a.created_at DESC, a.id DESC
      ) last_attempts
      GROUP BY reason
      ORDER BY players DESC, reason
    `),
    pool.query(
      `
      SELECT l.user_id, u.username, l.v1_username, l.v1_joined_at, l.peak_net_worth, l.rank, l.linked_at
      FROM market.v1_account_links l
      JOIN market.users u ON u.id = l.user_id
      WHERE ($2 = '' OR u.username ILIKE '%' || $2 || '%' OR l.v1_username ILIKE '%' || $2 || '%')
      ORDER BY l.linked_at DESC, l.id DESC
      LIMIT $1
    `,
      [safeLimit, term.replace(/[\\%_]/g, "\\$&")]
    ),
  ]);
  return {
    eligible_accounts: ELIGIBLE_V1_ACCOUNTS,
    joined_before: JOINED_BEFORE,
    ...totals.rows[0],
    by_day: byDay.rows,
    not_finished: stuck.rows,
    recent: recent.rows.map((row) => ({
      user_id: Number(row.user_id),
      username: row.username,
      v1_username: row.v1_username,
      v1_joined_at: row.v1_joined_at,
      peak_net_worth: row.peak_net_worth === null ? null : Number(row.peak_net_worth),
      rank: row.rank,
      linked_at: row.linked_at,
    })),
  };
}

module.exports = {
  ELIGIBLE_V1_ACCOUNTS,
  JOINED_BEFORE,
  adminSummary,
  finishLink,
  getLink,
  getLinkPage,
  getProfileLink,
  readMessage,
  rewardsFor,
  setShowOnProfile,
  signMessage,
  startLink,
  unlink,
};
