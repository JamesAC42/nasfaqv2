const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const email = require("../src/services/email");
const auth = require("../src/services/auth");

const env = { RESEND_API_KEY: "re_secret_key", AUTH_EMAIL_FROM: "NASFAQ <noreply@auth.example>" };

test("sendEmail: Resend when configured, nothing (and no throw) otherwise", async () => {
  assert.equal(await email.sendEmail({ to: "a@b.c", subject: "s" }, { env: {}, fetchImpl: async () => assert.fail("not configured, no send") }), "not_configured");

  const calls = [];
  const fetchImpl = async (url, init) => (calls.push([url, init]), { ok: true });
  assert.equal(await email.sendEmail({ to: "a@b.c", subject: "Hi", html: "<p>x</p>", text: "x" }, { env, fetchImpl }), "sent");
  assert.equal(calls[0][0], "https://api.resend.com/emails");
  assert.equal(calls[0][1].headers.Authorization, "Bearer re_secret_key");
  assert.deepEqual(JSON.parse(calls[0][1].body), { from: env.AUTH_EMAIL_FROM, to: "a@b.c", subject: "Hi", html: "<p>x</p>", text: "x" });

  const logged = [];
  const logger = { error: (line) => logged.push(line) };
  const rejected = async () => ({ ok: false, status: 403, text: async () => '{"message":"The auth.example domain is not verified"}' });
  assert.equal(await email.sendEmail({ to: "a@b.c", subject: "Hi" }, { env, fetchImpl: rejected, logger }), "failed");
  assert.equal(await email.sendEmail({ to: "a@b.c", subject: "Hi" }, { env, fetchImpl: async () => { throw new Error("socket hang up"); }, logger }), "failed");
  assert.match(logged[0], /403.*not verified/);
  assert.ok(logged.every((line) => !line.includes("re_secret_key")));
});

