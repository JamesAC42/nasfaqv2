const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const v1Link = require("../src/services/v1Link");

const SECRET = "test-link-secret";
const env = { V1_LINK_SECRET: SECRET };

// What v1's confirmLinkV2 sends back.
const v1Stats = (overrides = {}) => ({
  id: "4a8a7f7e-0d2b-4c55-9a11-111111111111",
  username: "OldTimer",
  joined_at: "2021-04-02T15:00:00.000Z",
  peak_net_worth: "62691827094485.23",
  peak_at: "2022-01-05T00:00:00.000Z",
  net_worth: "1234567.89",
  rank: 12,
  rank_of: 3100,
  hats: 7,
  items: 19,
  ...overrides,
});

test("messages only read back with the right secret and kind", () => {
  const message = v1Link.signMessage(SECRET, { kind: "result", nonce: "abc" });
  assert.equal(v1Link.readMessage(SECRET, message, "result").nonce, "abc");
  assert.equal(v1Link.readMessage("another-secret", message, "result"), null);
  assert.equal(v1Link.readMessage(SECRET, message, "request"), null);
  const [body, mac] = message.split(".");
  const forged = Buffer.from(JSON.stringify({ kind: "result", nonce: "xyz" })).toString("base64url");
  assert.equal(v1Link.readMessage(SECRET, `${forged}.${mac}`, "result"), null);
  assert.equal(v1Link.readMessage(SECRET, body, "result"), null);
  assert.equal(v1Link.readMessage(SECRET, `${message}.extra`, "result"), null);
  assert.equal(v1Link.readMessage(SECRET, undefined, "result"), null);
  assert.equal(v1Link.readMessage(SECRET, ["a"], "result"), null);
});

test("the rewards can't be sold: the exchange only takes pulled items", () => {
  const exchangeSource = require("node:fs").readFileSync(require.resolve("../src/services/games/exchange"), "utf8");
  assert.match(exchangeSource, /TRADABLE_SOURCES = \["gacha", "exchange"\]/);
  const [badge, theme] = v1Link.rewardsFor("2021-04-02T15:00:00.000Z");
  assert.equal(badge.cosmeticKey, "v1_veteran_2021");
  assert.equal(badge.metadata.display_name, "v1 Veteran · 2021");
  assert.equal(theme.metadata.theme.pattern, "v1");
  // New York's new year, not UTC's.
  assert.equal(v1Link.rewardsFor("2022-01-01T03:00:00.000Z")[0].cosmeticKey, "v1_veteran_2021");
});

test("with no secret, linking says it isn't open and nothing is read", async () => {
  await assert.rejects(v1Link.startLink({}, { id: 1, session_id: 1 }, { env: {} }), { code: "v1_link_not_configured" });
  assert.equal(await v1Link.finishLink({}, { id: 1, session_id: 1 }, "x", { env: {} }), "not_configured");
});

