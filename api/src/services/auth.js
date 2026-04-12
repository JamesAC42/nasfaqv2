const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME || "nasfaq_session";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const PASSWORD_KEYLEN = 64;
const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

function profilePictureUrlSql(size, alias = "pp") {
  const field = size === "large" ? "filename_large" : "filename_small";
  const folder = size === "large" ? "large" : "small";
  return `CASE WHEN ${alias}.id IS NULL OR ${alias}.is_deleted THEN NULL ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/${folder}/' || ${alias}.${field} END`;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function validateUsername(username) {
  const trimmed = String(username || "").trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(trimmed)) {
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

function getSessionTtlSeconds() {
  const days = Number.isFinite(SESSION_TTL_DAYS) && SESSION_TTL_DAYS > 0 ? SESSION_TTL_DAYS : 30;
  return Math.floor(days * 24 * 60 * 60);
}

function buildSessionCookie(token) {
  const maxAge = getSessionTtlSeconds();
  const secure = (process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "true";
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
  const secure = (process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "true";
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

async function createUser(pool, { username, password }) {
  const safeUsername = validateUsername(username);
  const safePassword = validatePassword(password);
  const normalized = normalizeUsername(safeUsername);
  const hashed = await hashPassword(safePassword);

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO market.users (
        username,
        username_normalized,
        password_hash,
        password_salt,
        password_params_json,
        is_admin,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,false,now())
      RETURNING id, username, NULL::TEXT AS profile_picture_url, profile_color, is_admin, created_at
    `,
      [safeUsername, normalized, hashed.hash, hashed.salt, JSON.stringify(hashed.params)]
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") {
      const e = new Error("username_taken");
      e.code = "username_taken";
      throw e;
    }
    throw error;
  }
}

async function findUserByUsername(pool, username) {
  const normalized = normalizeUsername(username);
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.username_normalized,
      u.password_hash,
      u.password_salt,
      u.password_params_json,
      ${profilePictureUrlSql("small")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
      u.created_at
    FROM market.users u
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE u.username_normalized = $1
    LIMIT 1
  `,
    [normalized]
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

async function getAuthenticatedUser(pool, req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      ${profilePictureUrlSql("small")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
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

  await pool.query(
    `
    UPDATE market.user_sessions
    SET last_seen_at = now()
    WHERE id = $1
  `,
    [user.session_id]
  );

  return user;
}

async function loginWithPassword(pool, { username, password }) {
  const safeUsername = validateUsername(username);
  const safePassword = validatePassword(password);
  const user = await findUserByUsername(pool, safeUsername);
  if (!user) {
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
    user: {
      id: user.id,
      username: user.username,
      profile_picture_url: user.profile_picture_url || null,
      profile_color: user.profile_color || null,
      is_admin: Boolean(user.is_admin),
      created_at: user.created_at,
    },
    session,
  };
}

module.exports = {
  buildExpiredSessionCookie,
  createSession,
  createUser,
  getAuthenticatedUser,
  getSessionTokenFromRequest,
  loginWithPassword,
  revokeSession,
};
