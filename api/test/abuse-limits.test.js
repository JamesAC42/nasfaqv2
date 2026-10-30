const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const express = require("express");
const { Pool } = require("pg");

const rateLimit = require("../src/rateLimit");
const socketLimits = require("../src/socketLimits");
const cspReports = require("../src/services/cspReports");

// Abuse limits for a public audience: the write budget and the tighter per-route rules, sign-in
// lockouts that only count wrong passwords, socket caps, CSP reports, the stronger password hash
// (and the rehash on sign-in), and signing out everywhere / changing the password. The database
// parts run on a freshly migrated database of their own from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
// Optional: a real Redis to run the socket cap against too (use a spare db, e.g. redis://127.0.0.1:6379/15).
const redisUrl = process.env.TEST_REDIS_URL;

// Status codes for the errors these routes leave to server.js's handler, as it answers them.
function answerError(error, res) {
  const code = error?.code;
  if (code === "unauthenticated") return res.status(401).json({ error: code });
  if (code === "email_verification_required") return res.status(403).json({ error: code });
  return res.status(500).json({ error: String(error?.code || error?.message || error) });
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
  // As server.js has it.
  app.use("/api", rateLimit.writeLimit({ skip: [/^\/auth\/logout$/, /^\/articles\/[^/]+\/view$/, /^\/site\/csp-report$/] }));
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
  return async (method, path, { body, cookie, ip, type } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": type || "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(ip ? { "cf-connecting-ip": ip } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text, headers: res.headers, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
}

/** Sends `count` requests one after another; returns their statuses. */
async function statuses(count, send) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push((await send(i)).status);
  return out;
}

// ── No database ──────────────────────────────────────────────────────────────

test("counters: peek reads without counting, clear forgets, ids ignore case", async () => {
  const rule = { limit: 2, windowSeconds: 60 };
  const id = `Peko-${crypto.randomUUID()}`;
  assert.equal((await rateLimit.peek(null, "t", id, rule)).count, 0);
  assert.equal((await rateLimit.hit(null, "t", id, rule)).ok, true);
  assert.equal((await rateLimit.hit(null, "t", id.toUpperCase(), rule)).ok, true);
  assert.equal((await rateLimit.peek(null, "t", id.toLowerCase(), rule)).count, 2);
  const third = await rateLimit.hit(null, "t", id, rule);
  assert.equal(third.ok, false);
  assert.ok(third.retryAfter > 0 && third.retryAfter <= 60);
  await rateLimit.clear(null, "t", id, rule);
  assert.equal((await rateLimit.peek(null, "t", id, rule)).count, 0);
});

test("write budget: 60 signed-in writes a minute, then the usual 429; reads, signed-out and skipped paths don't count", async (t) => {
  let user = { id: 9_000_001 };
  const call = await serve(
    t,
    async () => ({ pool: null, redis: null, user }),
    (app) => {
      const ok = (_req, res) => res.json({ ok: true });
      app.post("/api/thing", ok);
      app.put("/api/thing", ok);
      app.delete("/api/thing", ok);
      app.get("/api/thing", ok);
      app.post("/api/auth/logout", ok);
      app.post("/api/articles/:slug/view", ok);
    }
  );
  const methods = ["POST", "PUT", "DELETE"];
  assert.deepEqual(new Set(await statuses(60, (i) => call(methods[i % 3], "/api/thing"))), new Set([200]));
  for (let i = 0; i < 5; i += 1) assert.equal((await call("GET", "/api/thing")).status, 200);
  assert.equal((await call("POST", "/api/auth/logout")).status, 200);
  assert.equal((await call("POST", "/api/articles/some-story/view")).status, 200);
  const limited = await call("PATCH", "/api/thing");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
  assert.ok(limited.body.retry_after >= 1 && limited.body.retry_after <= 60);
  assert.equal(limited.headers.get("retry-after"), String(limited.body.retry_after));
  // Someone else's budget is their own; signed out, writes have per-address rules instead.
  user = { id: 9_000_002 };
  assert.equal((await call("POST", "/api/thing")).status, 200);
  user = null;
  assert.deepEqual(new Set(await statuses(70, () => call("POST", "/api/thing"))), new Set([200]));
});

/** Just enough Redis for the socket cap: sorted sets with expiry, in a multi or alone. */
function fakeRedis() {
  const sets = new Map();
  const zset = (key) => {
    if (!sets.has(key)) sets.set(key, new Map());
    return sets.get(key);
  };
  const ops = {
    zRemRangeByScore: (key, min, max) => [...zset(key)].forEach(([value, score]) => score >= min && score <= max && zset(key).delete(value)),
    zAdd: (key, items) => [items].flat().forEach(({ score, value }) => zset(key).set(value, score)),
    zCard: (key) => zset(key).size,
    pExpire: () => 1,
    zRem: (key, value) => zset(key).delete(value),
  };
  return {
    sets,
    zRem: async (key, value) => ops.zRem(key, value),
    multi() {
      const queued = [];
      const chain = { exec: async () => queued.map((op) => op() ?? "OK") };
      for (const [name, fn] of Object.entries(ops)) chain[name] = (...args) => (queued.push(() => fn(...args)), chain);
      return chain;
    },
  };
}

async function exerciseConnectionCap(redis, keyPrefixIp) {
  // Two API processes sharing the count.
  const podA = socketLimits.createConnectionCap({ redis, limit: 3, processId: `a-${crypto.randomUUID()}` });
  const podB = socketLimits.createConnectionCap({ redis, limit: 3, processId: `b-${crypto.randomUUID()}` });
  try {
    const ip = `${keyPrefixIp}.1`;
    const first = await podA.admit(ip);
    const second = await podB.admit(ip);
    const third = await podA.admit(ip);
    assert.deepEqual([first.ok, second.ok, third.ok], [true, true, true]);
    assert.equal((await podB.admit(ip)).ok, false, "the fourth, on either pod, is over the cap");
    assert.equal((await podA.admit(ip)).ok, false);
    assert.equal((await podA.admit(`${keyPrefixIp}.2`)).ok, true, "another address has its own");
    second.release();
    second.release(); // twice is once
    const again = await podA.admit(ip);
    assert.equal(again.ok, true, "a closed socket gives its slot back");
    assert.equal((await podB.admit(ip)).ok, false);
    await podA.refresh();
    return { podA, podB, ip };
  } finally {
    podA.stop();
    podB.stop();
  }
}

test("socket cap: so many open sockets per address, counted across processes", async () => {
  const redis = fakeRedis();
  await exerciseConnectionCap(redis, "203.0.113");
  // A pod that died without closing its sockets stops counting once nobody vouches for them.
  const key = "ws:ip:203.0.113.1";
  for (const value of redis.sets.get(key).keys()) redis.sets.get(key).set(value, Date.now() - 120_000);
  const fresh = socketLimits.createConnectionCap({ redis, limit: 3 });
  try {
    assert.equal((await fresh.admit("203.0.113.1")).ok, true);
    assert.equal(redis.sets.get(key).size, 1);
  } finally {
    fresh.stop();
  }
});

test("socket cap: with Redis down it counts this process only, and never refuses everyone", async () => {
  const broken = { multi: () => ({ zRemRangeByScore() { return this; }, zAdd() { return this; }, zCard() { return this; }, pExpire() { return this; }, exec: async () => { throw new Error("ECONNREFUSED"); } }) };
  const warnings = [];
  const cap = socketLimits.createConnectionCap({ redis: broken, limit: 2, logger: { warn: (...args) => warnings.push(args.join(" ")) } });
  try {
    const one = await cap.admit("198.51.100.9");
    const two = await cap.admit("198.51.100.9");
    assert.deepEqual([one.ok, two.ok, (await cap.admit("198.51.100.9")).ok], [true, true, false]);
    one.release();
    assert.equal((await cap.admit("198.51.100.9")).ok, true);
    assert.equal(warnings.length, 1, "says so once");
  } finally {
    cap.stop();
  }
  const local = socketLimits.createConnectionCap({ redis: null, limit: 1 });
  try {
    assert.equal((await local.admit("x")).ok, true);
    assert.equal((await local.admit("x")).ok, false);
  } finally {
    local.stop();
  }
});

test("socket cap against a real Redis", { skip: !redisUrl }, async (t) => {
  const { createRedis } = require("../src/redis");
  const redis = await createRedis(redisUrl);
  t.after(() => redis.quit());
  const prefix = `192.0.2.${crypto.randomInt(1, 200)}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await exerciseConnectionCap(redis, prefix);
    assert.ok((await redis.pTTL(`ws:ip:${prefix}.1`)) > 0, "the key expires on its own");
  } finally {
    await redis.del([`ws:ip:${prefix}.1`, `ws:ip:${prefix}.2`]);
  }
});

function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.closes = [];
  ws.close = (code, reason) => {
    ws.closes.push([code, reason]);
    ws.readyState = 2;
  };
  return ws;
}

test("socket messages: past the limit in the window the socket is closed with 1008, before its own handler runs", () => {
  let clock = 0;
  const ws = fakeSocket();
  socketLimits.limitMessages(ws, { limit: 3, windowMs: 1000, now: () => clock });
  const handled = [];
  ws.on("message", (n) => {
    if (ws.readyState !== 1) return;
    handled.push(n);
  });
  for (const n of [1, 2, 3]) ws.emit("message", n);
  clock = 1500; // a new window
  for (const n of [4, 5, 6, 7, 8]) ws.emit("message", n);
  assert.deepEqual(handled, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ws.closes, [[1008, "too many messages"]]);
});

test("online count: many connects in a burst become one broadcast", async () => {
  let sent = 0;
  const broadcast = socketLimits.coalesce(() => {
    sent += 1;
  }, 20);
  for (let i = 0; i < 500; i += 1) broadcast.schedule();
  assert.equal(sent, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent, 1);
  broadcast.schedule();
  broadcast.stop();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sent, 1, "stopped before it ran");
});

test("signing out everywhere closes that player's sockets on every server, nobody else's", () => {
  const mine = [fakeSocket(), fakeSocket()];
  const theirs = fakeSocket();
  const anonymous = fakeSocket();
  mine[0].socketUserId = 7;
  mine[1].socketUserId = 7;
  theirs.socketUserId = 8;
  anonymous.socketUserId = null;
  const servers = [{ clients: new Set([mine[0], theirs]) }, { clients: new Set([mine[1], anonymous]) }];
  assert.equal(socketLimits.closeUserSockets(servers, 7), 2);
  assert.deepEqual(mine.map((ws) => ws.closes), [[[4001, "signed out"]], [[4001, "signed out"]]]);
  assert.deepEqual([theirs.closes, anonymous.closes], [[], []]);
  assert.equal(socketLimits.closeUserSockets(servers, null), 0);
});

test("CSP reports: both formats boil down to directive and origin, counted per day", async () => {
  const legacy = {
    "csp-report": {
      "document-uri": "https://holo.nasfaq.biz/news/some-story?token=secret",
      "violated-directive": "img-src 'self'",
      "effective-directive": "img-src",
      "blocked-uri": "https://evil.example/pixel.gif?who=me",
      disposition: "report",
    },
  };
  const reportingApi = [
    { type: "csp-violation", url: "https://holo.nasfaq.biz/", body: { effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "enforce" } },
    { type: "deprecation", body: {} },
    { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
  ];
  assert.deepEqual(cspReports.parseReports(legacy), [{ directive: "img-src", blocked: "https://evil.example", disposition: "report" }]);
  assert.deepEqual(cspReports.parseReports(reportingApi), [
    { directive: "script-src-elem", blocked: "inline", disposition: "enforce" },
    { directive: "img-src", blocked: "data", disposition: "report" },
  ]);
  assert.deepEqual(cspReports.parseReports("nonsense"), []);
  assert.deepEqual(cspReports.parseReports(null), []);

  const counts = new Map();
  const redis = {
    multi() {
      const chain = {
        hIncrBy: (_key, field, by) => (counts.set(field, (counts.get(field) || 0) + by), chain),
        expire: () => chain,
        exec: async () => [],
      };
      return chain;
    },
  };
  const logs = [];
  const logger = { warn: (line) => logs.push(line) };
  await cspReports.recordReports(redis, legacy, { logger });
  await cspReports.recordReports(redis, legacy, { logger });
  assert.equal(counts.get("report img-src https://evil.example"), 2);
  assert.deepEqual(logs, ["csp would block: img-src https://evil.example"], "a pair is logged once");
  assert.ok(!JSON.stringify([...counts, ...logs]).includes("secret"), "no page URLs or query strings are kept");
});

test("CSP report route: takes the browser's content types, answers 204", async (t) => {
  const siteRoutes = require("../src/routes/site");
  const call = await serve(t, async () => ({ pool: null, redis: null, user: { id: 9_000_003 } }), (app) => app.use("/api/site", siteRoutes));
  const quiet = console.warn;
  console.warn = () => {};
  t.after(() => {
    console.warn = quiet;
  });
  const body = { "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://cdn.example/x.png" } };
  assert.equal((await call("POST", "/api/site/csp-report", { body, type: "application/csp-report" })).status, 204);
  assert.equal((await call("POST", "/api/site/csp-report", { body: [{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://cdn.example/y.png" } }], type: "application/reports+json" })).status, 204);
  // Out of the player's write budget (60 a minute): a page with many violations can't spend it.
  const ips = ["198.51.100.77", "198.51.100.78"];
  assert.deepEqual(new Set(await statuses(70, (i) => call("POST", "/api/site/csp-report", { body, type: "application/csp-report", ip: ips[i % 2] }))), new Set([204]));
});

// ── On a database of its own ─────────────────────────────────────────────────

test("abuse limits end to end", { skip: !databaseUrl, timeout: 240_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_abuse_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_abuse_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_abuse_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });

  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const articleDb = require("../src/articleDb");
  const authRoutes = require("../src/routes/auth");
  const articleRoutes = require("../src/routes/articles");
  const profileRoutes = require("../src/routes/profiles");
  const predictionRoutes = require("../src/routes/predictions");
  const gamesRoutes = require("../src/routes/games");
  const gameTableRoutes = require("../src/routes/gameTables");
  const marketRoutes = require("../src/routes/market");
  const notificationRoutes = require("../src/routes/notifications");
  const { router: chatRoutes } = require("../src/routes/chat");

  const quiet = [console.warn, console.log, console.info, console.error];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }
  // Sign-up logs its (unsent) verification link; failing handlers log their errors.
  console.warn = console.info = console.error = () => {};
  t.after(() => {
    [console.warn, console.log, console.info, console.error] = quiet;
  });

  const scryptAsync = require("node:util").promisify(crypto.scrypt);
  /** An account whose password was hashed the old way (N = 2^14), as every account made before. */
  const addLegacyUser = async (username, password, { verified = true } = {}) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = Buffer.from(await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 })).toString("hex");
    const email = `${username.toLowerCase()}@example.test`;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_normalized, email_verified, password_hash, password_salt, password_params_json, created_at)
       VALUES ($1, lower($1), $2, $2, $3, $4, $5, '{"N":16384,"r":8,"p":1}', now() - interval '30 days') RETURNING id`,
      [username, email, verified, hash, salt]
    );
    return Number(rows[0].id);
  };
  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const passwordRow = async (userId) => (await pool.query(`SELECT password_hash, password_salt, password_params_json FROM market.users WHERE id = $1`, [userId])).rows[0];

  const call = await serve(
    t,
    async (req) => ({ pool, redis: null, user: await auth.getAuthenticatedUser(pool, req) }),
    (app) => {
      app.use("/api/auth", authRoutes);
      app.use("/api/articles", articleRoutes);
      app.use("/api/profiles", profileRoutes);
      app.use("/api/prediction-markets", predictionRoutes);
      app.use("/api/games", gameTableRoutes);
      app.use("/api/games", gamesRoutes);
      app.use("/api/market", marketRoutes);
      app.use("/api/notifications", notificationRoutes);
      app.use("/api/chat", chatRoutes);
    }
  );
  let nextIp = 0;
  const freshIp = () => `198.51.100.${(nextIp += 1)}`;
  const login = (username, password, { ip = freshIp(), turnstile } = {}) =>
    call("POST", "/api/auth/login", { body: { username, password, ...(turnstile ? { turnstile_token: turnstile } : {}) }, ip });

  await t.test("password hashing: new accounts get N = 2^17, old ones are rehashed on their next sign-in", async () => {
    assert.deepEqual(auth.PASSWORD_PARAMS, { N: 131072, r: 8, p: 1 });
    const userId = await addLegacyUser("Oldtimer", "old password 1");
    const before = await passwordRow(userId);
    assert.equal(auth.needsRehash(before), true);

    // A wrong password changes nothing.
    assert.equal((await login("Oldtimer", "not the password")).status, 401);
    assert.deepEqual(await passwordRow(userId), before);

    const ok = await login("oldtimer", "old password 1");
    assert.equal(ok.status, 200);
    const after = await passwordRow(userId);
    assert.deepEqual(after.password_params_json, { N: 131072, r: 8, p: 1 });
    assert.notEqual(after.password_hash, before.password_hash);
    assert.notEqual(after.password_salt, before.password_salt);
    assert.equal(auth.needsRehash(after), false);
    const derived = Buffer.from(await scryptAsync("old password 1", after.password_salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })).toString("hex");
    assert.equal(after.password_hash, derived, "the new hash is the same password at the new cost");

    // Still the same password, now checked at the new cost, and not rehashed again.
    assert.equal((await login("Oldtimer", "old password 1")).status, 200);
    assert.deepEqual(await passwordRow(userId), after);
    assert.equal((await login("Oldtimer", "old password 2")).status, 401);

    // Sign-up hashes at the new cost straight away.
    const created = await auth.createUser(pool, { username: "Newcomer", email: "newcomer@example.test", password: "new password 1" });
    assert.deepEqual((await passwordRow(created.id)).password_params_json, { N: 131072, r: 8, p: 1 });
  });

  await t.test("sign-in: only wrong passwords count toward an account's lockout, and Turnstile gets through it", async () => {
    await addLegacyUser("Lockme", "the right one");
    // The owner signs in as often as they like.
    assert.deepEqual(new Set(await statuses(12, () => login("Lockme", "the right one"))), new Set([200]));

    // A stranger spams wrong passwords: ten count, then the name needs Turnstile.
    assert.deepEqual(new Set(await statuses(10, () => login("LOCKME", "wrong guess!"))), new Set([401]));
    const locked = await login("Lockme", "wrong guess!");
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error, "rate_limited");
    assert.ok(locked.body.retry_after > 0 && locked.body.retry_after <= 900);
    assert.equal((await login("Lockme", "the right one")).status, 429, "without Turnstile the right password waits too");

    // With Turnstile on, a sign-in that passed it goes through: the owner isn't locked out.
    const realFetch = globalThis.fetch;
    const siteverify = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://challenges.cloudflare.com/")) {
        siteverify.push(Object.fromEntries(init.body));
        const success = Object.fromEntries(init.body).response === "good-token";
        return { ok: true, json: async () => ({ success, hostname: "localhost" }) };
      }
      return realFetch(url, init);
    };
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    try {
      assert.equal((await login("Lockme", "the right one", { turnstile: "bad-token" })).status, 400);
      const owner = await login("Lockme", "the right one", { turnstile: "good-token", ip: "203.0.113.50" });
      assert.equal(owner.status, 200);
      assert.equal(siteverify.at(-1).remoteip, "203.0.113.50");
    } finally {
      delete process.env.TURNSTILE_SECRET_KEY;
      globalThis.fetch = realFetch;
    }
    // Signing in cleared the wrong guesses.
    assert.equal((await login("Lockme", "the right one")).status, 200);
  });

  await t.test("sign-in: every attempt from one address counts, 30 in 5 minutes", async () => {
    await addLegacyUser("Sharedwifi", "the right one");
    const ip = "203.0.113.99";
    const results = await statuses(31, (i) => (i % 2 ? login("Sharedwifi", "the right one", { ip }) : login(`nobody_${i}`, "wrong guess!", { ip })));
    assert.equal(results.filter((status) => status === 429).length, 1);
    assert.equal(results.at(-1), 429);
  });

  await t.test("change password: needs the current one, ends every other session, keeps this one", async () => {
    const userId = await addLegacyUser("Changer", "first password");
    const here = await cookieFor(userId);
    const elsewhere = await cookieFor(userId);
    await pool.query(
      `INSERT INTO market.user_password_reset_tokens (user_id, email, token_hash, expires_at) VALUES ($1, 'changer@example.test', 'outstanding', now() + interval '1 hour')`,
      [userId]
    );
    const change = (body, cookie = here) => call("POST", "/api/auth/change-password", { cookie, body });

    assert.equal((await call("POST", "/api/auth/change-password", { body: { current_password: "first password", new_password: "second password" } })).status, 401);
    assert.deepEqual((await change({ current_password: "not it", new_password: "second password" })).body, { error: "wrong_password" });
    assert.deepEqual((await change({ new_password: "second password" })).body, { error: "wrong_password" });
    assert.deepEqual((await change({ current_password: "first password", new_password: "short" })).body, { error: "invalid_password" });
    assert.equal((await call("GET", "/api/auth/me", { cookie: here })).status, 200, "a failed change ends nothing");

    const changed = await change({ current_password: "first password", new_password: "second password" });
    assert.equal(changed.status, 200);
    assert.match(changed.cookie, /^nasfaq_session=.+/);
    assert.equal((await call("GET", "/api/auth/me", { cookie: here })).status, 401);
    assert.equal((await call("GET", "/api/auth/me", { cookie: elsewhere })).status, 401);
    assert.equal((await call("GET", "/api/auth/me", { cookie: changed.cookie })).body.user.username, "Changer");
    assert.deepEqual((await passwordRow(userId)).password_params_json, { N: 131072, r: 8, p: 1 });
    assert.equal((await login("Changer", "first password")).status, 401);
    assert.equal((await login("Changer", "second password")).status, 200);
    const { rows } = await pool.query(`SELECT used_at FROM market.user_password_reset_tokens WHERE user_id = $1`, [userId]);
    assert.ok(rows.every((row) => row.used_at), "reset links still out stop working");

    // Five tries every 15 minutes, whatever came of them: four went above.
    const results = await statuses(2, () => change({ current_password: "not it", new_password: "third password" }, changed.cookie));
    assert.deepEqual(results, [400, 429]);
  });

  await t.test("sign out everywhere: every session ends, this browser gets a fresh one", async () => {
    const userId = await addLegacyUser("Everywhere", "a password");
    const phone = await cookieFor(userId);
    const laptop = await cookieFor(userId);
    assert.equal((await call("POST", "/api/auth/sign-out-everywhere", {})).status, 401);
    const out = await call("POST", "/api/auth/sign-out-everywhere", { cookie: laptop });
    assert.equal(out.status, 200);
    assert.equal((await call("GET", "/api/auth/me", { cookie: phone })).status, 401);
    assert.equal((await call("GET", "/api/auth/me", { cookie: laptop })).status, 401);
    assert.equal((await call("GET", "/api/auth/me", { cookie: out.cookie })).status, 200);
    const { rows } = await pool.query(`SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS live FROM market.user_sessions WHERE user_id = $1`, [userId]);
    assert.equal(rows[0].live, 1);
  });

  // Each limit gets a player of its own, so their budgets don't mix.
  let playerNo = 0;
  const player = async () => cookieFor(await addLegacyUser(`Player${(playerNo += 1)}`, "a password"));
  /** Sends `count` requests; asserts none is limited until the last one. */
  const limitIs = async (limit, send, label) => {
    const results = await statuses(limit + 1, send);
    assert.ok(!results.slice(0, limit).includes(429), `${label}: limited early (${results.join(",")})`);
    assert.equal(results.at(-1), 429, `${label}: not limited after ${limit}`);
  };

  await t.test("the write budget: 60 a minute across every route", async () => {
    const cookie = await player();
    await limitIs(60, () => call("POST", "/api/notifications/read", { cookie, body: { all: true } }), "notifications/read");
    // It's shared: any other write is over it too.
    assert.equal((await call("PUT", "/api/profiles/me", { cookie, body: {} })).status, 429);
    assert.equal((await call("POST", "/api/auth/logout", { cookie })).status, 200, "signing out never waits");
  });

  await t.test("tighter limits where it matters", async () => {
    const tradeCookie = await player();
    await limitIs(20, async () => call("POST", "/api/prediction-markets/no-such-market/trade", { cookie: tradeCookie, body: { outcome: "YES", side: "buy", amount: 1 } }), "prediction trades");
    // Limit orders and cancels share it.
    const ordersCookie = await player();
    let n = 0;
    await limitIs(
      20,
      () => ((n += 1) % 2 ? call("POST", "/api/prediction-markets/no-such-market/limit-orders", { cookie: ordersCookie, body: {} }) : call("DELETE", "/api/prediction-markets/no-such-market/limit-orders/1", { cookie: ordersCookie })),
      "limit orders"
    );
    const commenter = await player();
    await limitIs(10, () => call("POST", "/api/prediction-markets/no-such-market/comments", { cookie: commenter, body: { body: "hi" } }), "prediction comments");

    const puller = await player();
    n = 0;
    await limitIs(20, () => call("POST", (n += 1) % 2 ? "/api/games/cards/pull" : "/api/games/capsule-gacha/pull", { cookie: puller, body: { count: 1 } }), "pulls");
    const crafter = await player();
    await limitIs(30, () => call("POST", "/api/games/cards/craft", { cookie: crafter, body: { card_key: "nope" } }), "crafting");

    const seater = await player();
    await limitIs(12, () => call("POST", "/api/games/tables", { cookie: seater, body: { game: "no-such-game" } }), "opening tables");
    const mover = await player();
    await limitIs(40, () => call("POST", "/api/games/blackjack/no-such-table/action", { cookie: mover, body: { action: "hit" } }), "table moves");

    const voter = await player();
    const votes = ["/api/articles/x/like", "/api/articles/x/save", "/api/articles/x/comments/1/vote", "/api/articles/x/proposals/1/vote", "/api/market/assets/GUR/comments/1/vote"];
    n = 0;
    await limitIs(30, () => call("POST", votes[(n += 1) % votes.length], { cookie: voter, body: { value: 1 } }), "likes and votes");

    const reporter = await player();
    await limitIs(5, () => call("POST", "/api/chat/messages/1/report", { cookie: reporter, body: { reason: "spam" } }), "chat reports");

    const editor = await player();
    n = 0;
    await limitIs(20, () => call("PUT", (n += 1) % 2 ? "/api/profiles/me" : "/api/profiles/me/banner", { cookie: editor, body: { asset_id: null } }), "profile edits");
  });

  await t.test("article views: once per reader per article an hour, 20 a minute, and the article always loads", async () => {
    const authorId = await addLegacyUser("Author", "a password");
    const slugs = [];
    for (let i = 0; i < 22; i += 1) slugs.push((await articleDb.createArticle(pool, { title: `Story number ${i}`, content: "Body.", authorId, status: "published" })).slug);
    const views = async (slug) => Number((await pool.query(`SELECT views FROM content.articles WHERE slug = $1`, [slug])).rows[0].views);
    const reader = await player();

    for (let i = 0; i < 5; i += 1) {
      const res = await call("POST", `/api/articles/${slugs[0]}/view`, { cookie: reader, body: {} });
      assert.equal(res.status, 200);
      assert.equal(res.body.article.slug, slugs[0]);
    }
    assert.equal(await views(slugs[0]), 1, "a reader counts once");
    // Signed out, each address is a reader.
    await call("POST", `/api/articles/${slugs[0]}/view`, { ip: "203.0.113.200", body: {} });
    await call("POST", `/api/articles/${slugs[0]}/view`, { ip: "203.0.113.200", body: {} });
    await call("POST", `/api/articles/${slugs[0]}/view`, { ip: "203.0.113.201", body: {} });
    assert.equal(await views(slugs[0]), 3);

    // Twenty a minute: the rest load, uncounted. (The first story already used five of them.)
    for (const slug of slugs.slice(1)) assert.equal((await call("POST", `/api/articles/${slug}/view`, { cookie: reader, body: {} })).status, 200);
    const counted = (await Promise.all(slugs.slice(1).map(views))).filter((count) => count === 1).length;
    assert.equal(counted, 15);
  });
});