// End to end on a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("v1 links end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_v1_link_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_v1_link_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_v1_link_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }

  const addUser = async (username, { isAdmin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', $2) RETURNING id, username`,
      [username, isAdmin]
    );
    return { id: Number(rows[0].id), username: rows[0].username, session_id: Number(rows[0].id) * 100, is_admin: isAdmin };
  };

  // Starts a link and answers as v1 would: reads the request off the address and signs a result for it.
  const startAndAnswer = async (user, stats = v1Stats(), { exp = Date.now() + 60_000 } = {}) => {
    const { url } = await v1Link.startLink(pool, user, { env });
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://nasfaq.biz/api/linkV2/start");
    const request = v1Link.readMessage(SECRET, parsed.searchParams.get("token"), "request");
    assert.equal(request.username, user.username);
    assert.ok(request.exp > Date.now());
    return v1Link.signMessage(SECRET, { kind: "result", nonce: request.nonce, exp, v1: stats });
  };
  const attemptsOf = async (user) => (await pool.query(`SELECT status, reason FROM market.v1_link_attempts WHERE user_id = $1 ORDER BY id`, [user.id])).rows;
  const cosmeticsOf = async (user) => (await pool.query(`SELECT cosmetic_key, source_type FROM games.user_cosmetics WHERE user_id = $1 ORDER BY cosmetic_key`, [user.id])).rows;
  const badgeOf = async (user) =>
    (
      await pool.query(
        `SELECT uc.cosmetic_key FROM games.user_equipped_cosmetics ec JOIN games.user_cosmetics uc ON uc.id = ec.user_cosmetic_id WHERE ec.user_id = $1 AND ec.slot_key = 'profile_badge'`,
        [user.id]
      )
    ).rows[0]?.cosmetic_key;

  const alice = await addUser("alice");
  const mallory = await addUser("mallory");
  const boss = await addUser("boss", { isAdmin: true });

  await t.test("a player links, keeps a snapshot, and gets the badge on and the theme in the locker", async () => {
    assert.equal(await v1Link.getLink(pool, alice.id), null);
    const result = await startAndAnswer(alice);
    assert.equal(await v1Link.finishLink(pool, alice, result, { env }), "linked");

    const link = await v1Link.getLink(pool, alice.id);
    assert.equal(link.username, "OldTimer");
    assert.equal(link.peak_net_worth, 62691827094485.23);
    assert.equal(link.rank, 12);
    assert.equal(link.hats, 7);
    assert.equal(link.show_on_profile, true);
    assert.deepEqual(await cosmeticsOf(alice), [
      { cosmetic_key: "v1_classic_theme", source_type: "v1_link" },
      { cosmetic_key: "v1_veteran_2021", source_type: "v1_link" },
    ]);
    assert.equal(await badgeOf(alice), "v1_veteran_2021");
    assert.deepEqual((await attemptsOf(alice)).at(-1), { status: "linked", reason: null });

    // Coming back to the same result doesn't link or grant twice.
    assert.equal(await v1Link.finishLink(pool, alice, result, { env }), "linked");
    assert.equal((await cosmeticsOf(alice)).length, 2);
    await assert.rejects(v1Link.startLink(pool, alice, { env }), { code: "v1_already_linked" });
  });

  await t.test("the snapshot stores no email or password", async () => {
    const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'market' AND table_name = 'v1_account_links'`);
    for (const { column_name: column } of rows) assert.doesNotMatch(column, /email|password|ip/);
  });

  await t.test("a stolen confirmation doesn't help: it only finishes in the account and session that started it", async () => {
    // Mallory starts a link on their own account and gets a v1 player to confirm it.
    const victim = await addUser("victim");
    const lure = await startAndAnswer(mallory, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-222222222222", username: "VictimV1" }));
    assert.equal(await v1Link.finishLink(pool, victim, lure, { env }), "wrong_account");
    assert.equal(await v1Link.getLink(pool, victim.id), null);
    assert.equal(await v1Link.getLink(pool, mallory.id), null);
    // That closes it, so Mallory can't use it either.
    assert.equal(await v1Link.finishLink(pool, mallory, lure, { env }), "used");
    assert.equal(await v1Link.getLink(pool, mallory.id), null);

    const signedOut = await startAndAnswer(mallory, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-222222222222" }));
    assert.equal(await v1Link.finishLink(pool, null, signedOut, { env }), "signed_out");

    const otherDevice = await startAndAnswer(mallory, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-222222222222" }));
    assert.equal(await v1Link.finishLink(pool, { ...mallory, session_id: mallory.session_id + 1 }, otherDevice, { env }), "other_session");
    assert.equal(await v1Link.getLink(pool, mallory.id), null);
  });

  await t.test("bad, late and unknown results don't link", async () => {
    const carol = await addUser("carol");
    assert.equal(await v1Link.finishLink(pool, carol, "not-a-message", { env }), "invalid");
    const forged = await startAndAnswer(carol);
    assert.equal(await v1Link.finishLink(pool, carol, forged.replace(/.$/, (c) => (c === "A" ? "B" : "A")), { env }), "invalid");
    assert.equal(await v1Link.finishLink(pool, carol, v1Link.signMessage("wrong-secret", { kind: "result", nonce: "x" }), { env }), "invalid");
    assert.equal(await v1Link.finishLink(pool, carol, v1Link.signMessage(SECRET, { kind: "result", nonce: "never-issued", v1: v1Stats() }), { env }), "invalid");

    const late = await startAndAnswer(carol, v1Stats(), { exp: Date.now() - 1 });
    assert.equal(await v1Link.finishLink(pool, carol, late, { env }), "expired");

    const slow = await startAndAnswer(carol);
    assert.equal(await v1Link.finishLink(pool, carol, slow, { env, now: Date.now() + 11 * 60 * 1000 }), "expired");

    const badStats = await startAndAnswer(carol, v1Stats({ peak_net_worth: "1e99" }));
    assert.equal(await v1Link.finishLink(pool, carol, badStats, { env }), "invalid");

    const suspended = await startAndAnswer(carol);
    assert.equal(await v1Link.finishLink(pool, { ...carol, suspension: { reason: "x" } }, suspended, { env }), "suspended");
    assert.equal(await v1Link.getLink(pool, carol.id), null);
  });

  await t.test("only accounts made before October 1, 2026 can link", async () => {
    const dave = await addUser("dave");
    const tooNew = await startAndAnswer(dave, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-333333333333", joined_at: "2026-10-01T04:00:00.000Z" }));
    assert.equal(await v1Link.finishLink(pool, dave, tooNew, { env }), "too_new");
    assert.equal(await v1Link.getLink(pool, dave.id), null);
    const justInTime = await startAndAnswer(dave, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-333333333333", joined_at: "2026-10-01T03:59:59.000Z" }));
    assert.equal(await v1Link.finishLink(pool, dave, justInTime, { env }), "linked");
    assert.equal(await badgeOf(dave), "v1_veteran_2026");
  });

  await t.test("one v1 account to one v2 account, both ways", async () => {
    const erin = await addUser("erin");
    const taken = await startAndAnswer(erin); // the v1 account alice linked
    assert.equal(await v1Link.finishLink(pool, erin, taken, { env }), "v1_taken");
    assert.equal(await v1Link.getLink(pool, erin.id), null);
    assert.equal((await cosmeticsOf(erin)).length, 0);

    // Two tabs: a second link can't land on an account that linked after it started.
    const fresh = v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-444444444444", username: "SecondAccount" });
    const first = await startAndAnswer(erin, fresh);
    const second = await startAndAnswer(erin, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-555555555555" }));
    assert.equal(await v1Link.finishLink(pool, erin, first, { env }), "linked");
    assert.equal(await v1Link.finishLink(pool, erin, second, { env }), "already_linked");
    assert.equal((await v1Link.getLink(pool, erin.id)).username, "SecondAccount");
  });

  await t.test("a badge already worn stays on", async () => {
    const frank = await addUser("frank");
    const { rows } = await pool.query(
      `INSERT INTO games.user_cosmetics (user_id, cosmetic_key, cosmetic_type, rarity, source_type) VALUES ($1, 'gold_star', 'profile_badge', 'epic', 'gacha') RETURNING id`,
      [frank.id]
    );
    await pool.query(`INSERT INTO games.user_equipped_cosmetics (user_id, slot_key, user_cosmetic_id) VALUES ($1, 'profile_badge', $2)`, [frank.id, rows[0].id]);
    const result = await startAndAnswer(frank, v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-666666666666" }));
    assert.equal(await v1Link.finishLink(pool, frank, result, { env }), "linked");
    assert.equal(await badgeOf(frank), "gold_star");
  });

  await t.test("the profile shows it unless the player hides it, and they always see their own", async () => {
    assert.equal((await v1Link.getProfileLink(pool, alice.id)).username, "OldTimer");
    const hidden = await v1Link.setShowOnProfile(pool, alice.id, false);
    assert.equal(hidden.show_on_profile, false);
    assert.equal(await v1Link.getProfileLink(pool, alice.id), null);
    assert.equal((await v1Link.getProfileLink(pool, alice.id, { isSelf: true })).show_on_profile, false);
    await v1Link.setShowOnProfile(pool, alice.id, true);
    await assert.rejects(v1Link.setShowOnProfile(pool, mallory.id, true), { code: "v1_link_not_found" });
  });

  await t.test("routes: the callback leaves nothing in the URL and no referrer, and the admin ones are admin only", async () => {
    const adminRoutes = require("../src/routes/admin");
    const v1LinkRoutes = require("../src/routes/v1Link");
    let viewer = null;
    const app = express();
    app.use((req, _res, next) => {
      req.ctx = { pool, redis: null, user: viewer };
      next();
    });
    app.use(express.json());
    app.use("/api/v1-link", v1LinkRoutes);
    app.use("/api/admin", adminRoutes);
    app.use((error, _req, res, _next) => res.status(error?.code === "unauthenticated" ? 401 : error?.code === "forbidden" ? 403 : 500).json({ error: error.code || error.message }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const previous = process.env.V1_LINK_SECRET;
    process.env.V1_LINK_SECRET = SECRET;
    t.after(() => {
      if (previous === undefined) delete process.env.V1_LINK_SECRET;
      else process.env.V1_LINK_SECRET = previous;
    });

    assert.equal((await fetch(`${base}/api/v1-link/me`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1-link/start`, { method: "POST" })).status, 401);

    const grace = await addUser("grace");
    viewer = grace;
    const me = await (await fetch(`${base}/api/v1-link/me`)).json();
    assert.equal(me.configured, true);
    assert.equal(me.link, null);
    const { url } = await (await fetch(`${base}/api/v1-link/start`, { method: "POST" })).json();
    const request = v1Link.readMessage(SECRET, new URL(url).searchParams.get("token"), "request");
    const result = v1Link.signMessage(SECRET, { kind: "result", nonce: request.nonce, exp: Date.now() + 60_000, v1: v1Stats({ id: "4a8a7f7e-0d2b-4c55-9a11-777777777777", username: "GraceV1" }) });
    const back = await fetch(`${base}/api/v1-link/callback?result=${encodeURIComponent(result)}`, { redirect: "manual" });
    assert.equal(back.status, 303);
    assert.match(back.headers.get("location"), /\/link-v1\?status=linked$/);
    assert.equal(back.headers.get("referrer-policy"), "no-referrer");
    assert.equal(back.headers.get("cache-control"), "no-store");
    const refused = await fetch(`${base}/api/v1-link/callback?result=nonsense`, { redirect: "manual" });
    assert.match(refused.headers.get("location"), /status=invalid$/);

    assert.equal((await fetch(`${base}/api/admin/v1-links`)).status, 403);
    assert.equal((await fetch(`${base}/api/admin/v1-links/${grace.id}`, { method: "DELETE" })).status, 403);
    assert.ok(await v1Link.getLink(pool, grace.id));

    viewer = boss;
    const summary = await (await fetch(`${base}/api/admin/v1-links?q=gracev`)).json();
    assert.deepEqual(summary.recent.map((row) => row.username), ["grace"]);
    const undone = await fetch(`${base}/api/admin/v1-links/${grace.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "asked" }) });
    assert.equal(undone.status, 200);
    assert.equal((await fetch(`${base}/api/admin/v1-links/${grace.id}`, { method: "DELETE" })).status, 404);
    assert.equal(await v1Link.getLink(pool, grace.id), null);
  });

  await t.test("undoing takes back the rewards, frees the v1 account, and goes in the admin log", async () => {
    const before = await cosmeticsOf(alice);
    assert.equal(before.length, 2);
    await v1Link.unlink(pool, { userId: alice.id, actor: boss, reason: "wrong account" });
    assert.equal(await v1Link.getLink(pool, alice.id), null);
    assert.deepEqual(await cosmeticsOf(alice), []);
    assert.equal(await badgeOf(alice), undefined);
    const { rows } = await pool.query(`SELECT actor_id, action, target_label, reason, details FROM market.admin_actions WHERE action = 'user.v1_unlink' ORDER BY id DESC LIMIT 1`);
    assert.equal(Number(rows[0].actor_id), boss.id);
    assert.equal(rows[0].target_label, "alice");
    assert.equal(rows[0].reason, "wrong account");
    assert.equal(rows[0].details.v1_username, "OldTimer");

    // Other cosmetics stay, and the freed v1 account can link to someone else.
    const heidi = await addUser("heidi");
    const relink = await startAndAnswer(heidi);
    assert.equal(await v1Link.finishLink(pool, heidi, relink, { env }), "linked");
    await assert.rejects(v1Link.unlink(pool, { userId: alice.id, actor: boss }), { code: "v1_link_not_found" });
  });

  await t.test("the admin numbers count links, the active and who stopped where", async () => {
    await pool.query(`INSERT INTO market.user_sessions (user_id, session_token_hash, expires_at, last_seen_at) VALUES ($1, 'seen-today', now() + interval '1 day', now())`, [(await pool.query(`SELECT id FROM market.users WHERE username = 'heidi'`)).rows[0].id]);
    const ivan = await addUser("ivan");
    await v1Link.startLink(pool, ivan, { env, now: Date.now() - 60 * 60 * 1000 }); // an hour ago, and never came back
    const judy = await addUser("judy");
    await v1Link.startLink(pool, judy, { env }); // still on v1

    const summary = await v1Link.adminSummary(pool);
    assert.equal(summary.eligible_accounts, v1Link.ELIGIBLE_V1_ACCOUNTS);
    assert.equal(summary.linked, 4); // dave, erin, frank, heidi
    assert.equal(summary.active_7d, 1);
    assert.equal(summary.in_progress, 2); // judy, and carol's try whose result was forged
    assert.equal(summary.by_day.reduce((sum, row) => sum + row.linked, 0), 4);
    assert.match(summary.by_day[0].day, /^\d{4}-\d{2}-\d{2}$/);
    const reasons = Object.fromEntries(summary.not_finished.map((row) => [row.reason, row.players]));
    assert.equal(reasons.abandoned, 1);
    assert.equal(reasons.other_session, 1); // mallory's last try
    assert.equal(reasons.suspended, 1); // carol's last try
    assert.equal(reasons.linked, undefined);
    assert.deepEqual(summary.recent.map((row) => row.username).sort(), ["dave", "erin", "frank", "heidi"]);
    assert.equal(summary.recent.some((row) => "email" in row), false);
  });
});
