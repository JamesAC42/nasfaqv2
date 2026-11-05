const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const adminRoutes = require("../src/routes/admin");
const adminUsers = require("../src/services/adminUsers");
const { emailChangedEmail } = require("../src/services/emailTemplates");

/** An app with the admin routes behind `ctx` (a function of the request). */
async function serve(t, ctx) {
  const app = express();
  app.use(async (req, _res, next) => {
    try {
      req.ctx = await ctx(req);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error?.message || error) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  return async (method, path, { body, cookie } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const WRITES = [
  ["PATCH", "/users/2/username", { username: "new_name" }],
  ["PATCH", "/users/2/email", { email: "new@example.test", reason: "typo", confirm: true }],
  ["POST", "/users/2/clear-bio", {}],
  ["POST", "/users/2/sign-out", {}],
  ["POST", "/users/2/verification-email", {}],
  ["POST", "/users/2/password-reset-email", {}],
];
const READS = [
  ["GET", "/users/directory"],
  ["GET", "/users/2"],
  ["POST", "/users/find-by-email", { email: "a@example.test" }],
];

test("list query: only known sorts and filters get through, and everything else falls back", () => {
  assert.deepEqual(adminUsers.parseListQuery({}), { q: "", filter: "all", sort: "joined", dir: "desc", page: 1, limit: 50 });
  assert.deepEqual(adminUsers.parseListQuery({ q: "  PeKo ", filter: "staff", sort: "username", page: "3", limit: "10" }), {
    q: "peko",
    filter: "staff",
    sort: "username",
    dir: "asc",
    page: 3,
    limit: 10,
  });
  const hostile = adminUsers.parseListQuery({ sort: "u.password_hash; DROP TABLE market.users", filter: "true OR 1=1", dir: "sideways", page: "-4", limit: "100000" });
  assert.deepEqual(hostile, { q: "", filter: "all", sort: "joined", dir: "desc", page: 1, limit: 100 });
  // Inherited keys aren't sort columns.
  assert.equal(adminUsers.parseListQuery({ sort: "constructor" }).sort, "joined");
  assert.equal(adminUsers.parseListQuery({ filter: "toString" }).filter, "all");
  assert.equal(adminUsers.parseListQuery({ sort: "cash", dir: "asc" }).dir, "asc");
});

test("the email-changed notice masks what it's given and escapes the name", () => {
  const notice = emailChangedEmail({ username: "<b>peko</b>", newEmailMasked: "pe****@usada.jp", url: "https://holo.nasfaq.biz/rules" }, { PUBLIC_APP_BASE_URL: "https://holo.nasfaq.biz" });
  assert.match(notice.html, /pe\*\*\*\*@usada\.jp/);
  assert.match(notice.html, /&lt;b&gt;peko/);
  assert.doesNotMatch(notice.html, /<b>peko/);
  assert.match(notice.text, /pe\*\*\*\*@usada\.jp/);
});

test("user routes: signed out 401, players 403, before any query", async (t) => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("no connection expected");
    },
  };
  let user = null;
  const call = await serve(t, () => ({ pool, redis: null, user }));

  for (const [method, path, body] of [...READS, ...WRITES]) assert.equal((await call(method, path, { body })).status, 401, `signed out: ${path}`);
  user = { id: 9, username: "pleb", is_admin: false, can_manage_assets: true, can_void_prediction_markets: true };
  for (const [method, path, body] of [...READS, ...WRITES]) assert.equal((await call(method, path, { body })).status, 403, `staff, not admin: ${path}`);
  assert.equal(queries.length, 0, "nothing runs before the admin check");

  // A bad id or body is refused before anything is written.
  user = { id: 1, username: "boss", is_admin: true };
  for (const [method, path, body] of WRITES) {
    assert.deepEqual((await call(method, path.replace("/2/", "/abc/"), { body })).body, { error: "invalid_user_id" }, path);
  }
  assert.deepEqual((await call("GET", "/users/abc")).body, { error: "invalid_user_id" });
  assert.deepEqual((await call("POST", "/users/find-by-email", { body: { email: "no-at-sign" } })).body, { error: "invalid_email" });
  assert.deepEqual((await call("PATCH", "/users/2/email", { body: { email: "a@example.test", confirm: true } })).body, { error: "reason_required", field: "reason" });
  assert.deepEqual((await call("PATCH", "/users/2/email", { body: { email: "a@example.test", reason: "typo" } })).body, { error: "email_change_needs_confirm" });
  assert.deepEqual((await call("PATCH", "/users/2/email", { body: { email: "not an address", reason: "typo", confirm: true } })).body, { error: "invalid_email" });
  assert.deepEqual((await call("PATCH", "/users/2/email", { body: { email: "x@mailinator.com", reason: "typo", confirm: true } })).body, { error: "disposable_email" });
  assert.deepEqual((await call("POST", "/users/1/sign-out", { body: {} })).body, { error: "cannot_sign_out_self" });
  assert.equal(queries.length, 0);
});

// End to end on a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("/admin/users end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_admin_users_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_admin_users_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_admin_users_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const netWorth = require("../src/services/netWorth");
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  t.after(() => {
    [console.warn, console.log, console.info] = quiet;
  });
  await applySchema(pool);

  const PASSWORD_HASH = "9f".repeat(64);
  const PASSWORD_SALT = "a1b2c3d4e5f6a7b8";
  const addUser = async (username, { isAdmin = false, verified = true, email = `${username}@example.test`, role = null, createdDaysAgo = 30, bio = null } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_normalized, email_verified, password_hash, password_salt, password_params_json, is_admin, bio, created_at)
       VALUES ($1, lower($1), $2, lower($2), $3, $4, $5, '{}', $6, $7, now() - make_interval(days => $8)) RETURNING id`,
      [username, email, verified, PASSWORD_HASH, PASSWORD_SALT, isAdmin, bio, createdDaysAgo]
    );
    const id = Number(rows[0].id);
    if (role) await pool.query(`UPDATE market.users SET ${role} = true WHERE id = $1`, [id]);
    return id;
  };
  const bossId = await addUser("boss", { isAdmin: true, createdDaysAgo: 400 });
  const deputyId = await addUser("deputy", { isAdmin: true, createdDaysAgo: 300 });
  const aliceId = await addUser("alice", { verified: false, createdDaysAgo: 1, bio: "Buy my course at example dot test" });
  const bobId = await addUser("bob", { createdDaysAgo: 20 });
  const carolId = await addUser("carol", { createdDaysAgo: 10, role: "can_manage_assets" });
  const dottyId = await addUser("dotty", { email: "dot.ty+stocks@gmail.com", createdDaysAgo: 5 });
  await pool.query(`UPDATE market.users SET email_normalized = 'dotty@gmail.com' WHERE id = $1`, [dottyId]);
  const quietId = await addUser("100_percent", { createdDaysAgo: 60 });
  const noEmailId = await addUser("no_mail", { createdDaysAgo: 70 });
  await pool.query(`UPDATE market.users SET email = NULL, email_normalized = NULL, email_verified = false WHERE id = $1`, [noEmailId]);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) VALUES ($1, 5000), ($2, 250), ($3, 90000)`, [aliceId, bobId, carolId]);

  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const boss = await cookieFor(bossId);
  const bobCookie = await cookieFor(bobId);
  await pool.query(`UPDATE market.user_sessions SET last_seen_at = now() - interval '2 days' WHERE user_id = $1`, [bobId]);

  const published = [];
  const redis = {
    async publish(channel, message) {
      published.push({ channel, ...JSON.parse(message) });
    },
    async incr() {
      return 1;
    },
    async expire() {},
  };
  const call = await serve(t, async (req) => ({ pool, redis, user: await auth.getAuthenticatedUser(pool, req) }));
  const list = async (query = "") => (await call("GET", `/users/directory${query}`, { cookie: boss })).body;
  const detail = async (id) => (await call("GET", `/users/${id}`, { cookie: boss })).body;
  const names = (result) => result.users.map((user) => user.username);
  const logFor = async (id) => (await detail(id)).history;

  /** Nothing an admin reads carries a hash, a token, session data or a whole address. */
  const assertNoSecrets = (body, addresses = []) => {
    const text = JSON.stringify(body);
    for (const secret of [PASSWORD_HASH, PASSWORD_SALT, "password_hash", "password_salt", "password_params", "session_token", "token_hash", "last_ip_hash", "signup_ip_hash", "email_normalized", ...addresses]) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  };
  const allAddresses = ["boss@example.test", "alice@example.test", "bob@example.test", "dot.ty+stocks@gmail.com", "dotty@gmail.com"];

  await t.test("the list: every account, sorted, filtered and a page at a time", async () => {
    const all = await list("?limit=100");
    assert.equal(all.total, 8);
    assert.deepEqual(names(all), ["alice", "dotty", "carol", "bob", "100_percent", "no_mail", "deputy", "boss"], "newest first by default");
    assert.deepEqual(all.counts, { all: 8, unverified: 2, suspended: 0, frozen: 0, staff: 3, new: 2 });
    assertNoSecrets(all, allAddresses);
    const alice = all.users.find((user) => user.id === aliceId);
    assert.equal(alice.email_masked, "al***@example.test");
    assert.equal(alice.cash, 5000);
    assert.equal(alice.email_verified, false);
    assert.equal(Object.hasOwn(alice, "email"), false);

    assert.deepEqual(names(await list("?sort=username&limit=3")), ["100_percent", "alice", "bob"]);
    assert.deepEqual(names(await list("?sort=username&dir=desc&limit=2")), ["no_mail", "dotty"]);
    assert.deepEqual(names(await list("?sort=cash&limit=3")), ["carol", "alice", "bob"]);
    assert.deepEqual(names(await list("?sort=cash&dir=asc&limit=3")), ["bob", "alice", "carol"], "accounts with no cash row go last either way");
    assert.equal((await list("?sort=last_seen&limit=2")).users[0].username, "boss");
    const injected = await list(`?sort=${encodeURIComponent("u.password_hash")}&limit=1`);
    assert.equal(injected.sort, "joined");

    const page2 = await list("?sort=username&limit=3&page=2");
    assert.deepEqual([page2.total, page2.page, names(page2)], [8, 2, ["boss", "carol", "deputy"]]);
    assert.deepEqual((await list("?page=99")).users, []);

    assert.deepEqual(names(await list("?filter=unverified&sort=username")), ["alice", "no_mail"]);
    assert.deepEqual(names(await list("?filter=staff&sort=username")), ["boss", "carol", "deputy"]);
    assert.deepEqual(names(await list("?filter=new&sort=username")), ["alice", "dotty"]);
  });

  await t.test("search: part of a username or an account number, never part of an address", async () => {
    assert.deepEqual(names(await list("?q=AL")), ["alice"]);
    const byId = await list(`?q=${encodeURIComponent(`#${bobId}`)}`);
    assert.deepEqual(names(byId), ["bob"]);
    assert.ok(names(await list(`?q=${bobId}`)).includes("bob"));
    assert.equal((await list(`?q=${encodeURIComponent("%")}`)).total, 0, "% is a character, not a wildcard");
    assert.deepEqual(names(await list("?q=_&sort=username")), ["100_percent", "no_mail"], "_ is a character, not a wildcard");
    assert.equal((await list(`?q=${encodeURIComponent("alice@example.test")}`)).total, 0, "addresses go through find-by-email");
    assert.equal((await list("?q=example")).total, 0);
  });

  await t.test("find by email: the whole address or nothing, as its inbox sees it", async () => {
    const find = async (email) => (await call("POST", "/users/find-by-email", { cookie: boss, body: { email } })).body;
    const found = await find("  ALICE@example.test ");
    assert.deepEqual(names(found), ["alice"]);
    assert.equal(found.users[0].email_masked, "al***@example.test");
    assertNoSecrets(found, allAddresses);
    assert.deepEqual(names(await find("dot.ty+stocks@gmail.com")), ["dotty"]);
    assert.deepEqual(names(await find("do.t.t.y+anything@googlemail.com")), ["dotty"], "Gmail dots and +tags are the same inbox");
    for (const partial of ["alice@", "@example.test", "ali@example.test", "alice@example"]) assert.deepEqual((await find(partial)).users, [], partial);
  });

  await t.test("the detail: what an admin needs, without the secrets", async () => {
    assert.equal((await call("GET", "/users/999999", { cookie: boss })).status, 404);
    await pool.query(`INSERT INTO market.user_email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, 'alice@example.test', 'hash-of-a-token', now() + interval '1 day')`, [aliceId]);
    const alice = await detail(aliceId);
    assert.equal(alice.user.username, "alice");
    assert.equal(alice.bio, "Buy my course at example dot test");
    assert.ok(alice.verification_sent_at);
    assert.equal(alice.password_reset_sent_at, null);
    assert.deepEqual(alice.chat_reports, { open: 0, total: 0 });
    assert.deepEqual(alice.chat_restrictions, []);
    assert.equal(alice.v1_link, null);
    assert.deepEqual(alice.history, []);
    assertNoSecrets(alice, [...allAddresses, "hash-of-a-token"]);

    // Only this player's mutes and bans, reports against their own messages, and their v1 link.
    const chatDb = require("../src/chatDb");
    await chatDb.ensureChatTopology(pool);
    const room = await chatDb.getChannelByKey(pool, "market:global", { includeInactive: true });
    const { message } = await chatDb.createMessage(pool, { channelId: room.id, viewer: { id: carolId, is_admin: false }, body: "buy my course" });
    await pool.query(`INSERT INTO chat.message_reports (message_id, reporter_id, reason) VALUES ($1, $2, 'Spam')`, [message.id, bobId]);
    await pool.query(`INSERT INTO chat.message_reports (message_id, reporter_id, reason, status) VALUES ($1, $2, 'Spam', 'dismissed')`, [message.id, aliceId]);
    await chatDb.createModerationAction(pool, { targetUserId: carolId, moderatorId: bossId, actionType: "mute", durationMinutes: 60, reason: "Cool off" });
    await chatDb.createModerationAction(pool, { targetUserId: bobId, moderatorId: bossId, actionType: "ban", reason: "Someone else" });
    await pool.query(
      `INSERT INTO market.v1_account_links (user_id, v1_user_id, v1_username, v1_joined_at) VALUES ($1, '00000000-0000-4000-8000-000000000001', 'old_carol', '2021-04-01T00:00:00Z')`,
      [carolId]
    );
    const carol = await detail(carolId);
    assert.deepEqual(carol.chat_reports, { open: 1, total: 2 });
    assert.deepEqual(carol.chat_restrictions.map((entry) => [entry.action_type, entry.reason, entry.created_by]), [["mute", "Cool off", "boss"]]);
    assert.equal(carol.v1_link.v1_username, "old_carol");
    assert.ok(!JSON.stringify(carol).includes("00000000-0000-4000"), "the v1 account's id isn't needed here");
    assert.equal(carol.user.net_worth, null, "no leaderboard row yet");
    assert.deepEqual((await detail(aliceId)).chat_reports, { open: 0, total: 0 });
    await chatDb.revokeModerationActions(pool, { targetUserId: carolId, actionType: "mute" });
    await chatDb.revokeModerationActions(pool, { targetUserId: bobId, actionType: "ban" });
    assert.deepEqual((await detail(carolId)).chat_restrictions, []);
  });

  await t.test("verifying a player is the existing role patch, and it lands on their history", async () => {
    assert.equal((await call("PATCH", `/users/${aliceId}/roles`, { cookie: bobCookie, body: { email_verified: true } })).status, 403);
    assert.equal((await detail(aliceId)).user.email_verified, false);
    const verified = await call("PATCH", `/users/${aliceId}/roles`, { cookie: boss, body: { email_verified: true } });
    assert.deepEqual(verified.body.changed, ["email_verified"]);
    const after = await detail(aliceId);
    assert.equal(after.user.email_verified, true);
    assert.ok(after.user.email_verified_at);
    assert.equal(after.history[0].action, "user.roles");
    assert.equal(after.history[0].actor.username, "boss");
    assert.deepEqual(after.history[0].details, { email_verified: true });
    assert.ok(after.history[0].created_at);
    // Back to unverified for the email tests further down.
    await pool.query(`UPDATE market.users SET email_verified = false, email_verified_at = NULL WHERE id = $1`, [aliceId]);
  });

  await t.test("rename: the rules still apply, the wait doesn't, and the log has both names", async () => {
    await netWorth.refreshCurrentLeaderboard(pool, { userIds: [bobId] });
    const rename = (id, username, cookie = boss) => call("PATCH", `/users/${id}/username`, { cookie, body: { username, reason: "Asked on Discord" } });

    assert.equal((await rename(carolId, "bob_two", bobCookie)).status, 403);
    assert.deepEqual((await rename(bobId, "x")).body, { error: "invalid_username" });
    assert.deepEqual((await rename(bobId, "has@sign")).body, { error: "invalid_username" });
    assert.deepEqual((await rename(bobId, "nasfaq_admin")).body, { error: "username_reserved" });
    assert.deepEqual((await rename(bobId, "alice")).body, { error: "username_taken" });
    assert.deepEqual((await rename(bobId, "ALICE")).body, { error: "username_taken" });
    assert.deepEqual((await rename(999999, "someone_new")).body, { error: "profile_not_found" });
    assert.deepEqual(await logFor(bobId), [], "a refused rename logs nothing");

    // Unverified, and inside a player's own 7-day wait: an admin can still fix it.
    await pool.query(`UPDATE market.users SET username_changed_at = now() - interval '1 day' WHERE id = $1`, [aliceId]);
    const changedBefore = (await pool.query(`SELECT username_changed_at FROM market.users WHERE id = $1`, [aliceId])).rows[0].username_changed_at;
    const fixed = await rename(aliceId, "Alice Wonder");
    assert.deepEqual(fixed.body, { before: "alice", after: "Alice Wonder", changed: true });
    const { rows } = await pool.query(`SELECT username, username_normalized, username_changed_at FROM market.users WHERE id = $1`, [aliceId]);
    assert.deepEqual([rows[0].username, rows[0].username_normalized], ["Alice Wonder", "alice wonder"]);
    assert.deepEqual(rows[0].username_changed_at, changedBefore, "the player's own wait is left as it was");

    const entry = (await logFor(aliceId))[0];
    assert.deepEqual([entry.action, entry.target_label, entry.reason, entry.actor.username], ["user.rename", "Alice Wonder", "Asked on Discord", "boss"]);
    assert.deepEqual(entry.details, { before: "alice", after: "Alice Wonder" });

    // The same name changes nothing and logs nothing; capitals alone are a rename.
    const logged = (await logFor(aliceId)).length;
    assert.deepEqual((await rename(aliceId, "Alice Wonder")).body.changed, false);
    assert.equal((await logFor(aliceId)).length, logged);
    assert.equal((await rename(aliceId, "ALICE WONDER")).body.changed, true);

    // The leaderboard's copy of the name follows.
    assert.equal((await rename(bobId, "robert")).status, 200);
    const { rows: board } = await pool.query(`SELECT username_snapshot FROM market.user_leaderboard_current WHERE user_id = $1`, [bobId]);
    assert.equal(board[0].username_snapshot, "robert");

    await pool.query(`UPDATE market.users SET username = 'alice', username_normalized = 'alice', username_changed_at = NULL WHERE id = $1`, [aliceId]);
  });

  await t.test("clear bio: only the bio, once, and the log keeps what it said", async () => {
    const clear = () => call("POST", `/users/${aliceId}/clear-bio`, { cookie: boss, body: { reason: "Advertising" } });
    assert.equal((await call("POST", `/users/${aliceId}/clear-bio`, { cookie: bobCookie, body: {} })).status, 403);
    assert.deepEqual((await clear()).body, { changed: true });
    const after = await detail(aliceId);
    assert.deepEqual([after.bio, after.user.username], [null, "alice"]);
    assert.deepEqual([after.history[0].action, after.history[0].reason, after.history[0].details.bio], ["user.clear_bio", "Advertising", "Buy my course at example dot test"]);
    const logged = after.history.length;
    assert.deepEqual((await clear()).body, { changed: false });
    assert.equal((await logFor(aliceId)).length, logged);
    assert.equal((await call("POST", "/users/999999/clear-bio", { cookie: boss, body: {} })).status, 404);
  });

  await t.test("sign out: every session ends, open sockets close, and nobody signs out themselves", async () => {
    const carol1 = await cookieFor(carolId);
    const carol2 = await cookieFor(carolId);
    assert.equal((await call("POST", `/users/${carolId}/sign-out`, { cookie: bobCookie, body: {} })).status, 403);
    assert.equal((await call("GET", "/users/directory", { cookie: carol1 })).status, 403, "still signed in");

    published.length = 0;
    const out = await call("POST", `/users/${carolId}/sign-out`, { cookie: boss, body: { reason: "Stolen cookie" } });
    assert.deepEqual(out.body, { sessions_revoked: 2 });
    assert.deepEqual(published, [{ channel: auth.SESSIONS_REVOKED_CHANNEL, user_id: carolId }]);
    for (const cookie of [carol1, carol2]) assert.equal((await call("GET", "/users/directory", { cookie })).status, 401);
    const entry = (await logFor(carolId))[0];
    assert.deepEqual([entry.action, entry.reason, entry.details.sessions_revoked, entry.actor.username], ["user.sign_out", "Stolen cookie", 2, "boss"]);

    assert.deepEqual((await call("POST", `/users/${bossId}/sign-out`, { cookie: boss, body: {} })).body, { error: "cannot_sign_out_self" });
    assert.equal((await call("POST", "/users/999999/sign-out", { cookie: boss, body: {} })).status, 404);
    assert.equal((await call("GET", "/users/directory", { cookie: boss })).status, 200, "the admin stayed signed in");
  });

  await t.test("suspending closes the player's open sockets too", async () => {
    await cookieFor(quietId);
    published.length = 0;
    const suspended = await call("PATCH", `/users/${quietId}/suspension`, { cookie: boss, body: { suspended: true, duration: "24h", reason: "Spam" } });
    assert.equal(suspended.body.sessions_revoked, 1);
    assert.deepEqual(published, [{ channel: auth.SESSIONS_REVOKED_CHANNEL, user_id: quietId }]);
    assert.equal((await list("?filter=suspended")).users[0].id, quietId);
    published.length = 0;
    await call("PATCH", `/users/${quietId}/suspension`, { cookie: boss, body: { suspended: false } });
    assert.deepEqual(published, [], "lifting it signs nobody out");
  });

  await t.test("the account emails: to the address on file, one a minute, and the link stays out of reach", async () => {
    const send = async (kind, id) => call("POST", `/users/${id}/${kind}`, { cookie: boss, body: {} });
    await pool.query(`DELETE FROM market.user_email_verification_tokens WHERE user_id = $1`, [aliceId]);

    const first = await send("verification-email", aliceId);
    assert.deepEqual(first.body, { status: "not_configured" });
    assert.equal((await send("verification-email", aliceId)).status, 429);
    assert.deepEqual((await send("verification-email", aliceId)).body, { error: "too_soon" });
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.user_email_verification_tokens WHERE user_id = $1`, [aliceId])).rows[0].n, 1);
    assert.deepEqual((await send("verification-email", bobId)).body, { error: "already_verified" });
    assert.deepEqual((await send("verification-email", noEmailId)).body, { error: "no_email" });
    assert.equal((await send("verification-email", 999999)).status, 404);

    const reset = await send("password-reset-email", bobId);
    assert.deepEqual(reset.body, { status: "not_configured" });
    assert.deepEqual((await send("password-reset-email", bobId)).body, { error: "too_soon" });
    assert.deepEqual((await send("password-reset-email", noEmailId)).body, { error: "no_email" });

    const bob = await detail(bobId);
    assert.ok(bob.password_reset_sent_at);
    assert.deepEqual([bob.history[0].action, bob.history[0].details], ["user.password_reset_email", { status: "not_configured" }]);
    assert.equal((await logFor(aliceId))[0].action, "user.verification_email");
    assertNoSecrets(bob, allAddresses);

    // What goes out: the player's own address, and the link only in the email.
    const sent = [];
    const fake = async (message) => (sent.push(message), "sent");
    process.env.PUBLIC_APP_BASE_URL = "https://holo.example.test";
    t.after(() => {
      delete process.env.PUBLIC_APP_BASE_URL;
    });
    const actor = { id: bossId, username: "boss", is_admin: true };
    await pool.query(`UPDATE market.user_password_reset_tokens SET created_at = now() - interval '2 minutes' WHERE user_id = $1`, [bobId]);
    assert.deepEqual(await adminUsers.sendPasswordReset(pool, actor, bobId, { send: fake }), { status: "sent" });
    assert.equal(sent[0].to, "bob@example.test");
    assert.match(sent[0].text, /reset-password\?token=/);
    assert.equal(JSON.stringify(await logFor(bobId)).includes("token="), false);
  });

  await t.test("change email: guarded, masked in the log, and back to unverified", async () => {
    const change = (id, email, extra = {}) => call("PATCH", `/users/${id}/email`, { cookie: boss, body: { email, reason: "Typed it wrong at sign-up", confirm: true, ...extra } });
    assert.equal((await call("PATCH", `/users/${dottyId}/email`, { cookie: bobCookie, body: { email: "x@example.test", reason: "r", confirm: true } })).status, 403);
    assert.deepEqual((await change(bossId, "new@example.test")).body, { error: "cannot_change_own_email" });
    assert.deepEqual((await change(deputyId, "new@example.test")).body, { error: "cannot_change_admin_email" });
    assert.deepEqual((await change(dottyId, "x@mailinator.com")).body, { error: "disposable_email" });
    assert.deepEqual((await change(dottyId, "alice@example.test")).body, { error: "email_taken" });
    assert.deepEqual((await change(dottyId, "DOT.TY+stocks@gmail.com")).body, { error: "email_unchanged" });
    assert.equal((await change(999999, "new@example.test")).status, 404);
    assert.deepEqual(await logFor(dottyId), [], "a refused change logs nothing");

    // A second account can't take the same inbox by another spelling.
    assert.deepEqual((await change(bobId, "d.o.t.t.y@gmail.com")).body, { error: "email_taken" });

    // Links already out on the old address.
    process.env.PUBLIC_APP_BASE_URL = "https://holo.example.test";
    const oldReset = await auth.requestPasswordReset(pool, "dotty", { send: async () => "sent" });
    assert.equal(oldReset, "sent");
    const { rows: tokens } = await pool.query(`SELECT count(*)::int AS n FROM market.user_password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`, [dottyId]);
    assert.equal(tokens[0].n, 1);
    const verifiedAt = "2026-01-01T00:00:00Z";
    await pool.query(`UPDATE market.users SET email_verified_at = $2 WHERE id = $1`, [dottyId, verifiedAt]);

    const sent = [];
    const fake = async (message) => (sent.push(message), "sent");
    const actor = { id: bossId, username: "boss", is_admin: true };
    const result = await adminUsers.changeUserEmail(pool, actor, dottyId, { email: " Real.Dotty@Example.test ", reason: "Typed it wrong at sign-up", confirm: true }, { send: fake });
    assert.deepEqual(result, { verification_email: "sent", notice_email: "sent" });

    const { rows } = await pool.query(`SELECT email, email_normalized, email_verified, email_verified_at FROM market.users WHERE id = $1`, [dottyId]);
    assert.deepEqual(rows[0], { email: "real.dotty@example.test", email_normalized: "real.dotty@example.test", email_verified: false, email_verified_at: null });

    // The link goes to the new address, and the old one hears about it with the new one masked.
    assert.deepEqual(sent.map((message) => message.to), ["real.dotty@example.test", "dot.ty+stocks@gmail.com"]);
    assert.match(sent[0].text, /verify-email\?token=/);
    assert.match(sent[1].text, /re\*\*\*\*\*\*@example\.test/);
    assert.ok(!sent[1].text.includes("real.dotty"));
    assert.ok(!sent[1].html.includes("real.dotty"));

    // The old links are spent; only the new verification link is left.
    const { rows: open } = await pool.query(`SELECT email FROM market.user_email_verification_tokens WHERE user_id = $1 AND used_at IS NULL`, [dottyId]);
    assert.deepEqual(open, [{ email: "real.dotty@example.test" }]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.user_password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`, [dottyId])).rows[0].n, 0);

    // The log has both addresses masked, and the admin only ever sees the mask.
    const after = await detail(dottyId);
    const entry = after.history[0];
    assert.deepEqual([entry.action, entry.reason, entry.actor.username], ["user.email_change", "Typed it wrong at sign-up", "boss"]);
    assert.deepEqual(entry.details, { before: "do******@gmail.com", after: "re******@example.test", was_verified: true });
    assert.equal(after.user.email_masked, "re******@example.test");
    assertNoSecrets(after, ["real.dotty", "dot.ty", "dotty@gmail.com"]);

    // An old address that never verified was probably the typo: no notice to a stranger.
    sent.length = 0;
    const unverified = await adminUsers.changeUserEmail(pool, actor, dottyId, { email: "dotty.again@example.test", reason: "Typed it wrong again", confirm: true }, { send: fake });
    assert.deepEqual(unverified, { verification_email: "sent", notice_email: "skipped" });
    assert.deepEqual(sent.map((message) => message.to), ["dotty.again@example.test"]);

    // No address on file before: this adds one.
    sent.length = 0;
    assert.deepEqual(await adminUsers.changeUserEmail(pool, actor, noEmailId, { email: "found.one@example.test", reason: "Asked on Discord", confirm: true }, { send: fake }), { verification_email: "sent", notice_email: "skipped" });
    assert.deepEqual((await logFor(noEmailId))[0].details, { before: null, after: "fo******@example.test", was_verified: false });
    delete process.env.PUBLIC_APP_BASE_URL;
  });

  await t.test("the moderation log lists every one of these with who did it and when", async () => {
    const { actions } = (await call("GET", "/moderation/actions?limit=200", { cookie: boss })).body;
    const kinds = new Set(actions.map((entry) => entry.action));
    for (const action of ["user.roles", "user.rename", "user.clear_bio", "user.sign_out", "user.verification_email", "user.password_reset_email", "user.email_change", "user.suspend", "user.unsuspend"]) {
      assert.ok(kinds.has(action), action);
    }
    for (const entry of actions) {
      assert.equal(entry.actor?.username, "boss");
      assert.ok(entry.created_at);
      assert.equal(entry.target_type, "user");
    }
    assert.ok(!JSON.stringify(actions).includes("real.dotty"));
  });
});
