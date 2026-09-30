const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME || "nasfaq_session";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const EMAIL_VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24);
const PASSWORD_KEYLEN = 64;
const { profilePictureUrlSql } = require("../profilePictures");
const { appUrl, escapeHtml, sendEmail } = require("./email");


function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function validateUsername(username) {
  const trimmed = String(username || "").trim();
  if (trimmed.length < 3 || trimmed.length > 32 || !/^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/.test(trimmed)) {
    const error = new Error("invalid_username");
    error.code = "invalid_username";
    throw error;
  }
  return trimmed;
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8 || value.length > 200) {
    const error = new Error("invalid_password");
    error.code = "invalid_password";
    throw error;
  }
  return value;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  // Length first, and a pattern with no overlapping repeats: the old one backtracked quadratically,
  // so a long crafted address froze the process.
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized)) {
    const error = new Error("invalid_email");
    error.code = "invalid_email";
    throw error;
  }
  return normalized;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    email_verified: Boolean(user.email_verified),
    profile_picture_url: user.profile_picture_url || null,
    profile_color: user.profile_color || null,
    is_admin: Boolean(user.is_admin),
    can_manage_assets: Boolean(user.can_manage_assets),
    can_create_prediction_markets: Boolean(user.can_create_prediction_markets),
    can_approve_prediction_markets: Boolean(user.can_approve_prediction_markets),
    can_resolve_prediction_markets: Boolean(user.can_resolve_prediction_markets),
    can_void_prediction_markets: Boolean(user.can_void_prediction_markets),
    created_at: user.created_at,
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const params = { N: 16384, r: 8, p: 1 };
  const derived = await scryptAsync(password, salt, PASSWORD_KEYLEN, params);
  return {
    hash: Buffer.from(derived).toString("hex"),
    salt,
    params,
  };
}

