const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const referrals = require("../src/services/referrals");
const visits = require("../src/services/visits");

// Referral links, their reward rules and alt checks, the signed-out visit counter, and the admin
// numbers that read them. The rules on their own first; then end to end on a freshly migrated
// database of its own from the local or CI test server.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const settings = { cash: 250, credit: 2500, weeklyCap: 3, windowDays: 30, minAgeHours: 72 };
const now = new Date("2026-11-06T12:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
const player = (id, overrides = {}) => ({ id, created_at: ago(30 * DAY), email_verified: true, suspended: false, ...overrides });
const facts = (overrides = {}) => ({
  referral: { status: "pending", referrer_status: null },
  referrer: player(1),
  referee: player(2, { created_at: ago(2 * HOUR) }),
  firstFillAt: ago(HOUR),
  sharedIp: false,
  referrerPaidAt: [],
  ...overrides,
});
const decide = (overrides) => referrals.decideReferral(facts(overrides), settings, now);

test("rules: a first fill pays both players", () => {
  const decision = decide();
  assert.equal(decision.referee.action, "pay");
  assert.equal(decision.referrer.action, "pay");
});

test("rules: nothing happens before the first fill, and the referral runs out after the window", () => {
  assert.deepEqual(decide({ firstFillAt: null }).referee, { action: "wait", reason: "no_trade" });
  assert.equal(decide({ firstFillAt: null }).referrer.action, "none");
  const old = decide({ firstFillAt: null, referee: player(2, { created_at: ago(31 * DAY) }) });
  assert.deepEqual(old.referee, { action: "expire", reason: "no_trade" });
  // A fill without a verified email waits too (trading needs one, so this is rare).
  assert.deepEqual(decide({ referee: player(2, { created_at: ago(2 * HOUR), email_verified: false }) }).referee, { action: "wait", reason: "unverified" });
});

test("rules: alts, self-referrals and suspended new accounts get nothing", () => {
  assert.deepEqual(decide({ sharedIp: true }), { referee: { action: "refuse", reason: "shared_ip" }, referrer: { action: "none", reason: null, retryAt: null } });
  assert.equal(decide({ referee: player(1) }).referee.reason, "self");
  assert.equal(decide({ referee: player(2, { suspended: true }) }).referee.reason, "suspended");
});

test("rules: the sharer's share waits for a verified email and an account old enough", () => {
  const unverified = decide({ referrer: player(1, { email_verified: false }) });
  assert.equal(unverified.referee.action, "pay", "the new player is still paid");
  assert.equal(unverified.referrer.action, "wait");
  assert.equal(unverified.referrer.reason, "unverified");
  assert.ok(unverified.referrer.retryAt > now);

  const created = now.getTime() - 10 * HOUR;
  const young = decide({ referrer: player(1, { created_at: new Date(created).toISOString() }) });
  assert.equal(young.referee.action, "pay");
  assert.deepEqual(young.referrer, { action: "wait", reason: "too_new", retryAt: new Date(created + 72 * HOUR) });
});

test("rules: the weekly cap holds the sharer's share until a slot frees", () => {
  const paid = [ago(6 * DAY), ago(3 * DAY), ago(HOUR)];
  const capped = decide({ referrerPaidAt: paid });
  assert.equal(capped.referee.action, "pay", "the new player is paid whatever the cap");
  assert.equal(capped.referrer.action, "wait");
  assert.equal(capped.referrer.reason, "weekly_cap");
  assert.equal(capped.referrer.retryAt.getTime(), now.getTime() - 6 * DAY + 7 * DAY, "when the oldest payout turns a week old");
  // Payouts older than a week don't count.
  assert.equal(decide({ referrerPaidAt: [ago(8 * DAY), ago(3 * DAY), ago(HOUR)] }).referrer.action, "pay");
  // A cap of 0 turns the sharer's share off.
  assert.equal(referrals.decideReferral(facts(), { ...settings, weeklyCap: 0 }, now).referrer.reason, "sharer_rewards_off");
});

test("rules: with IP linking off, the sharer's share waits (the alt check can't run)", () => {
  const off = decide({ ipCheck: false });
  assert.equal(off.referee.action, "pay", "the new player's own bonus still pays");
  assert.equal(off.referrer.action, "wait");
  assert.equal(off.referrer.reason, "ip_check_off");
  assert.equal(off.referrer.retryAt.getTime(), now.getTime() + HOUR);
});

test("rules: a waiting share is checked again, alt checks included", () => {
  const waiting = { referral: { status: "paid", referrer_status: "waiting" } };
  assert.deepEqual(decide(waiting).referee, { action: "done", reason: null });
  assert.equal(decide(waiting).referrer.action, "pay");
  assert.equal(decide({ ...waiting, sharedIp: true }).referrer.reason, "shared_ip");
  assert.equal(decide({ ...waiting, referrer: player(1, { suspended: true }) }).referrer.reason, "suspended");
  // Settled ones are left alone.
  assert.equal(decide({ referral: { status: "refused", referrer_status: null } }).referee.action, "done");
  assert.equal(decide({ referral: { status: "paid", referrer_status: "paid" } }).referrer.action, "none");
});

test("ref values: codes and source tags are cleaned, newest first, no repeats", () => {
  assert.equal(referrals.cleanTag(" V1-Email "), "v1-email");
  assert.equal(referrals.cleanTag("no spaces please"), null);
  assert.equal(referrals.cleanTag("-leading"), null);
  assert.equal(referrals.cleanTag("x".repeat(41)), null);
  assert.deepEqual(referrals.cleanRefs([{ ref: "abc", via: "blackjack" }, "ABC", { ref: "v1-email", via: "<script>" }, null]), [
    { tag: "abc", via: "blackjack" },
    { tag: "v1-email", via: "link" },
  ]);
  const code = referrals.generateCode();
  assert.match(code, /^[a-z2-9]{8}$/);
  assert.ok([...code].every((letter) => referrals.CODE_ALPHABET.includes(letter)));
});

test("visits: only a daily-salted hash, the path and the referring host", () => {
  const a = visits.visitorHash("salt-one", "203.0.113.9", "Mozilla/5.0");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes("203"));
  assert.equal(visits.visitorHash("salt-one", "203.0.113.9", "Mozilla/5.0"), a, "same visitor, same day");
  assert.notEqual(visits.visitorHash("salt-two", "203.0.113.9", "Mozilla/5.0"), a, "a new day's salt, a new hash");
  assert.equal(visits.visitorHash("s", "2001:db8:1:2:aaaa::1", "UA"), visits.visitorHash("s", "2001:db8:1:2:bbbb::9", "UA"), "IPv6 by its /64");
  assert.equal(visits.cleanPath("/reset-password?token=secret#x"), "/reset-password");
  assert.equal(visits.cleanPath("/profile/honk/"), "/profile/honk");
  assert.equal(visits.cleanPath("//evil.example"), null);
  assert.equal(visits.cleanPath("https://holo.nasfaq.biz/"), null);
  assert.equal(visits.cleanPath(`/${"a".repeat(250)}`), null);
  assert.equal(visits.cleanReferrerHost("https://www.Reddit.com/r/Hololive?x=1"), "reddit.com");
  assert.equal(visits.cleanReferrerHost("https://holo.nasfaq.biz/market", new Set(["holo.nasfaq.biz"])), null);
  assert.equal(visits.cleanReferrerHost("javascript:alert(1)"), null);
  assert.ok(visits.isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"));
  assert.ok(visits.isBot("Mozilla/5.0 HeadlessChrome/120"));
  assert.ok(!visits.isBot("Mozilla/5.0 (Linux; Android 13; Cubot X30) Chrome/120 Mobile Safari/537.36"));
  assert.equal(visits.dayKey(new Date("2026-11-06T03:30:00Z")), "2026-11-05", "New York days");
});

test("visits: huge inputs are cut before any regex runs on them", () => {
  const slashes = "/".repeat(200_000);
  const started = process.hrtime.bigint();
  assert.equal(visits.cleanPath(`/market${slashes}`), "/market", "a long run of trailing slashes");
  assert.equal(visits.cleanPath(`/market${slashes}x`), "/market", "cut before the slashes end");
  assert.equal(visits.cleanPath(`/a${"/b".repeat(100_000)}/`), null, "too long once cut");
  assert.equal(visits.cleanPath(slashes), null);
  assert.equal(visits.cleanPath(`/profile/honk/?x=${slashes}`), "/profile/honk", "a short path with a huge query");
  assert.equal(visits.cleanReferrerHost(`https://www.example.com/${slashes}`), "example.com");
  assert.ok(!visits.isBot(`Mozilla/5.0 ${"a".repeat(200_000)} bot/1.0`), "only the start of a user agent is read");
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `took ${ms.toFixed(1)} ms`);
});