test("appUrl joins the public base URL and a path", () => {
  assert.equal(email.appUrl("/reset-password?token=x", { PUBLIC_APP_BASE_URL: "https://holo.nasfaq.biz/" }), "https://holo.nasfaq.biz/reset-password?token=x");
  assert.equal(email.appUrl("verify-email", { PUBLIC_APP_BASE_URL: "http://localhost:3010" }), "http://localhost:3010/verify-email");
  assert.equal(email.appUrl("/x", {}), null);
  assert.equal(email.escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
});

// Against a real database when CI provides one: its own, so these users stubs can't collide with
// the other tests'.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
test("password reset against PostgreSQL", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("CREATE DATABASE nasfaq_auth_test");
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_auth_test";
  const pool = new Pool({ connectionString: target.href });
  const savedBase = process.env.PUBLIC_APP_BASE_URL;
  process.env.PUBLIC_APP_BASE_URL = "https://holo.example";
  const savedWarn = console.warn;
  console.warn = () => {}; // sign-up logs its (unsent) verification link
  t.after(async () => {
    console.warn = savedWarn;
    if (savedBase === undefined) delete process.env.PUBLIC_APP_BASE_URL;
    else process.env.PUBLIC_APP_BASE_URL = savedBase;
    await pool.end();
  });

  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    DROP TABLE IF EXISTS market.user_password_reset_tokens, market.user_email_verification_tokens, market.user_sessions, market.users, market.profile_pictures;
    CREATE TABLE market.profile_pictures (id bigint PRIMARY KEY, is_deleted boolean NOT NULL DEFAULT false, filename_small text, filename_large text);
    CREATE TABLE market.users (
      id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, username_normalized TEXT NOT NULL UNIQUE,
      email TEXT, email_verified BOOLEAN NOT NULL DEFAULT false, email_verified_at TIMESTAMPTZ,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_params_json JSONB NOT NULL,
      profile_picture_id BIGINT, profile_reaction TEXT, profile_color TEXT,
      is_admin BOOLEAN NOT NULL DEFAULT false, can_manage_assets BOOLEAN NOT NULL DEFAULT false,
      can_create_prediction_markets BOOLEAN NOT NULL DEFAULT false, can_approve_prediction_markets BOOLEAN NOT NULL DEFAULT false,
      can_resolve_prediction_markets BOOLEAN NOT NULL DEFAULT false, can_void_prediction_markets BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX ON market.users (lower(email)) WHERE email IS NOT NULL;
    CREATE TABLE market.user_sessions (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      session_token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE market.user_email_verification_tokens (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE, email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(auth.passwordResetSchema);
  await pool.query(auth.passwordResetSchema); // idempotent, like every migration

  const user = await auth.createUser(pool, { username: "Peko Fan", email: "Peko@Example.com", password: "old password" });
  const oldSession = await auth.createSession(pool, user.id);
  const sent = [];
  const send = async (message) => (sent.push(message), "sent");
  const tokenOf = (message) => new URL(message.text.match(/https:\S+/)[0]).searchParams.get("token");

  // Nothing is sent for an unknown account; by email (any case) or username, the link goes to the account's address.
  assert.equal(await auth.requestPasswordReset(pool, "nobody@example.com", { send }), "no_account");
  assert.equal(await auth.requestPasswordReset(pool, "peko@example.com", { send }), "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "peko@example.com"); // stored lower-case at sign-up
  assert.match(sent[0].text, /Peko Fan/);
  assert.match(sent[0].text, /https:\/\/holo\.example\/reset-password\?token=[\w-]{40,}\n/);
  assert.equal(await auth.requestPasswordReset(pool, "peko fan", { send }), "too_soon"); // one a minute
  const { rows: stored } = await pool.query(`SELECT token_hash FROM market.user_password_reset_tokens`);
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, tokenOf(sent[0])); // only the hash is kept

  await assert.rejects(auth.resetPassword(pool, { token: "nope", password: "new password" }), { code: "invalid_reset_token" });
  await assert.rejects(auth.resetPassword(pool, { token: tokenOf(sent[0]), password: "short" }), { code: "invalid_password" });

  // A second link is out too; using the first spends both.
  await pool.query(`UPDATE market.user_password_reset_tokens SET created_at = now() - interval '2 minutes'`);
  assert.equal(await auth.requestPasswordReset(pool, "Peko Fan", { send }), "sent");
  const result = await auth.resetPassword(pool, { token: tokenOf(sent[0]), password: "new password" });
  assert.equal(result.user.username, "Peko Fan");
  assert.equal(result.user.email_verified, true); // the link proved the address
  assert.match(result.session.cookie, /nasfaq_session=/);
  await assert.rejects(auth.resetPassword(pool, { token: tokenOf(sent[0]), password: "another one" }), { code: "invalid_reset_token" });
  await assert.rejects(auth.resetPassword(pool, { token: tokenOf(sent[1]), password: "another one" }), { code: "invalid_reset_token" });

  // Signed out everywhere else; the old password is dead and the new one works.
  const { rows: sessions } = await pool.query(`SELECT session_token_hash, revoked_at FROM market.user_sessions WHERE user_id = $1 ORDER BY id`, [user.id]);
  assert.equal(sessions.length, 2);
  assert.ok(sessions[0].revoked_at);
  assert.equal(sessions[1].revoked_at, null);
  assert.equal(await auth.getAuthenticatedUser(pool, { headers: { cookie: `nasfaq_session=${oldSession.token}` } }), null);
  await assert.rejects(auth.loginWithPassword(pool, { username: "Peko Fan", password: "old password" }), { code: "invalid_credentials" });
  assert.equal((await auth.loginWithPassword(pool, { username: "peko@example.com", password: "new password" })).user.id, user.id);

  // Expired links, and links to an address the account no longer has, don't work.
  await pool.query(`UPDATE market.user_password_reset_tokens SET created_at = now() - interval '2 minutes'`);
  assert.equal(await auth.requestPasswordReset(pool, "Peko Fan", { send }), "sent");
  await pool.query(`UPDATE market.user_password_reset_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`);
  await assert.rejects(auth.resetPassword(pool, { token: tokenOf(sent[2]), password: "new password 2" }), { code: "invalid_reset_token" });
  await pool.query(`UPDATE market.user_password_reset_tokens SET created_at = now() - interval '2 minutes'`);
  assert.equal(await auth.requestPasswordReset(pool, "Peko Fan", { send }), "sent");
  await pool.query(`UPDATE market.users SET email = 'someone.else@example.com' WHERE id = $1`, [user.id]);
  await assert.rejects(auth.resetPassword(pool, { token: tokenOf(sent[3]), password: "new password 3" }), { code: "invalid_reset_token" });
});