async function verifyPassword(password, user) {
  const params = user.password_params_json || { N: 16384, r: 8, p: 1 };
  const derived = await scryptAsync(password, user.password_salt, PASSWORD_KEYLEN, params);
  const incoming = Buffer.from(derived).toString("hex");
  const expected = String(user.password_hash || "");

  const incomingBuffer = Buffer.from(incoming, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (incomingBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(incomingBuffer, expectedBuffer);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashVerificationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSessionTtlSeconds() {
  const days = Number.isFinite(SESSION_TTL_DAYS) && SESSION_TTL_DAYS > 0 ? SESSION_TTL_DAYS : 30;
  return Math.floor(days * 24 * 60 * 60);
}

function buildSessionCookie(token) {
  const maxAge = getSessionTtlSeconds();
  // Secure unless explicitly turned off, and always in production (the site is HTTPS-only there).
  const setting = (process.env.AUTH_COOKIE_SECURE || "").toLowerCase();
  const secure = process.env.NODE_ENV === "production" ? setting !== "false" : setting === "true";
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function buildExpiredSessionCookie() {
  // Secure unless explicitly turned off, and always in production (the site is HTTPS-only there).
  const setting = (process.env.AUTH_COOKIE_SECURE || "").toLowerCase();
  const secure = process.env.NODE_ENV === "production" ? setting !== "false" : setting === "true";
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function parseCookies(headerValue) {
  const cookies = {};
  for (const part of String(headerValue || "").split(";")) {
    const [rawKey, ...rest] = part.split("=");
    const key = String(rawKey || "").trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("=").trim());
  }
  return cookies;
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie || "");
  return cookies[SESSION_COOKIE_NAME] || null;
}

async function createUser(pool, { username, email, password }) {
  const safeUsername = validateUsername(username);
  const safeEmail = validateEmail(email);
  const safePassword = validatePassword(password);
  const normalized = normalizeUsername(safeUsername);
  const hashed = await hashPassword(safePassword);

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO market.users (
        username,
        username_normalized,
        email,
        password_hash,
        password_salt,
        password_params_json,
        email_verified,
        is_admin,
        can_manage_assets,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,false,false,false,now())
      RETURNING
        id,
        username,
        email,
        email_verified,
        NULL::TEXT AS profile_picture_url,
        profile_color,
        is_admin,
        can_manage_assets,
        can_create_prediction_markets,
        can_approve_prediction_markets,
        can_resolve_prediction_markets,
        can_void_prediction_markets,
        created_at
    `,
      [safeUsername, normalized, safeEmail, hashed.hash, hashed.salt, JSON.stringify(hashed.params)]
    );
    await sendVerificationEmail(pool, rows[0]);
    return publicUser(rows[0]);
  } catch (error) {
    if (error?.code === "23505") {
      const constraint = String(error.constraint || "");
      const e = new Error(constraint.includes("email") ? "email_taken" : "username_taken");
      e.code = constraint.includes("email") ? "email_taken" : "username_taken";
      throw e;
    }
    throw error;
  }
}

async function createEmailVerificationToken(pool, userId, email) {
  const token = generateVerificationToken();
  const tokenHash = hashVerificationToken(token);
  const ttlHours = Number.isFinite(EMAIL_VERIFICATION_TTL_HOURS) && EMAIL_VERIFICATION_TTL_HOURS > 0
    ? EMAIL_VERIFICATION_TTL_HOURS
    : 24;
  await pool.query(
    `
    INSERT INTO market.user_email_verification_tokens (
      user_id,
      email,
      token_hash,
      expires_at
    ) VALUES ($1,$2,$3,now() + ($4 || ' hours')::interval)
  `,
    [userId, email, tokenHash, String(ttlHours)]
  );
  return token;
}

async function sendVerificationEmail(pool, user) {
  if (!user?.id || !user?.email || user.email_verified) return;
  const token = await createEmailVerificationToken(pool, user.id, user.email);
  const verificationUrl = appUrl(`${process.env.EMAIL_VERIFICATION_PATH || "/verify-email"}?token=${encodeURIComponent(token)}`);
  const status = verificationUrl
    ? await sendEmail({
      to: user.email,
      subject: "Verify your NASFAQ account",
      html: `<p>Verify your NASFAQ account by opening this link:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires soon.</p>`,
      text: `Verify your NASFAQ account: ${verificationUrl}`,
    })
    : "not_configured";
  if (status === "not_configured") {
    // eslint-disable-next-line no-console
    console.warn(`Email verification link for ${user.email}: ${verificationUrl || token}`);
  }
}

async function verifyEmailToken(pool, token) {
  const tokenHash = hashVerificationToken(String(token || ""));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT id, user_id, email
      FROM market.user_email_verification_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      FOR UPDATE
      LIMIT 1
    `,
      [tokenHash]
    );
    const tokenRow = rows[0] || null;
    if (!tokenRow) {
      const error = new Error("invalid_verification_token");
      error.code = "invalid_verification_token";
      throw error;
    }

    await client.query(
      `
      UPDATE market.users
      SET email_verified = true,
          email_verified_at = COALESCE(email_verified_at, now()),
          updated_at = now()
      WHERE id = $1
        AND email = $2
    `,
      [tokenRow.user_id, tokenRow.email]
    );
    await client.query(
      `
      UPDATE market.user_email_verification_tokens
      SET used_at = now()
      WHERE id = $1
    `,
      [tokenRow.id]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findUserByLogin(pool, login) {
  const value = String(login || "").trim();
  const normalizedUsername = normalizeUsername(value);
  const normalizedEmail = normalizeEmail(value);
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.username_normalized,
      u.email,
      u.email_verified,
      u.password_hash,
      u.password_salt,
      u.password_params_json,
      ${profilePictureUrlSql("small")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
      u.can_manage_assets,
      u.can_create_prediction_markets,
      u.can_approve_prediction_markets,
      u.can_resolve_prediction_markets,
      u.can_void_prediction_markets,
      u.created_at
    FROM market.users u
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE u.username_normalized = $1
       OR lower(u.email) = $2
    LIMIT 1
  `,
    [normalizedUsername, normalizedEmail]
  );
  return rows[0] || null;
}

async function createSession(pool, userId) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const ttlSeconds = getSessionTtlSeconds();

  await pool.query(
    `
    INSERT INTO market.user_sessions (
      user_id,
      session_token_hash,
      expires_at,
      last_seen_at
    ) VALUES ($1,$2,now() + ($3 || ' seconds')::interval, now())
  `,
    [userId, tokenHash, String(ttlSeconds)]
  );

  return {
    token,
    cookie: buildSessionCookie(token),
  };
}

async function revokeSession(pool, token) {
  if (!token) return;
  await pool.query(
    `
    UPDATE market.user_sessions
    SET revoked_at = now()
    WHERE session_token_hash = $1
      AND revoked_at IS NULL
  `,
    [hashSessionToken(token)]
  );
}

const LAST_SEEN_EVERY_MS = 5 * 60_000;
const lastSeenWrites = new Map(); // session id -> when this pod last wrote last_seen_at

async function getAuthenticatedUser(pool, req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.email_verified,
      ${profilePictureUrlSql("small")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
      u.can_manage_assets,
      u.can_create_prediction_markets,
      u.can_approve_prediction_markets,
      u.can_resolve_prediction_markets,
      u.can_void_prediction_markets,
      u.created_at,
      s.id AS session_id,
      s.expires_at
    FROM market.user_sessions s
    JOIN market.users u ON u.id = s.user_id
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1
  `,
    [tokenHash]
  );

  const user = rows[0] || null;
  if (!user) return null;

  // "Last seen" (the admin console shows it) moves at most every few minutes per session and pod,
  // not on every request: that write was a Postgres UPDATE per authenticated API call.
  const sessionKey = String(user.session_id);
  const now = Date.now();
  if ((lastSeenWrites.get(sessionKey) ?? 0) + LAST_SEEN_EVERY_MS <= now) {
    lastSeenWrites.set(sessionKey, now);
    if (lastSeenWrites.size > 50_000) lastSeenWrites.clear();
    await pool.query(
      `
      UPDATE market.user_sessions
      SET last_seen_at = now()
      WHERE id = $1
    `,
      [user.session_id]
    );
  }

  return user;
}

async function loginWithPassword(pool, { username, password }) {
  const safeUsername = String(username || "").trim();
  if (!safeUsername) {
    const error = new Error("invalid_username");
    error.code = "invalid_username";
    throw error;
  }
  const safePassword = validatePassword(password);
  const user = await findUserByLogin(pool, safeUsername);
  if (!user || !user.password_hash || !user.password_salt) {
    // Same work as a real check, so the response time doesn't say whether the account exists.
    await hashPassword(safePassword, "0000000000000000").catch(() => {});
    const error = new Error("invalid_credentials");
    error.code = "invalid_credentials";
    throw error;
  }
  if (!user.password_hash || !user.password_salt) {
    const error = new Error("invalid_credentials");
    error.code = "invalid_credentials";
    throw error;
  }

  const ok = await verifyPassword(safePassword, user);
  if (!ok) {
    const error = new Error("invalid_credentials");
    error.code = "invalid_credentials";
    throw error;
  }

  const session = await createSession(pool, user.id);
  return {
    user: publicUser(user),
    session,
  };
}

// ── Forgotten passwords ──────────────────────────────────────────────────────
// A reset link is good for an hour and once. Using it sets the new password, signs every other
// session out, and verifies the email (the link went to it).
const PASSWORD_RESET_TTL_MINUTES = 60;

const passwordResetSchema = `
  CREATE TABLE IF NOT EXISTS market.user_password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS market_user_password_reset_tokens_user_idx
    ON market.user_password_reset_tokens (user_id, created_at DESC);
`;

/**
 * Emails a reset link to the account `login` (a username or an email) names. Returns what
 * happened ("sent", "not_configured", "failed", or "no_account" / "too_soon" when nothing was
 * sent); the route tells the caller the same thing whatever it is, so this can't find accounts.
 */
async function requestPasswordReset(pool, login, { send = sendEmail } = {}) {
  const user = await findUserByLogin(pool, login);
  if (!user?.email) return "no_account";
  // One link a minute per account, whoever asks.
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM market.user_password_reset_tokens WHERE user_id = $1 AND created_at > now() - interval '1 minute' LIMIT 1`,
    [user.id]
  );
  if (recent.length) return "too_soon";

  const token = generateVerificationToken();
  await pool.query(
    `INSERT INTO market.user_password_reset_tokens (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [user.id, user.email, hashVerificationToken(token), String(PASSWORD_RESET_TTL_MINUTES)]
  );
  const resetUrl = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  const name = escapeHtml(user.username);
  const status = resetUrl
    ? await send({
      to: user.email,
      subject: "Reset your NASFAQ password",
      html:
        `<p>Someone asked to reset the password for your NASFAQ account, <b>${name}</b>.</p>` +
        `<p>Choose a new password here (the link works once, for an hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>` +
        `<p>If that wasn't you, ignore this email. Your password hasn't changed.</p>`,
      text:
        `Someone asked to reset the password for your NASFAQ account, ${user.username}.\n\n` +
        `Choose a new password here (the link works once, for an hour):\n${resetUrl}\n\n` +
        `If that wasn't you, ignore this email. Your password hasn't changed.`,
    })
    : "not_configured";
  if (status === "not_configured") {
    // eslint-disable-next-line no-console
    console.warn(`Password reset link for ${user.username}: ${resetUrl || token}`);
  }
  return status;
}

async function resetPassword(pool, { token, password }) {
  const safePassword = validatePassword(password);
  const hashed = await hashPassword(safePassword);
  const client = await pool.connect();
  let userId;
  try {
    await client.query("BEGIN");
    // The link is only good while the account still has the address it was sent to.
    const { rows } = await client.query(
      `SELECT t.id, t.user_id
       FROM market.user_password_reset_tokens t
       JOIN market.users u ON u.id = t.user_id AND lower(u.email) = lower(t.email)
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
       FOR UPDATE OF t`,
      [hashVerificationToken(String(token || ""))]
    );
    if (!rows[0]) {
      const error = new Error("invalid_reset_token");
      error.code = "invalid_reset_token";
      throw error;
    }
    userId = rows[0].user_id;
    await client.query(
      `UPDATE market.users
       SET password_hash = $2, password_salt = $3, password_params_json = $4::jsonb,
           email_verified = true, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [userId, hashed.hash, hashed.salt, JSON.stringify(hashed.params)]
    );
    // This link and any others still out are spent; every signed-in session ends.
    await client.query(`UPDATE market.user_password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await client.query(`UPDATE market.user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const session = await createSession(pool, userId);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.email_verified, ${profilePictureUrlSql("small")} AS profile_picture_url, u.profile_color,
            u.is_admin, u.can_manage_assets, u.can_create_prediction_markets, u.can_approve_prediction_markets,
            u.can_resolve_prediction_markets, u.can_void_prediction_markets, u.created_at
     FROM market.users u LEFT JOIN market.profile_pictures pp ON pp.id = u.profile_picture_id
     WHERE u.id = $1`,
    [userId]
  );
  return { user: publicUser(rows[0]), session };
}

module.exports = {
  buildExpiredSessionCookie,
  createSession,
  createUser,
  getAuthenticatedUser,
  getSessionTokenFromRequest,
  loginWithPassword,
  passwordResetSchema,
  publicUser,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  sendVerificationEmail,
  verifyEmailToken,
};