test("visits: the salt is shared through Redis, and falls back to one of the process's own", async () => {
  const store = new Map();
  const redis = {
    async set(key, value, options) {
      assert.equal(options.NX, true);
      assert.ok(options.EX > 0 && options.EX <= 2 * 86_400, "thrown away within two days");
      if (!store.has(key)) store.set(key, value);
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
  const first = await visits.dailySalt(redis, "2030-01-01");
  assert.equal(store.get("nasfaq:visits:salt:2030-01-01"), first);
  assert.equal(await visits.dailySalt(redis, "2030-01-01"), first);
  assert.notEqual(await visits.dailySalt(redis, "2030-01-02"), first, "each day gets its own");
  const offline = await visits.dailySalt(null, "2030-01-03");
  assert.match(offline, /^[0-9a-f]{64}$/);
});

// ── End to end ───────────────────────────────────────────────────────────

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

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
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error?.message || error) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { body, cookie, ip, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36" } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "user-agent": ua,
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
    return { status: res.status, body: json, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
}

test("referrals, visits and the admin numbers, end to end", { skip: !databaseUrl, timeout: 240_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_referrals_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_referrals_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_referrals_test";
  const pool = new Pool({ connectionString: target.href });
  const savedSalt = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = "referrals-test-salt";
  const quiet = [console.warn, console.log, console.info];
  t.after(async () => {
    [console.warn, console.log, console.info] = quiet;
    if (savedSalt === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = savedSalt;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await pool.end();
  });

  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const emailRules = require("../src/services/emailRules");
  const { hashIp } = require("../src/services/ipHash");
  const playerAnalytics = require("../src/services/playerAnalytics");
  console.warn = console.log = console.info = () => {};
  await applySchema(pool);
  await applySchema(pool); // every start runs it again

  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol) VALUES ('UCpeko', 'Pekora', 'Usada Pekora', 'PEK')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price, current_bid_price, current_ask_price)
     VALUES ('UCpeko', 'PEK', 'Usada Pekora', 'active', 10000, 0, 10000, 1000, 400, 20, 19.6, 20.4) RETURNING id`
  );
  const pek = Number(assetRows[0].id);

  const addUser = async (username, { verified = true, isAdmin = false, ageHours = 30 * 24, ip = null } = {}) => {
    const email = `${username.toLowerCase()}@example.test`;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_normalized, email_verified, password_hash, password_salt, password_params_json, is_admin, created_at, signup_ip_hash)
       VALUES ($1, lower($1), $2, $3, $4, 'x', 'x', '{}', $5, now() - make_interval(hours => $6), $7) RETURNING id`,
      [username, email, emailRules.canonicalEmail(email), verified, isAdmin, ageHours, ip ? hashIp(ip) : null]
    );
    return Number(rows[0].id);
  };
  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const fill = async (userId) => {
    const { rows } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, requested_quantity, filled_quantity, status) VALUES ($1, $2, 'buy', 10, 10, 'filled') RETURNING id`,
      [userId, pek]
    );
    await pool.query(
      `INSERT INTO market.trade_fills (order_id, asset_id, user_id, ts, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type)
       VALUES ($1, $2, $3, now(), 'buy', 20, 10, 200, 2, -202, 'treasury')`,
      [rows[0].id, pek, userId]
    );
  };
  const wallet = async (userId) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [userId]);
    return rows[0] ? { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) } : null;
  };
  const referralOf = async (refereeId) => (await pool.query(`SELECT * FROM market.referrals WHERE referee_id = $1`, [refereeId])).rows[0];
  const settle = (options = {}) => referrals.settleDueReferrals(pool, { settings: { ...settings, ...options.settings }, now: options.now || new Date() });

  const call = await serve(
    t,
    async (req) => ({ pool, redis: null, user: await auth.getAuthenticatedUser(pool, req) }),
    (app) => {
      app.use("/api/auth", require("../src/routes/auth"));
      app.use("/api/referrals", require("../src/routes/referrals"));
      app.use("/api/site", require("../src/routes/site"));
      app.use("/api/admin", require("../src/routes/admin"));
    }
  );
  let signups = 0;
  const register = async (username, ip, refs) => {
    signups += 1;
    const res = await call("POST", "/api/auth/register", {
      body: { username, email: `${username.toLowerCase().replace(/ /g, "")}@example.test`, password: "correct horse battery", ogey: "rrat", refs },
      ip,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { id: res.body.user.id, cookie: res.cookie };
  };
  const verify = (userId) => pool.query(`UPDATE market.users SET email_verified = true, email_verified_at = now() WHERE id = $1`, [userId]);

  const sharerId = await addUser("Sharer", { ip: "198.51.100.10" });
  const sharer = await cookieFor(sharerId);
  let code;

  await t.test("each player gets one link, made when they first ask", async () => {
    const me = await call("GET", "/api/referrals/me", { cookie: sharer, ip: "198.51.100.10" });
    assert.equal(me.status, 200);
    code = me.body.code;
    assert.match(code, /^[a-z2-9]{8}$/);
    assert.equal(me.body.path, `/?ref=${code}`);
    assert.deepEqual(me.body.settings, { cash: 250, credit: 2500, weekly_cap: 3, window_days: 30, min_age_hours: referrals.referralSettings().minAgeHours });
    assert.equal((await call("GET", "/api/referrals/me", { cookie: sharer })).body.code, code, "the same code every time");
    assert.equal((await call("GET", "/api/referrals/me")).status, 401);
    const invite = await call("GET", `/api/referrals/invite/${code.toUpperCase()}`);
    assert.equal(invite.status, 200);
    assert.equal(invite.body.username, "Sharer");
    assert.equal((await call("GET", "/api/referrals/invite/v1-email")).status, 404);
  });

  let friend;
  await t.test("signing up through a shared moment records the referral and the source tag", async () => {
    friend = await register("Friend", "203.0.113.20", [
      { ref: code, via: "blackjack" },
      { ref: "v1-email", via: "link" },
    ]);
    const referral = await referralOf(friend.id);
    assert.equal(Number(referral.referrer_id), sharerId);
    assert.equal(referral.via, "blackjack");
    assert.equal(referral.status, "pending");
    const { rows } = await pool.query(`SELECT signup_source FROM market.users WHERE id = $1`, [friend.id]);
    assert.equal(rows[0].signup_source, "v1-email");

    // A source tag on its own, and junk, are just counted (or dropped): no referral.
    const tagged = await register("Tagged", "203.0.113.21", ["v1-email"]);
    assert.equal(await referralOf(tagged.id), undefined);
    const junk = await register("Junk", "203.0.113.22", [{ ref: "<b>hi</b>" }, 42]);
    assert.equal(await referralOf(junk.id), undefined);
    assert.equal((await pool.query(`SELECT signup_source FROM market.users WHERE id = $1`, [junk.id])).rows[0].signup_source, null);
  });

  await t.test("nothing is paid until the new player's first fill, then both are", async () => {
    assert.deepEqual(await settle(), []);
    assert.equal((await referralOf(friend.id)).status, "pending");
    await verify(friend.id);
    await fill(friend.id);
    const before = { friend: await wallet(friend.id), sharer: await wallet(sharerId) };
    const [result] = await settle();
    assert.equal(result.decision.referee.action, "pay");
    assert.equal(result.decision.referrer.action, "pay");
    const referral = await referralOf(friend.id);
    assert.equal(referral.status, "paid");
    assert.equal(referral.referrer_status, "paid");
    assert.ok(referral.referee_paid_at && referral.referrer_paid_at);
    const after = { friend: await wallet(friend.id), sharer: await wallet(sharerId) };
    // A player without a cash row yet gets one (with the starting grant) first.
    assert.deepEqual(after.friend, { cash: (before.friend?.cash ?? 10000) + 250, credit: (before.friend?.credit ?? 100000) + 2500 });
    assert.deepEqual(after.sharer, { cash: (before.sharer?.cash ?? 10000) + 250, credit: (before.sharer?.credit ?? 100000) + 2500 });
    const { rows: ledger } = await pool.query(
      `SELECT user_id, cash_delta, credit_delta FROM market.ledger_entries WHERE entry_type = 'referral_reward' AND reference_type = 'referral' AND reference_id = $1 ORDER BY user_id`,
      [referral.id]
    );
    assert.deepEqual(
      ledger.map((row) => [Number(row.user_id), Number(row.cash_delta), Number(row.credit_delta)]),
      [sharerId, friend.id].sort((a, b) => a - b).map((id) => [id, 250, 2500])
    );
    const { rows: notes } = await pool.query(`SELECT user_id, title FROM market.notifications WHERE kind = 'referral' ORDER BY user_id`);
    assert.equal(notes.length, 2);
    assert.ok(notes.every((note) => note.title.includes("$250 and 2,500 Credit")));
    // Settling again pays nothing more.
    assert.deepEqual(await settle(), []);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.ledger_entries WHERE entry_type = 'referral_reward'`)).rows[0].n, 2);
  });

  await t.test("an alt on the sharer's network gets nothing, and neither does the sharer", async () => {
    const alt = await register("AltKid", "198.51.100.10", [code]);
    await verify(alt.id);
    await fill(alt.id);
    await settle();
    const referral = await referralOf(alt.id);
    assert.equal(referral.status, "refused");
    assert.equal(referral.reason, "shared_ip");
    assert.equal(referral.referrer_status, null);
    assert.equal(Number(referral.referee_cash) + Number(referral.referrer_cash), 0);
    // Caught through a later session's address too, not only the sign-up one.
    const sneaky = await register("Sneaky", "192.0.2.77", [code]);
    await pool.query(`UPDATE market.user_sessions SET last_ip_hash = $2 WHERE user_id = $1`, [sharerId, hashIp("192.0.2.77")]);
    await verify(sneaky.id);
    await fill(sneaky.id);
    await settle();
    assert.equal((await referralOf(sneaky.id)).reason, "shared_ip");
  });

  await t.test("two referred accounts on one network: the first is paid, the second isn't", async () => {
    const first = await register("Roomie One", "203.0.113.50", [code]);
    const second = await register("Roomie Two", "203.0.113.50", [code]);
    for (const user of [first, second]) {
      await verify(user.id);
      await fill(user.id);
    }
    await settle();
    assert.equal((await referralOf(first.id)).status, "paid");
    const refused = await referralOf(second.id);
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "shared_ip");
  });

  await t.test("the weekly cap: the new player is paid, the sharer's share waits for a free slot", async () => {
    // Friend and Roomie One already paid the sharer this week; the cap here is 3.
    const third = await register("Third", "203.0.113.61", [code]);
    const fourth = await register("Fourth", "203.0.113.62", [code]);
    for (const user of [third, fourth]) {
      await verify(user.id);
      await fill(user.id);
    }
    await settle();
    assert.equal((await referralOf(third.id)).referrer_status, "paid");
    const capped = await referralOf(fourth.id);
    assert.equal(capped.status, "paid", "the new player's share isn't capped");
    assert.equal(Number(capped.referee_cash), 250);
    assert.equal(capped.referrer_status, "waiting");
    assert.equal(capped.referrer_reason, "weekly_cap");
    assert.equal(Number(capped.referrer_cash), 0);
    const { rows: oldest } = await pool.query(`SELECT min(referrer_paid_at) AS at FROM market.referrals WHERE referrer_id = $1`, [sharerId]);
    assert.equal(new Date(capped.referrer_retry_at).getTime(), new Date(oldest[0].at).getTime() + 7 * DAY);
    assert.deepEqual(await settle(), [], "not tried again before then");
    const later = new Date(new Date(capped.referrer_retry_at).getTime() + 1000);
    const [result] = await settle({ now: later });
    assert.equal(result.decision.referrer.action, "pay");
    assert.equal((await referralOf(fourth.id)).referrer_status, "paid");
  });

  await t.test("a sharer whose account is too new is paid once it's old enough", async () => {
    // Two days old: under the 72 hours, and not one of today's sign-ups.
    const youngId = await addUser("Youngster", { ageHours: 48, ip: "198.51.100.80" });
    const youngCode = await referrals.ensureReferralCode(pool, youngId);
    const pal = await register("Pal", "203.0.113.81", [youngCode]);
    await verify(pal.id);
    await fill(pal.id);
    await settle();
    const waiting = await referralOf(pal.id);
    assert.equal(waiting.status, "paid");
    assert.equal(waiting.referrer_status, "waiting");
    assert.equal(waiting.referrer_reason, "too_new");
    const { rows } = await pool.query(`SELECT created_at FROM market.users WHERE id = $1`, [youngId]);
    assert.equal(new Date(waiting.referrer_retry_at).getTime(), new Date(rows[0].created_at).getTime() + 72 * HOUR);
    await settle({ now: new Date(new Date(waiting.referrer_retry_at).getTime() + 1000) });
    assert.equal((await referralOf(pal.id)).referrer_status, "paid");
  });

  await t.test("a referral with no trade runs out after the window", async () => {
    const idle = await register("Idler", "203.0.113.90", [code]);
    await settle({ now: new Date(Date.now() + 31 * DAY) });
    const referral = await referralOf(idle.id);
    assert.equal(referral.status, "expired");
    assert.equal(referral.reason, "no_trade");
  });

  await t.test("a player can't refer themselves", async () => {
    await assert.rejects(pool.query(`INSERT INTO market.referrals (referrer_id, referee_id) VALUES ($1, $1)`, [sharerId]), /market_referrals_not_self/);
    const result = await referrals.recordSignup(pool, { userId: sharerId, refs: [code] });
    assert.equal(result.referral_id, null);
    assert.equal(result.source, null, "their own code isn't a source tag either");
  });

  await t.test("the referral panel lists who joined and what's been paid", async () => {
    const me = (await call("GET", "/api/referrals/me", { cookie: sharer })).body;
    assert.equal(me.totals.joined, 8);
    assert.equal(me.totals.paid, 4);
    assert.equal(me.totals.cash, 1000);
    const byName = new Map(me.joined.map((row) => [row.username, row]));
    assert.equal(byName.get("Friend").via, "blackjack");
    assert.equal(byName.get("Friend").your_share, "paid");
    assert.equal(byName.get("AltKid").status, "refused");
    assert.equal(byName.get("Idler").status, "expired");
    assert.ok(!JSON.stringify(me).includes("example.test"), "no emails");
    const invited = (await call("GET", "/api/referrals/me", { cookie: friend.cookie })).body.invited_by;
    assert.deepEqual({ username: invited.username, status: invited.status, cash: invited.cash, credit: invited.credit }, { username: "Sharer", status: "paid", cash: 250, credit: 2500 });
  });

  await t.test("signed-out visits are counted without an address; signed-in and bots aren't", async () => {
    const page = (body, options) => call("POST", "/api/site/here", { body, ...options });
    assert.equal((await page({ path: "/market?ref=abc", referrer: "https://www.reddit.com/r/Hololive" }, { ip: "203.0.113.200" })).status, 204);
    await page({ path: "/market" }, { ip: "203.0.113.200" });
    await page({ path: "/" }, { ip: "203.0.113.201" });
    await page({ path: "/" }, { ip: "203.0.113.202", ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    await page({ path: "/" }, { ip: "203.0.113.203", cookie: sharer });
    await page({ path: "not a path" }, { ip: "203.0.113.204" });
    const { rows } = await pool.query(`SELECT * FROM market.site_visits ORDER BY path`);
    assert.deepEqual(
      rows.map((row) => [row.path, row.referrer_host, row.views]),
      [
        ["/", null, 1],
        ["/market", "reddit.com", 2],
      ]
    );
    assert.deepEqual(Object.keys(rows[0]).sort(), ["day", "path", "referrer_host", "views", "visitor_hash"]);
    assert.ok(!JSON.stringify(rows).includes("203.0.113"), "no addresses");
    // Old rows go after the retention limit.
    await pool.query(`INSERT INTO market.site_visits (day, visitor_hash, path) VALUES (current_date - 120, 'old', '/')`);
    assert.equal(await visits.pruneOldVisits(pool), 1);
  });

  await t.test("the admin numbers come from our own tables", async () => {
    const bossId = await addUser("Boss", { isAdmin: true });
    const boss = await cookieFor(bossId);
    const today = visits.dayKey();
    assert.equal((await call("GET", `/api/admin/player-analytics?from=${today}&to=${today}`, { cookie: sharer })).status, 403);
    assert.equal((await call("GET", `/api/admin/player-analytics?from=nope&to=${today}`, { cookie: boss })).status, 400);
    const res = await call("GET", `/api/admin/player-analytics?from=${today}&to=${today}`, { cookie: boss });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body;
    assert.equal(data.totals.signups, signups, "sign-ups through the form (the other accounts are older)");
    assert.equal(data.totals.referred, signups - 2, "all but Tagged and Junk came through the link");
    assert.equal(data.totals.tagged, 2);
    assert.equal(data.totals.neither, 1, "Junk: no referral and no tag (Friend has both, Tagged has a tag)");
    assert.equal(data.totals.first_fills, 8);
    assert.equal(data.totals.visitors, 2);
    assert.equal(data.totals.pageviews, 3);
    assert.ok(data.totals.active >= 2, "players seen today, from their sessions");
    assert.equal(data.series.length, 1);
    assert.equal(data.series[0].signups, signups);
    assert.deepEqual(
      data.sources.tags.map((row) => [row.label, row.signups]),
      [["v1-email", 2]]
    );
    const vias = new Map(data.sources.referrals.map((row) => [row.label, row]));
    assert.equal(vias.get("blackjack").signups, 1);
    assert.equal(vias.get("link").signups, signups - 3);
    assert.equal(data.referrals.top[0].username, "Sharer");
    assert.ok(data.referrals.reasons.some((row) => row.label === "shared_ip" && row.count === 3));
    assert.equal(data.referrals.paid_out.cash, (5 + 4 + 1) * 250, "5 new players paid, 4 Sharer shares, 1 Youngster share");
    const games = new Map(data.activity.games.map((row) => [row.key, row]));
    assert.equal(games.get("stock_fills").events, 8);
    assert.equal(data.activity.stocks[0].symbol, "PEK");
    assert.equal(data.retention.length, 1);
    assert.equal(data.retention[0].signups, signups);
    assert.deepEqual(data.visitors.referrers, [{ label: "reddit.com", count: 1 }]);
    assert.ok(!JSON.stringify(data).includes("example.test"), "no emails");
    // A longer range works too, and its previous period is the same length.
    const month = await call("GET", `/api/admin/player-analytics?from=2026-10-01&to=${today}`, { cookie: boss });
    assert.equal(month.status, 200);
    assert.equal(month.body.series.at(-1).at, today);
  });
});
