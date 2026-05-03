const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME || "nasfaq_session";
const SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const EMAIL_VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24);
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
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

function buildVerificationUrl(token) {
  const baseUrl = String(process.env.PUBLIC_APP_BASE_URL || "").trim().replace(/\/+$/, "");
  const path = process.env.EMAIL_VERIFICATION_PATH || "/verify-email";
  if (!baseUrl) return null;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail(pool, user) {
  if (!user?.id || !user?.email || user.email_verified) return;
  const token = await createEmailVerificationToken(pool, user.id, user.email);
  const verificationUrl = buildVerificationUrl(token);
  if (!verificationUrl) {
    // eslint-disable-next-line no-console
    console.warn(`Email verification link for ${user.email}: ${token}`);
    return;
  }

  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.AUTH_EMAIL_FROM || "").trim();
  if (!resendApiKey || !from) {
    // eslint-disable-next-line no-console
    console.warn(`Email verification link for ${user.email}: ${verificationUrl}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: user.email,
      subject: "Verify your NASFAQ account",
      html: `<p>Verify your NASFAQ account by opening this link:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires soon.</p>`,
      text: `Verify your NASFAQ account: ${verificationUrl}`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error("verification email send failed:", response.status, body);
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
       OR u.email = $2
    LIMIT 1
  `,
    [normalizedUsername, normalizedEmail]
  );
  return rows[0] || null;
}

async function findUserByGoogleSub(pool, googleSub) {
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
      u.created_at
    FROM market.users u
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE u.google_sub = $1
    LIMIT 1
  `,
    [googleSub]
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
  const safeUsername = String(username || "").trim();
  if (!safeUsername) {
    const error = new Error("invalid_username");
    error.code = "invalid_username";
    throw error;
  }
  const safePassword = validatePassword(password);
  const user = await findUserByLogin(pool, safeUsername);
  if (!user) {
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

function normalizeGoogleUsernameBase(email, name) {
  const firstName = String(name || "").trim().split(/\s+/)[0] || String(email?.split("@")[0] || "user").split(/[._-]+/)[0];
  let base = firstName
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20) || "user";
  if (!/^[A-Za-z]/.test(base)) base = `user_${base}`;
  if (base.length < 3) base = `${base}_user`.slice(0, 20);
  return base;
}

async function verifyGoogleIdToken(idToken) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) {
    const error = new Error("google_auth_not_configured");
    error.code = "google_auth_not_configured";
    throw error;
  }
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(idToken || ""))}`);
  if (!response.ok) {
    const error = new Error("invalid_google_token");
    error.code = "invalid_google_token";
    throw error;
  }
  const payload = await response.json();
  if (payload.aud !== clientId || !payload.sub || !payload.email) {
    const error = new Error("invalid_google_token");
    error.code = "invalid_google_token";
    throw error;
  }
  return {
    sub: String(payload.sub),
    email: validateEmail(payload.email),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: String(payload.name || ""),
  };
}

async function createOrLoginWithGoogle(pool, { idToken }) {
  const profile = await verifyGoogleIdToken(idToken);
  let user = await findUserByGoogleSub(pool, profile.sub);
  if (!user) {
    const existing = await findUserByLogin(pool, profile.email);
    if (existing) {
      const { rows } = await pool.query(
        `
        UPDATE market.users
        SET google_sub = $1,
            email_verified = CASE WHEN $2::boolean THEN true ELSE email_verified END,
            email_verified_at = CASE WHEN $2::boolean THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END,
            updated_at = now()
        WHERE id = $3
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
        [profile.sub, profile.emailVerified, existing.id]
      );
      user = rows[0];
    } else {
      const baseUsername = normalizeGoogleUsernameBase(profile.email, profile.name);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const username = validateUsername(`${baseUsername.slice(0, 24)}${crypto.randomInt(1000, 9999)}`);
        const unusablePassword = await hashPassword(crypto.randomBytes(32).toString("base64url"));
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
              email_verified_at,
              google_sub,
              is_admin,
              can_manage_assets,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,CASE WHEN $7::boolean THEN now() ELSE NULL END,$8,false,false,now())
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
            [
              username,
              normalizeUsername(username),
              profile.email,
              unusablePassword.hash,
              unusablePassword.salt,
              JSON.stringify(unusablePassword.params),
              profile.emailVerified,
              profile.sub,
            ]
          );
          user = rows[0];
          break;
        } catch (error) {
          if (error?.code !== "23505") throw error;
        }
      }
    }
  }

  if (!user) {
    const error = new Error("google_login_failed");
    error.code = "google_login_failed";
    throw error;
  }

  const session = await createSession(pool, user.id);
  return { user: publicUser(user), session };
}

module.exports = {
  buildExpiredSessionCookie,
  createOrLoginWithGoogle,
  createSession,
  createUser,
  getAuthenticatedUser,
  getSessionTokenFromRequest,
  loginWithPassword,
  publicUser,
  revokeSession,
  sendVerificationEmail,
  verifyEmailToken,
};
