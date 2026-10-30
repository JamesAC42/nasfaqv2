const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");

// Sign-up abuse rules end to end, on a freshly migrated database of its own from the local or CI
// test server: one inbox one account, throwaway domains, name rules, IP hashes and the admin views
// of them, staked PvP account rules, renames, verified-only leaderboards and the word filter.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

// Status codes for the errors these routes leave to server.js's handler, as it answers them.
function answerError(error, res) {
  const code = error?.code;
  if (code === "unauthenticated") return res.status(401).json({ error: code });
  if (code === "email_verification_required") return res.status(403).json({ error: code });
  if (code === "blocked_words") return res.status(400).json({ error: code, field: error.field ?? null });
  if (["username_not_allowed", "username_reserved", "username_talent", "invalid_username", "invalid_profile_update"].includes(code)) return res.status(400).json({ error: code });
  if (code === "rename_needs_verified_email") return res.status(403).json({ error: code });
  if (code === "rename_cooldown") return res.status(429).json({ error: code, available_at: error.available_at ?? null });
  return res.status(500).json({ error: String(error?.message || error) });
}

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
  app.use(express.json());
  mount(app);
  app.use((error, _req, res, _next) => answerError(error, res));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { body, cookie, ip } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
}

test("sign-up abuse rules end to end", { skip: !databaseUrl, timeout: 240_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_signup_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_signup_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_signup_test";
  const pool = new Pool({ connectionString: target.href });
  const savedSalt = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = "signup-test-salt";
  t.after(async () => {
    if (savedSalt === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = savedSalt;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });

  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const authRoutes = require("../src/routes/auth");
  const adminRoutes = require("../src/routes/admin");
  const profileRoutes = require("../src/routes/profiles");
  const gameTableRoutes = require("../src/routes/gameTables");
  const { router: chatRoutes } = require("../src/routes/chat");
  const chatDb = require("../src/chatDb");
  const articleDb = require("../src/articleDb");
  const marketDb = require("../src/marketDb");
  const predictionMarketDb = require("../src/predictionMarketDb");
  const netWorth = require("../src/services/netWorth");
  const nameRules = require("../src/services/nameRules");
  const emailRules = require("../src/services/emailRules");
  const { hashIp } = require("../src/services/ipHash");
  const pvp = require("../src/services/games/tables/pvp");

  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }
  // Sign-up logs its (unsent) verification link; admin routes log what they change.
  console.warn = console.info = () => {};
  t.after(() => {
    [console.warn, console.log, console.info] = quiet;
  });

  // A talent, so her name is reserved.
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol) VALUES ('UCgura', 'Gura', 'Gawr Gura', 'GUR')`);
  await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCgura', 'GUR', 'Gawr Gura', 'active', 100000, 0, 100000, 1000000000, 100, 10, 10, 10)`
  );
  nameRules.clearTalentNameCache();

  const addUser = async (username, { email = `${username.toLowerCase()}@example.test`, verified = true, isAdmin = false, ageDays = 30 } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_normalized, email_verified, password_hash, password_salt, password_params_json, is_admin, created_at)
       VALUES ($1, lower($1), $2, $3, $4, 'x', 'x', '{}', $5, now() - make_interval(days => $6)) RETURNING id`,
      [username, email, emailRules.canonicalEmail(email), verified, isAdmin, ageDays]
    );
    return Number(rows[0].id);
  };
  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const bossId = await addUser("boss", { isAdmin: true });
  const boss = await cookieFor(bossId);

  const call = await serve(
    t,
    async (req) => ({ pool, redis: null, user: await auth.getAuthenticatedUser(pool, req) }),
    (app) => {
      app.use("/api/auth", authRoutes);
      app.use("/api/admin", adminRoutes);
      app.use("/api/profiles", profileRoutes);
      app.use("/api/games", gameTableRoutes);
      app.use("/api/chat", chatRoutes);
    }
  );
  // Sign-up allows 10 an hour per address, so each one comes from its own unless the test says.
  let nextIp = 0;
  const register = (username, email, ip = `198.51.100.${(nextIp += 1)}`) => call("POST", "/api/auth/register", { body: { username, email, password: "correct horse battery", ogey: "rrat" }, ip });

  await t.test("migration: accounts already sharing an inbox are reported, not failed; the oldest keeps it", async () => {
    // As production was before: no unique index, no normalised addresses, two dot/plus variants.
    await pool.query(`DROP INDEX market.market_users_email_normalized_uidx`);
    const old = await addUser("peko_main", { email: "Pe.Ko@gmail.com", ageDays: 40 });
    const alt1 = await addUser("peko_alt", { email: "peko+alt@gmail.com", ageDays: 20 });
    const alt2 = await addUser("peko_alt2", { email: "PEKO@googlemail.com", ageDays: 10 });
    await pool.query(`UPDATE market.users SET email_normalized = NULL`);

    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await applySchema(pool);
      await applySchema(pool); // every start runs it again: still fine, still reported
    } finally {
      console.warn = () => {};
    }
    const reports = warnings.filter((line) => line.includes("share an inbox"));
    assert.equal(reports.length, 2);
    assert.match(reports[0], new RegExp(`#${alt1} peko_alt \\(same inbox as #${old} peko_main\\)`));
    assert.match(reports[0], new RegExp(`#${alt2} peko_alt2 \\(same inbox as #${old} peko_main\\)`));
    assert.doesNotMatch(reports[0], /@/, "no addresses in the log");

    const { rows } = await pool.query(`SELECT id, email_normalized FROM market.users WHERE id = ANY($1::bigint[]) ORDER BY id`, [[old, alt1, alt2]]);
    assert.deepEqual(rows.map((row) => row.email_normalized), ["peko@gmail.com", null, null]);
    const { rows: index } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'market_users_email_normalized_uidx'`);
    assert.match(index[0].indexdef, /UNIQUE INDEX/);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.users WHERE email_normalized IS NULL AND email IS NOT NULL`)).rows[0].n, 2);
  });

  await t.test("sign-up: one inbox one account, no throwaway inboxes, name rules", async () => {
    for (const email of ["p.e.k.o@gmail.com", "peko+again@googlemail.com", "Peko@Gmail.com"]) {
      assert.deepEqual((await register("NewPeko", email)).body, { error: "email_taken" }, email);
    }
    await register("Shark1", "shark+one@example.com");
    assert.deepEqual((await register("Shark2", "shark+two@example.com")).body, { error: "email_taken" });
    for (const email of ["x@mailinator.com", "x@sub.yopmail.com", "X@GuerrillaMail.com"]) {
      const res = await register("Tosser", email);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: "disposable_email" }, email);
    }
    const cases = [
      ["admin", "username_reserved"],
      ["NASFAQ_Official", "username_reserved"],
      ["m0d_team", "username_reserved"],
      ["Gura", "username_talent"],
      ["Gawr_Gura", "username_talent"],
      ["GUR", "username_talent"],
      [`x_${nameRules.SLURS[0][0].replace(/i/g, "1")}`, "username_not_allowed"],
      ["c_o_o_n", "username_not_allowed"],
    ];
    for (const [username, error] of cases) {
      const res = await register(username, `${username.replace(/\W/g, "")}@example.test`);
      assert.equal(res.status, 400, username);
      assert.deepEqual(res.body, { error }, username);
    }
    assert.equal((await register("GuraFan", "gurafan@example.test")).status, 201);
  });

  await t.test("IP hashes: stored at sign-up and per session, shown to admins as linked accounts, never as addresses", async () => {
    const first = await register("Alt_One", "alt.one@example.test", "203.0.113.7");
    assert.equal(first.status, 201);
    const second = await register("Alt_Two", "alt.two@example.test", "203.0.113.7");
    assert.equal(second.status, 201);
    const loner = await register("Loner", "loner@example.test", "192.0.2.55");
    assert.equal(loner.status, 201);
    const [oneId, twoId, lonerId] = [first, second, loner].map((res) => Number(res.body.user.id));

    const { rows } = await pool.query(`SELECT id, signup_ip_hash FROM market.users WHERE id = ANY($1::bigint[]) ORDER BY id`, [[oneId, twoId, lonerId]]);
    assert.equal(rows[0].signup_ip_hash, hashIp("203.0.113.7"));
    assert.equal(rows[1].signup_ip_hash, rows[0].signup_ip_hash);
    assert.notEqual(rows[2].signup_ip_hash, rows[0].signup_ip_hash);
    const { rows: sessions } = await pool.query(`SELECT last_ip_hash FROM market.user_sessions WHERE user_id = $1`, [oneId]);
    assert.deepEqual(sessions.map((row) => row.last_ip_hash), [hashIp("203.0.113.7")]);
    // The address itself is nowhere in the database.
    const { rows: dump } = await pool.query(`SELECT row_to_json(u)::text AS j FROM market.users u UNION ALL SELECT row_to_json(s)::text FROM market.user_sessions s`);
    assert.ok(dump.every((row) => !row.j.includes("203.0.113.7")));

    // Loner signs in from Alt_One's address: a session's address links accounts too.
    const login = await call("POST", "/api/auth/login", { body: { username: "Loner", password: "correct horse battery" }, ip: "203.0.113.7" });
    assert.equal(login.status, 200);
    // A request from yet another address moves that session's last address.
    assert.equal((await call("GET", "/api/profiles/me", { cookie: second.cookie, ip: "198.51.100.99" })).status, 200);
    const { rows: moved } = await pool.query(`SELECT last_ip_hash FROM market.user_sessions WHERE user_id = $1`, [twoId]);
    assert.deepEqual(moved.map((row) => row.last_ip_hash), [hashIp("198.51.100.99")]);

    const people = await call("GET", "/api/admin/users?q=alt_", { cookie: boss });
    assert.equal(people.body.ip_linking, true);
    const linked = Object.fromEntries(people.body.users.map((user) => [user.username, user.shared_ip_accounts.map((other) => other.username)]));
    assert.deepEqual(linked, { Alt_One: ["Alt_Two", "Loner"], Alt_Two: ["Alt_One", "Loner"] });
    assert.ok(!people.text.includes("203.0.113.7") && !people.text.includes(hashIp("203.0.113.7")), "no addresses or hashes in the answer");
    const lonerView = await call("GET", "/api/admin/users?q=loner", { cookie: boss });
    assert.deepEqual(lonerView.body.users[0].shared_ip_accounts.map((other) => other.username), ["Alt_One", "Alt_Two"]);

    const review = await call("GET", "/api/admin/exchange-review", { cookie: boss });
    assert.equal(review.status, 200);
    assert.equal(review.body.ip_linking, true);
    const cluster = review.body.ip_clusters.find((entry) => entry.accounts.some((account) => account.id === oneId));
    assert.deepEqual(cluster.accounts.map((account) => account.username), ["Alt_One", "Alt_Two", "Loner"]);
    assert.ok(!review.text.includes(hashIp("203.0.113.7")));

    // Without a salt nothing is recorded, and the admin pages say so.
    delete process.env.IP_HASH_SALT;
    try {
      const unsalted = await register("NoSalt", "nosalt@example.test", "203.0.113.7");
      const { rows: none } = await pool.query(`SELECT signup_ip_hash FROM market.users WHERE id = $1`, [unsalted.body.user.id]);
      assert.equal(none[0].signup_ip_hash, null);
      assert.equal((await call("GET", "/api/admin/users?q=nosalt", { cookie: boss })).body.ip_linking, false);
    } finally {
      process.env.IP_HASH_SALT = "signup-test-salt";
    }
  });

  await t.test("staked PvP tables need a verified email and an account as old as the exchange needs", async () => {
    await require("../src/services/games/catalog").syncCatalog(pool); // the server does this at start
    await pvp.init(pool);
    const veteran = await addUser("Veteran", { ageDays: 30 });
    const rival = await addUser("Rival", { ageDays: 30 });
    const newbie = await addUser("Newbie", { ageDays: 0 });
    const unverified = await addUser("Unverified", { verified: false, ageDays: 30 });
    const [newbieCookie, unverifiedCookie] = await Promise.all([newbie, unverified].map(cookieFor));

    const table = await pvp.createTable({ userId: veteran, gameKey: "high-low", stake: 25 });
    await assert.rejects(pvp.joinTable({ userId: newbie, tableId: table.id }), (error) => {
      assert.equal(error.code, "pvp_account_too_new");
      assert.ok(Date.parse(error.available_at) > Date.now());
      return true;
    });
    await assert.rejects(pvp.joinTable({ userId: unverified, tableId: table.id }), { code: "email_verification_required" });
    await assert.rejects(pvp.createTable({ userId: newbie, gameKey: "high-low", stake: 10 }), { code: "pvp_account_too_new" });

    // Through the route: 403 with when it opens up.
    const joined = await call("POST", `/api/games/tables/${table.id}/join`, { cookie: newbieCookie, body: {} });
    assert.equal(joined.status, 403);
    assert.equal(joined.body.error, "pvp_account_too_new");
    assert.ok(joined.body.available_at);
    assert.equal((await call("POST", `/api/games/tables/${table.id}/join`, { cookie: unverifiedCookie, body: {} })).body.error, "email_verification_required");

    // Nothing at stake: a new account can play.
    const free = await pvp.createTable({ userId: newbie, gameKey: "high-low", stake: 0 });
    await pvp.cancelTable({ userId: newbie, tableId: free.id });

    // An old, verified account still joins, and nothing was taken from the ones turned away.
    const playing = await pvp.joinTable({ userId: rival, tableId: table.id });
    assert.equal(playing.status, "playing");
    await pvp.actOnTable({ userId: rival, tableId: table.id, action: { type: "forfeit" } });
    const { rows: stakes } = await pool.query(`SELECT user_id FROM games.pvp_match_players WHERE match_id = $1 ORDER BY user_id`, [table.id]);
    assert.deepEqual(stakes.map((row) => Number(row.user_id)), [veteran, rival]);
  });

  await t.test("renames: verified email, once a week, name rules; an admin reset clears the wait", async () => {
    const userId = await addUser("Renamer", { verified: false });
    const cookie = await cookieFor(userId);
    const save = (body) => call("PUT", "/api/profiles/me", { cookie, body: { username: "Renamer", bio: null, ...body } });

    assert.deepEqual((await save({ username: "Renamed" })).body, { error: "rename_needs_verified_email" });
    // Everything else still saves.
    const bioOnly = await save({ bio: "PEKO to the moon" });
    assert.equal(bioOnly.status, 200);
    assert.equal(bioOnly.body.profile.rename.needs_verified_email, true);

    await pool.query(`UPDATE market.users SET email_verified = true WHERE id = $1`, [userId]);
    for (const [username, error] of [["Moderator", "username_reserved"], ["Gura", "username_talent"], ["c00n", "username_not_allowed"], ["no", "invalid_username"]]) {
      assert.deepEqual((await save({ username })).body, { error }, username);
    }
    const renamed = await save({ username: "Renamed" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.profile.username, "Renamed");
    const availableAt = Date.parse(renamed.body.profile.rename.available_at);
    assert.ok(Math.abs(availableAt - (Date.now() + 7 * 86_400_000)) < 60_000);
    assert.equal(renamed.body.profile.rename.cooldown_days, 7);

    const again = await call("PUT", "/api/profiles/me", { cookie, body: { username: "Renamed_Again", bio: null } });
    assert.equal(again.status, 429);
    assert.equal(again.body.error, "rename_cooldown");
    assert.equal(Date.parse(again.body.available_at), availableAt);
    // Saving with the same name isn't a rename.
    assert.equal((await call("PUT", "/api/profiles/me", { cookie, body: { username: "Renamed", bio: "still me" } })).status, 200);

    const bad = await call("PUT", "/api/profiles/me", { cookie, body: { username: "Renamed", bio: `hello ${nameRules.SLURS[1][0]}` } });
    assert.deepEqual(bad.body, { error: "blocked_words", field: "bio" });

    // A week later it's allowed again.
    await pool.query(`UPDATE market.users SET username_changed_at = now() - interval '7 days 1 minute' WHERE id = $1`, [userId]);
    assert.equal((await call("PUT", "/api/profiles/me", { cookie, body: { username: "Renamed_Again", bio: null } })).status, 200);

    // An admin reset happens whatever the wait, and the player can pick a name straight away.
    const reset = await call("POST", `/api/admin/users/${userId}/reset-profile`, { cookie: boss, body: { reason: "test" } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.after.username, `player_${userId}`);
    const fresh = await call("PUT", "/api/profiles/me", { cookie, body: { username: "Better_Name", bio: null } });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.profile.username, "Better_Name");
  });

  await t.test("leaderboards: unverified accounts stay off until they verify", async () => {
    const verifiedId = await addUser("Ranked", { verified: true });
    const unverifiedId = await addUser("Unranked", { verified: false });
    await netWorth.refreshCurrentLeaderboard(pool);
    const ranked = async () => (await netWorth.listLeaderboardBundle(pool, { limit: 100 })).entries.map((entry) => entry.user_id);
    assert.ok((await ranked()).includes(verifiedId));
    assert.ok(!(await ranked()).includes(unverifiedId));
    assert.deepEqual(await netWorth.listCurrentNetWorthByUserIds(pool, [unverifiedId]), []);
    const viewer = await netWorth.listLeaderboardBundle(pool, { viewerUserId: unverifiedId, limit: 100 });
    assert.equal(viewer.me ?? null, null);

    await pool.query(`UPDATE market.users SET email_verified = true WHERE id = $1`, [unverifiedId]);
    assert.ok((await ranked()).includes(unverifiedId));
  });

  await t.test("the word filter: chat, comments and article titles", async () => {
    const writerId = await addUser("Writer");
    const cookie = await cookieFor(writerId);
    const slur = nameRules.SLURS[0][0];
    await chatDb.ensureChatTopology(pool);
    const posted = await call("POST", "/api/chat/channels/market:global/messages", { cookie, body: { body: `ok ${slur.toUpperCase()}!` } });
    assert.equal(posted.status, 400);
    assert.deepEqual(posted.body, { error: "blocked_words", field: "body" });
    assert.equal((await call("POST", "/api/chat/channels/market:global/messages", { cookie, body: { body: "spicy raccoon, holy shit" } })).status, 201);

    await assert.rejects(marketDb.createAssetComment(pool, "GUR", writerId, { body: `a ${slur}` }), { code: "blocked_words", field: "body" });
    await assert.rejects(articleDb.createComment(pool, "no-such-article", writerId, `a ${slur}`), { code: "blocked_words", field: "body" });
    await assert.rejects(predictionMarketDb.createPredictionMarketComment(pool, "no-such-market", writerId, { body: `a ${slur}` }), { code: "blocked_words", field: "body" });
    await assert.rejects(articleDb.createArticle(pool, { title: `The ${slur} report`, content: "x", authorId: writerId }), { code: "blocked_words", field: "title" });
    await assert.rejects(articleDb.createArticle(pool, { title: "Fine", subtitle: "sieg heil", content: "x", authorId: writerId }), { code: "blocked_words", field: "subtitle" });
    // Swearing and ordinary words are fine; the body of an article isn't checked.
    const article = await articleDb.createArticle(pool, { title: "Holy shit, Montenegro", content: `quoting a ${slur}`, authorId: writerId, status: "draft" });
    assert.ok(article);
  });
});
