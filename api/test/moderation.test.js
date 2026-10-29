const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const moderation = require("../src/services/moderation");
const siteState = require("../src/services/siteState");
const { blockSuspendedWrites } = require("../src/userContext");
const adminRoutes = require("../src/routes/admin");
const { router: chatRoutes } = require("../src/routes/chat");
const internalSite = require("../src/routes/internalSite");

// Status codes for the errors these routes throw, as server.js's handler answers them.
const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_chat_report: 400,
  invalid_chat_moderation: 400,
  invalid_chat_message: 400,
  chat_message_not_found: 404,
  chat_report_not_found: 404,
  chat_user_muted: 409,
  chat_user_banned: 409,
};

/** An app with the given routes behind `ctx` (a function of the request) and the suspension gate. */
async function serve(t, ctx, mount) {
  const app = express();
  app.use(async (req, _res, next) => {
    try {
      req.ctx = await ctx(req);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(blockSuspendedWrites);
  app.use(express.json());
  mount(app);
  app.use((error, _req, res, _next) => {
    const status = ERROR_STATUS[error?.code];
    if (status) return res.status(status).json({ error: error.code, expires_at: error.expires_at ?? null });
    res.status(500).json({ error: String(error?.message || error) });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { body, cookie } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test("suspensionOf: none, timed, permanent and run out", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(moderation.suspensionOf(null, now), null);
  assert.equal(moderation.suspensionOf({ suspended_at: null, suspended_until: null }, now), null);
  assert.deepEqual(moderation.suspensionOf({ suspended_at: "2026-10-29T10:00:00Z", suspended_until: "2026-10-30T10:00:00Z", suspension_reason: "spam" }, now), {
    reason: "spam",
    since: "2026-10-29T10:00:00.000Z",
    until: "2026-10-30T10:00:00.000Z",
    permanent: false,
  });
  assert.deepEqual(moderation.suspensionOf({ suspended_at: "2026-10-29T10:00:00Z", suspended_until: null, suspension_reason: "bots" }, now), {
    reason: "bots",
    since: "2026-10-29T10:00:00.000Z",
    until: null,
    permanent: true,
  });
  assert.equal(moderation.suspensionOf({ suspended_at: "2026-10-20T10:00:00Z", suspended_until: "2026-10-29T11:59:59Z" }, now), null);
});

test("a suspended player reads but can't write; sign-in, sign-out and read receipts still go through", async (t) => {
  const suspension = { reason: "Spamming the board", since: "2026-10-29T10:00:00.000Z", until: "2026-10-30T10:00:00.000Z", permanent: false };
  let user = { id: 7, username: "rrat", suspension };
  const call = await serve(t, () => ({ user }), (app) => {
    app.all(/.*/, (req, res) => res.json({ ok: true, method: req.method }));
  });

  assert.equal((await call("GET", "/api/market/assets")).status, 200);
  for (const [method, path] of [["POST", "/api/market/orders"], ["PUT", "/api/profiles/me"], ["DELETE", "/api/profiles/x/friendship"], ["PATCH", "/api/anything"], ["POST", "/api/chat/channels/market:global/messages"]]) {
    const res = await call(method, path, { body: { x: 1 } });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.deepEqual(res.body, { error: "account_suspended", reason: "Spamming the board", until: "2026-10-30T10:00:00.000Z", permanent: false });
  }
  for (const path of ["/api/auth/logout", "/api/auth/login", "/api/notifications/read", "/api/chat/channels/market:global/read"]) {
    assert.equal((await call("POST", path, { body: {} })).status, 200, path);
  }
  user = { id: 7, username: "rrat", suspension: { ...suspension, until: null, permanent: true } };
  assert.equal((await call("POST", "/api/market/orders", { body: {} })).body.permanent, true);
  user = { id: 7, username: "rrat", suspension: null };
  assert.equal((await call("POST", "/api/market/orders", { body: {} })).status, 200);
});

test("moderation routes: signed out 401, players 403, before any query", async (t) => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [], rowCount: 0 }; }, async connect() { throw new Error("no connection expected"); } };
  let user = null;
  const call = await serve(t, () => ({ pool, redis: null, user }), (app) => {
    app.use("/api/admin", adminRoutes);
    app.use("/api/chat", chatRoutes);
    app.use("/internal/site", internalSite);
  });
  const requests = [
    ["PATCH", "/api/admin/users/2/suspension", { suspended: true, duration: "24h", reason: "x" }],
    ["POST", "/api/admin/users/2/reset-profile", {}],
    ["POST", "/api/admin/comments/stock/1/hide", { hidden: true }],
    ["GET", "/api/admin/moderation/actions"],
  ];
  for (const [method, path, body] of requests) assert.equal((await call(method, path, { body })).status, 401, path);
  user = { id: 2, username: "pleb", is_admin: false };
  for (const [method, path, body] of [
    ...requests,
    ["GET", "/api/chat/reports"],
    ["GET", "/api/chat/moderation/active"],
    ["POST", "/api/chat/users/3/unmute", {}],
    ["POST", "/api/chat/users/3/unban", {}],
    ["POST", "/internal/site/announcement", { text: "hi" }],
    ["DELETE", "/internal/site/announcement"],
  ]) {
    assert.equal((await call(method, path, { body })).status, 403, path);
  }
  assert.equal(queries.length, 0);

  // Checked before anything is written.
  user = { id: 1, username: "boss", is_admin: true };
  assert.deepEqual((await call("PATCH", "/api/admin/users/abc/suspension", { body: { suspended: true } })).body, { error: "invalid_user_id" });
  assert.deepEqual((await call("PATCH", "/api/admin/users/2/suspension", { body: { suspended: true, duration: "1y", reason: "x" } })).body, { error: "invalid_suspension", field: "duration" });
  assert.deepEqual((await call("PATCH", "/api/admin/users/2/suspension", { body: { suspended: true, duration: "7d", reason: "  " } })).body, { error: "invalid_suspension", field: "reason" });
  assert.deepEqual((await call("POST", "/api/admin/comments/wall/1/hide", { body: { hidden: true } })).body, { error: "invalid_comment_kind" });
  assert.deepEqual((await call("POST", "/internal/site/announcement", { body: { text: "x", tone: "loud" } })).body, { error: "invalid_announcement", field: "tone" });
  assert.equal(queries.length, 0);
});

test("announcement validation and expiry", () => {
  assert.deepEqual(siteState.planAnnouncement({ text: "  Trading   opens at 9 ", tone: "warning", link: "/changelog", expires_in_hours: 6 }), {
    text: "Trading opens at 9",
    tone: "warning",
    link: "/changelog",
    expiresInHours: 6,
  });
  assert.equal(siteState.planAnnouncement({ text: "x" }).tone, "info");
  assert.equal(siteState.planAnnouncement({ text: "x", link: "https://holo.nasfaq.biz/x" }).link, "https://holo.nasfaq.biz/x");
  for (const [body, field] of [
    [{ text: "" }, "text"],
    [{ text: "x".repeat(281) }, "text"],
    [{ text: "x", link: "javascript:alert(1)" }, "link"],
    [{ text: "x", link: "//elsewhere.example" }, "link"],
    [{ text: "x", link: "http://plain.example" }, "link"],
    [{ text: "x", expires_in_hours: 0 }, "expires_in_hours"],
    [{ text: "x", expires_in_hours: 24 * 31 }, "expires_in_hours"],
  ]) {
    assert.throws(() => siteState.planAnnouncement(body), { code: "invalid_announcement", field });
  }
  const now = Date.parse("2026-10-29T12:00:00Z");
  const row = { announcement_text: "Hi", announcement_tone: "info", announcement_posted_at: "2026-10-29T11:00:00Z", announcement_expires_at: "2026-10-29T13:00:00Z" };
  assert.equal(siteState.toAnnouncement(row, now).id, "2026-10-29T11:00:00.000Z");
  assert.equal(siteState.toAnnouncement(row, Date.parse("2026-10-29T13:00:00Z")), null);
  assert.equal(siteState.toAnnouncement({ ...row, announcement_expires_at: null }, now + 365 * 86_400_000).text, "Hi");
});

// End to end on a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("moderation end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_moderation_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_moderation_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_moderation_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const authRoutes = require("../src/routes/auth");
  const chatDb = require("../src/chatDb");
  const marketDb = require("../src/marketDb");
  const articleDb = require("../src/articleDb");
  const predictionMarketDb = require("../src/predictionMarketDb");
  const netWorth = require("../src/services/netWorth");
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }
  // The admin routes log role and suspension changes to the console too.
  console.info = () => {};
  t.after(() => {
    console.info = quiet[2];
  });

  const addUser = async (username, { isAdmin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', $2) RETURNING id`,
      [username, isAdmin]
    );
    return Number(rows[0].id);
  };
  const bossId = await addUser("boss", { isAdmin: true });
  const otherAdminId = await addUser("deputy", { isAdmin: true });
  const alice = await auth.createUser(pool, { username: "alice", email: "alice@example.test", password: "correct horse battery" });
  const aliceId = Number(alice.id);
  const bobId = await addUser("bob");
  const carolId = await addUser("carol");
  await pool.query(`UPDATE market.users SET email_verified = true WHERE id = $1`, [aliceId]);
  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const boss = await cookieFor(bossId);
  const bob = await cookieFor(bobId);

  // Enough Redis for the rate limits, and a record of what chat publishes.
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
  const call = await serve(
    t,
    async (req) => ({ pool, redis, user: await auth.getAuthenticatedUser(pool, req) }),
    (app) => {
      app.use("/api/auth", authRoutes);
      app.use("/api/admin", adminRoutes);
      app.use("/api/chat", chatRoutes);
      app.use("/internal/site", internalSite);
      app.post("/api/test/write", (_req, res) => res.json({ ok: true }));
      app.get("/api/test/read", (_req, res) => res.json({ ok: true }));
    }
  );
  const actions = async () => (await call("GET", "/api/admin/moderation/actions?limit=100", { cookie: boss })).body.actions;

  await t.test("suspension: read-only, signed out everywhere, off the leaderboards, reversible", async () => {
    const oldCookie = await cookieFor(aliceId);
    await cookieFor(aliceId);
    await netWorth.refreshCurrentLeaderboard(pool);
    const ranked = async () => (await netWorth.listLeaderboardBundle(pool, { limit: 100 })).entries.map((entry) => entry.user_id);
    assert.ok((await ranked()).includes(aliceId));

    assert.equal((await call("PATCH", `/api/admin/users/${aliceId}/suspension`, { cookie: bob, body: { suspended: true, duration: "24h", reason: "x" } })).status, 403);
    assert.deepEqual((await call("PATCH", `/api/admin/users/${bossId}/suspension`, { cookie: boss, body: { suspended: true, duration: "24h", reason: "x" } })).body, { error: "cannot_suspend_self" });
    assert.deepEqual((await call("PATCH", `/api/admin/users/${otherAdminId}/suspension`, { cookie: boss, body: { suspended: true, duration: "24h", reason: "x" } })).body, { error: "cannot_suspend_admin" });
    assert.deepEqual((await call("PATCH", `/api/admin/users/999999/suspension`, { cookie: boss, body: { suspended: true, duration: "24h", reason: "x" } })).body, { error: "user_not_found" });

    const suspended = await call("PATCH", `/api/admin/users/${aliceId}/suspension`, { cookie: boss, body: { suspended: true, duration: "24h", reason: "Spamming the board" } });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.sessions_revoked, 2);
    assert.equal(suspended.body.user.suspension.reason, "Spamming the board");
    assert.equal(suspended.body.user.suspension.by, "boss");
    const hours = (Date.parse(suspended.body.user.suspension.until) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `ends in ${hours}h`);

    // Their sessions are gone; signing in again works and says why.
    assert.equal((await call("GET", "/api/auth/me", { cookie: oldCookie })).status, 401);
    const login = await auth.loginWithPassword(pool, { username: "alice", password: "correct horse battery" });
    assert.equal(login.user.suspension.reason, "Spamming the board");
    const aliceNow = `nasfaq_session=${login.session.token}`;
    const me = await call("GET", "/api/auth/me", { cookie: aliceNow });
    assert.equal(me.body.user.suspension.reason, "Spamming the board");
    assert.equal(me.body.user.suspension.permanent, false);

    assert.equal((await call("GET", "/api/test/read", { cookie: aliceNow })).status, 200);
    const write = await call("POST", "/api/test/write", { cookie: aliceNow, body: {} });
    assert.equal(write.status, 403);
    assert.equal(write.body.error, "account_suspended");
    assert.equal(write.body.reason, "Spamming the board");
    assert.equal(write.body.until, suspended.body.user.suspension.until);
    assert.equal((await call("POST", "/api/auth/logout", { cookie: aliceNow, body: {} })).status, 200);

    // Off the leaderboard and the chat badges while it lasts.
    assert.ok(!(await ranked()).includes(aliceId));
    assert.deepEqual((await netWorth.listCurrentNetWorthByUserIds(pool, [aliceId, bobId])).map((entry) => entry.user_id), [bobId]);

    // A suspension that has run out isn't enforced.
    await pool.query(`UPDATE market.users SET suspended_until = now() - interval '1 second' WHERE id = $1`, [aliceId]);
    const fresh = await cookieFor(aliceId);
    assert.equal((await call("POST", "/api/test/write", { cookie: fresh, body: {} })).status, 200);
    assert.ok((await ranked()).includes(aliceId));

    // Permanent, then lifted.
    const forever = await call("PATCH", `/api/admin/users/${carolId}/suspension`, { cookie: boss, body: { suspended: true, duration: "permanent", reason: "Bot farm" } });
    assert.deepEqual([forever.body.user.suspension.until, forever.body.user.suspension.permanent], [null, true]);
    const carol = await cookieFor(carolId);
    assert.equal((await call("POST", "/api/test/write", { cookie: carol, body: {} })).body.permanent, true);
    const lifted = await call("PATCH", `/api/admin/users/${carolId}/suspension`, { cookie: boss, body: { suspended: false, reason: "Appeal accepted" } });
    assert.equal(lifted.body.user.suspension, null);
    assert.equal((await call("POST", "/api/test/write", { cookie: carol, body: {} })).status, 200);

    const log = await actions();
    assert.deepEqual(
      log.filter((entry) => entry.action.startsWith("user.")).map((entry) => [entry.action, entry.target_label, entry.reason]),
      [
        ["user.unsuspend", "carol", "Appeal accepted"],
        ["user.suspend", "carol", "Bot farm"],
        ["user.suspend", "alice", "Spamming the board"],
      ]
    );
    assert.equal(log.find((entry) => entry.target_label === "alice").details.sessions_revoked, 2);
    assert.equal(log[0].actor.username, "boss");
  });

  const { rows: assetRows } = await pool.query(`
    WITH channel AS (INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCmod', 'Mod') RETURNING youtube_channel_id)
    INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
    SELECT youtube_channel_id, 'MOD', 'Mod', 'active', 100000, 0, 100000, 1000000000, 100, 100, 100, 100 FROM channel
    RETURNING id
  `);
  const assetId = Number(assetRows[0].id);

  await t.test("profile reset renames to player_<id> and clears the bio and banner", async () => {
    await pool.query(`UPDATE market.users SET username = 'slur lord', username_normalized = 'slur lord', bio = 'something awful', profile_banner_asset_id = $2 WHERE id = $1`, [bobId, assetId]);
    await netWorth.refreshCurrentLeaderboard(pool, { userIds: [bobId] });
    const reset = await call("POST", `/api/admin/users/${bobId}/reset-profile`, { cookie: boss, body: { reason: "Offensive name" } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.user.username, `player_${bobId}`);
    assert.equal(reset.body.user.has_bio, false);
    assert.deepEqual(reset.body.before, { username: "slur lord", bio: "something awful", banner_asset_id: assetId });
    const { rows } = await pool.query(`SELECT username, username_normalized, bio, profile_banner_asset_id FROM market.users WHERE id = $1`, [bobId]);
    assert.deepEqual(rows[0], { username: `player_${bobId}`, username_normalized: `player_${bobId}`, bio: null, profile_banner_asset_id: null });
    const { rows: board } = await pool.query(`SELECT username_snapshot FROM market.user_leaderboard_current WHERE user_id = $1`, [bobId]);
    assert.equal(board[0].username_snapshot, `player_${bobId}`);

    // Someone already took player_<id>: the next free one.
    await pool.query(`UPDATE market.users SET username = $2, username_normalized = $2 WHERE id = $1`, [aliceId, `player_${carolId}`]);
    assert.equal((await call("POST", `/api/admin/users/${carolId}/reset-profile`, { cookie: boss, body: {} })).body.user.username, `player_${carolId}_2`);
    await pool.query(`UPDATE market.users SET username = 'alice', username_normalized = 'alice' WHERE id = $1`, [aliceId]);
    await pool.query(`UPDATE market.users SET username = 'carol', username_normalized = 'carol' WHERE id = $1`, [carolId]);
    assert.equal((await call("POST", `/api/admin/users/999999/reset-profile`, { cookie: boss, body: {} })).status, 404);

    const entry = (await actions()).find((item) => item.action === "user.reset_profile" && item.target_id === String(bobId));
    assert.equal(entry.reason, "Offensive name");
    assert.equal(entry.target_label, "slur lord");
    assert.equal(entry.details.after.username, `player_${bobId}`);
  });

  await t.test("hidden comments disappear for everyone but admins, on all three boards", async () => {
    const hide = (kind, id, hidden, reason) => call("POST", `/api/admin/comments/${kind}/${id}/hide`, { cookie: boss, body: { hidden, reason } });

    // Stock board
    const { rows: stock } = await pool.query(
      `INSERT INTO content.asset_comments (asset_id, author_id, body) VALUES ($1, $2, 'fine post'), ($1, $2, 'awful post') RETURNING id`,
      [assetId, carolId]
    );
    const awful = Number(stock[1].id);
    const hidden = await hide("stock", awful, true, "Slur");
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.comment.hidden_reason, "Slur");
    let board = await marketDb.listAssetComments(pool, "MOD", { viewerUserId: aliceId });
    assert.deepEqual([board.total, board.comments.map((comment) => comment.body)], [1, ["fine post"]]);
    board = await marketDb.listAssetComments(pool, "MOD", { viewerUserId: bossId, includeHidden: true });
    assert.equal(board.total, 2);
    assert.equal(board.comments.find((comment) => Number(comment.id) === awful).hidden_reason, "Slur");
    await assert.rejects(marketDb.setAssetCommentVote(pool, "MOD", awful, aliceId, 1), { code: "asset_comment_not_found" });
    assert.equal((await hide("stock", awful, false)).body.comment.hidden_at, null);
    assert.equal((await marketDb.listAssetComments(pool, "MOD", { viewerUserId: aliceId })).total, 2);

    // Articles
    const { rows: articles } = await pool.query(`INSERT INTO content.articles (slug, title, author_id) VALUES ('mod-test', 'Mod test', $1) RETURNING id`, [bossId]);
    const { rows: articleComments } = await pool.query(
      `INSERT INTO content.article_comments (article_id, author_id, body) VALUES ($1, $2, 'kept'), ($1, $2, 'gone') RETURNING id`,
      [articles[0].id, carolId]
    );
    await hide("article", Number(articleComments[1].id), true, "Spam");
    const asPlayer = await articleDb.getArticleBySlug(pool, "mod-test", aliceId);
    assert.deepEqual([asPlayer.comment_count, asPlayer.comments.map((comment) => comment.body)], [1, ["kept"]]);
    assert.deepEqual((await articleDb.getArticleBySlug(pool, "mod-test", null)).comments.map((comment) => comment.body), ["kept"]);
    const asAdmin = await articleDb.getArticleBySlug(pool, "mod-test", bossId);
    assert.equal(asAdmin.comments.length, 2);
    assert.ok(asAdmin.comments.find((comment) => comment.body === "gone").hidden_at);

    // Predictions
    const { rows: markets } = await pool.query(
      `INSERT INTO market.prediction_markets (slug, title, rules_text, resolution_source_text, creator_user_id, opens_at, closes_at)
       VALUES ('mod-market', 'Mod market', 'rules', 'source', $1, now(), now() + interval '1 day') RETURNING id`,
      [bossId]
    );
    const { rows: predictionComments } = await pool.query(
      `INSERT INTO content.prediction_market_comments (market_id, author_id, body) VALUES ($1, $2, 'talk'), ($1, $2, 'trash') RETURNING id`,
      [markets[0].id, carolId]
    );
    await hide("prediction", Number(predictionComments[1].id), true, null);
    const thread = await predictionMarketDb.listPredictionMarketComments(pool, "mod-market", { viewerUserId: aliceId });
    assert.deepEqual([thread.total, thread.comments.map((comment) => comment.body)], [1, ["talk"]]);
    const adminThread = await predictionMarketDb.listPredictionMarketComments(pool, "mod-market", { viewerUserId: bossId, includeHidden: true });
    assert.equal(adminThread.total, 2);
    assert.ok(adminThread.comments.find((comment) => comment.body === "trash").hidden_at);

    assert.deepEqual((await hide("stock", 999999, true)).body, { error: "comment_not_found" });
    const log = (await actions()).filter((entry) => entry.action.startsWith("comment."));
    assert.deepEqual(
      log.map((entry) => [entry.action, entry.target_type]),
      [
        ["comment.hide", "prediction_comment"],
        ["comment.hide", "article_comment"],
        ["comment.unhide", "stock_comment"],
        ["comment.hide", "stock_comment"],
      ]
    );
    assert.equal(log[3].details.excerpt, "awful post");
  });

  await t.test("chat: reports, the queue, removing, mutes and bans and lifting them", async () => {
    await chatDb.ensureChatTopology(pool);
    const aliceCookie = await cookieFor(aliceId);
    const carolCookie = await cookieFor(carolId);
    const global = await chatDb.getChannelByKey(pool, "market:global", { includeInactive: true });
    const { message } = await chatDb.createMessage(pool, { channelId: global.id, viewer: { id: carolId, is_admin: false }, body: "buy my course" });

    assert.equal((await call("POST", `/api/chat/messages/${message.id}/report`, { cookie: carolCookie, body: { reason: "Spam" } })).status, 400, "not your own");
    assert.equal((await call("POST", `/api/chat/messages/${message.id}/report`, { cookie: aliceCookie, body: { reason: "Spam", details: "Third time today" } })).status, 201);
    assert.equal((await call("POST", `/api/chat/messages/${message.id}/report`, { cookie: bob, body: { reason: "Spam" } })).status, 201);
    assert.equal((await call("POST", `/api/chat/messages/${message.id}/report`, { cookie: aliceCookie, body: {} })).status, 400);
    assert.equal((await call("GET", "/api/chat/reports", { cookie: bob })).status, 403);

    let queue = (await call("GET", "/api/chat/reports", { cookie: boss })).body;
    assert.equal(queue.open_count, 2);
    const first = queue.reports.find((report) => report.reporter.username === "alice");
    assert.deepEqual([first.reason, first.details, first.open_reports], ["Spam", "Third time today", 2]);
    assert.deepEqual([first.message.body, first.message.author.username, first.message.channel_key], ["buy my course", "carol", "market:global"]);

    // Dismiss one, then remove the message: that settles the other.
    const other = queue.reports.find((report) => report.reporter.username !== "alice");
    assert.equal((await call("POST", `/api/chat/reports/${other.id}/status`, { cookie: boss, body: { status: "dismissed" } })).status, 200);
    const removed = await call("POST", `/api/chat/messages/${message.id}/moderate`, { cookie: boss, body: { status: "moderated", reason: "Spam" } });
    assert.deepEqual([removed.body.message.status, removed.body.reports_resolved], ["moderated", 1]);
    // The room hears that it's gone, not what it said.
    const update = published.find((event) => event.type === "chat.message.updated" && event.message.id === message.id);
    assert.deepEqual([update.channel_key, update.message.status, update.message.body], ["market:global", "moderated", ""]);
    queue = (await call("GET", "/api/chat/reports", { cookie: boss })).body;
    assert.deepEqual([queue.open_count, queue.reports.length], [0, 0]);
    assert.equal((await call("GET", "/api/chat/reports?status=resolved", { cookie: boss })).body.reports[0].reviewed_by, "boss");
    assert.equal((await call("GET", "/api/chat/reports?status=dismissed", { cookie: boss })).body.reports.length, 1);

    // Mute for an hour: the room says so, posting is refused, the moderation page lists it; then lifted.
    const muted = await call("POST", `/api/chat/users/${carolId}/moderation`, { cookie: boss, body: { action_type: "mute", duration_minutes: 60, reason: "Cool off" } });
    assert.equal(muted.status, 201);
    let room = await chatDb.getChannelByKey(pool, "market:global", { viewerUserId: carolId });
    assert.equal(room.chat_restriction.type, "mute");
    assert.ok(room.muted_until);
    await assert.rejects(chatDb.createMessage(pool, { channelId: global.id, viewer: { id: carolId }, body: "hello?" }), { code: "chat_user_muted" });
    let active = (await call("GET", "/api/chat/moderation/active", { cookie: boss })).body.actions;
    assert.deepEqual(active.map((entry) => [entry.action_type, entry.user.username, entry.reason, entry.created_by]), [["mute", "carol", "Cool off", "boss"]]);
    assert.deepEqual((await call("POST", `/api/chat/users/${carolId}/unmute`, { cookie: boss, body: {} })).body, { lifted: 1 });
    assert.equal((await chatDb.getChannelByKey(pool, "market:global", { viewerUserId: carolId })).chat_restriction, null);
    assert.deepEqual((await call("POST", `/api/chat/users/${carolId}/unmute`, { cookie: boss, body: {} })).body, { lifted: 0 });

    // A ban with no end shows as a ban (not a mute) in the room.
    await call("POST", `/api/chat/users/${carolId}/moderation`, { cookie: boss, body: { action_type: "ban", reason: "Doxxing" } });
    room = await chatDb.getChannelByKey(pool, "market:global", { viewerUserId: carolId });
    assert.deepEqual([room.chat_restriction, room.muted_until], [{ type: "ban", until: null }, null]);
    await assert.rejects(chatDb.createMessage(pool, { channelId: global.id, viewer: { id: carolId }, body: "hello?" }), { code: "chat_user_banned" });
    assert.deepEqual((await call("POST", `/api/chat/users/${carolId}/unban`, { cookie: boss, body: { reason: "Served" } })).body, { lifted: 1 });
    active = (await call("GET", "/api/chat/moderation/active", { cookie: boss })).body.actions;
    assert.equal(active.length, 0);
    // Each one told carol's sockets (server.js sends chat.user.moderated only to her).
    assert.deepEqual(
      published.filter((event) => event.type === "chat.user.moderated").map((event) => [event.user_id, event.action?.action_type ?? null]),
      [
        [carolId, "mute"],
        [carolId, null],
        [carolId, "ban"],
        [carolId, null],
      ]
    );

    const log = (await actions()).filter((entry) => entry.action.startsWith("chat."));
    assert.deepEqual(
      log.map((entry) => [entry.action, entry.target_label]),
      [
        ["chat.unban", "carol"],
        ["chat.ban", "carol"],
        ["chat.unmute", "carol"],
        ["chat.mute", "carol"],
        ["chat.message.remove", "carol"],
        ["chat.report.dismiss", "carol"],
      ]
    );
    assert.equal(log.find((entry) => entry.action === "chat.message.remove").details.excerpt, "buy my course");
  });

  await t.test("announcement: posted, shown, runs out, cleared", async () => {
    const posted = await call("POST", "/internal/site/announcement", { cookie: boss, body: { text: "Trading opens to everyone Friday", tone: "warning", link: "/changelog", expires_in_hours: 48 } });
    assert.equal(posted.status, 200);
    const announcement = posted.body.site.announcement;
    assert.deepEqual([announcement.text, announcement.tone, announcement.link], ["Trading opens to everyone Friday", "warning", "/changelog"]);
    const hours = (Date.parse(announcement.expires_at) - Date.now()) / 3_600_000;
    assert.ok(hours > 47.9 && hours <= 48);
    assert.equal((await siteState.getSiteState(pool)).announcement.id, announcement.id);
    // The maintenance switch leaves it alone.
    await siteState.setMaintenance(pool, { state: "on", source: "admin", message: "brb" });
    assert.equal((await siteState.getSiteState(pool)).announcement.text, "Trading opens to everyone Friday");
    await siteState.setMaintenance(pool, { state: "off", source: "admin" });

    // A new post is a new announcement (players who waved off the last one see it).
    const again = await call("POST", "/internal/site/announcement", { cookie: boss, body: { text: "Second" } });
    assert.notEqual(again.body.site.announcement.id, announcement.id);
    assert.deepEqual([again.body.site.announcement.tone, again.body.site.announcement.expires_at], ["info", null]);

    await pool.query(`UPDATE market.site_state SET announcement_expires_at = now() - interval '1 second'`);
    assert.equal((await siteState.getSiteState(pool)).announcement, null);

    await call("POST", "/internal/site/announcement", { cookie: boss, body: { text: "Third" } });
    const cleared = await call("DELETE", "/internal/site/announcement", { cookie: boss });
    assert.equal(cleared.body.site.announcement, null);
    const { rows } = await pool.query(`SELECT announcement_text, announcement_posted_at FROM market.site_state`);
    assert.deepEqual(rows[0], { announcement_text: null, announcement_posted_at: null });

    const log = (await actions()).filter((entry) => entry.action.startsWith("site."));
    assert.deepEqual(
      log.map((entry) => [entry.action, entry.details.text]),
      [
        ["site.announcement.clear", "Third"],
        ["site.announcement.post", "Third"],
        ["site.announcement.post", "Second"],
        ["site.announcement.post", "Trading opens to everyone Friday"],
      ]
    );
  });

  await t.test("role changes and exchange freezes are logged too", async () => {
    const { updateUserRoles, setExchangeFreeze } = require("../src/services/adminConsole");
    const actor = { id: bossId, username: "boss", is_admin: true };
    await updateUserRoles(pool, actor, aliceId, { can_manage_assets: true });
    await setExchangeFreeze(pool, actor, aliceId, { frozen: true, note: "Card dupes" });
    const log = await actions();
    assert.deepEqual(log.slice(0, 2).map((entry) => [entry.action, entry.target_label, entry.reason]), [
      ["user.exchange_freeze", "alice", "Card dupes"],
      ["user.roles", "alice", null],
    ]);
    assert.deepEqual(log[1].details, { can_manage_assets: true });
  });
});
