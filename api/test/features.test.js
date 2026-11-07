const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const features = require("../src/features");
const featuresRoutes = require("../src/routes/features");
const livestreamsRoutes = require("../src/routes/livestreams");
const { sendCachedJson, invalidateCachedJson } = require("../src/responseCache");
const { createMarketFanout } = require("../src/marketFanout");

// Feature flags (src/features): how each state resolves for a visitor, a player and an admin, and
// that nobody without a flag gets what's behind it, from an endpoint, a shared cache or the socket.

/** Only this test's flags matter: every real flag on (nothing hidden), plus `changes`. */
const only = (changes) => features.override({ ...Object.fromEntries(features.list().map((flag) => [flag.key, "on"])), ...changes });

const anonymous = null;
const player = { id: 2, username: "pleb", is_admin: false, can_manage_assets: true };
const admin = { id: 1, username: "boss", is_admin: true };

/** An app with these routes and a switchable viewer; returns { get(path), as(user) }. */
async function serve(t, mount) {
  let user = null;
  const pool = { query: async () => ({ rows: [] }) };
  const app = express();
  app.use((req, _res, next) => {
    req.ctx = { pool, redis: null, user };
    next();
  });
  mount(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    as(next) {
      user = next;
      return this;
    },
    async get(pathname) {
      const response = await fetch(`${base}${pathname}`);
      const text = await response.text();
      return { status: response.status, cache: response.headers.get("cache-control"), text, body: text ? JSON.parse(text) : null };
    },
  };
}

test("every flag file is valid: a known state and a description", () => {
  const flags = features.list();
  assert.ok(flags.length >= 2);
  for (const flag of flags) {
    assert.ok(features.STATES.includes(flag.state), `${flag.key}: ${flag.state}`);
    assert.ok(flag.description.length > 10, `${flag.key} says what it hides`);
    assert.ok(Array.isArray(flag.fields));
  }
  assert.deepEqual(
    flags.map((flag) => flag.key).filter((key) => ["stream-calendar", "tick-reasons"].includes(key)),
    ["stream-calendar", "tick-reasons"]
  );
  assert.deepEqual(flags.find((flag) => flag.key === "tick-reasons").fields, ["reasons"]);
});

test("a bad flag file stops the API instead of guessing", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flags-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const attempt = (name, text) => {
    for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file));
    fs.writeFileSync(path.join(dir, name), text);
    return () => features.readFlags(dir);
  };
  assert.deepEqual([...attempt("my-flag.json", '{"state":"on","description":"A thing."}')().keys()], ["my-flag"]);
  assert.throws(attempt("My_Flag.json", '{"state":"on","description":"A thing."}'), /lowercase words/);
  assert.throws(attempt("my-flag.json", '{"state":"yes","description":"A thing."}'), /state/);
  assert.throws(attempt("my-flag.json", '{"state":"on"}'), /description/);
  assert.throws(attempt("my-flag.json", '{"state":"on","description":"A thing.","fields":"reasons"}'), /fields/);
  assert.throws(attempt("my-flag.json", "{ state: on }"), /my-flag/);
});

test("off is nobody, staff is admins only, on is everyone", (t) => {
  t.after(features.override({ "test-off": "off", "test-staff": "staff", "test-on": "on" }));
  const expected = {
    "test-off": [false, false, false],
    "test-staff": [false, false, true],
    "test-on": [true, true, true],
  };
  for (const [flag, [forAnonymous, forPlayer, forAdmin]] of Object.entries(expected)) {
    assert.equal(features.isEnabled(flag, anonymous), forAnonymous, `${flag}, signed out`);
    assert.equal(features.isEnabled(flag, player), forPlayer, `${flag}, a player (other roles don't count)`);
    assert.equal(features.isEnabled(flag, admin), forAdmin, `${flag}, an admin`);
    assert.equal(features.forViewer(anonymous)[flag], forAnonymous);
    assert.equal(features.forViewer(player)[flag], forPlayer);
    assert.equal(features.forViewer(admin)[flag], forAdmin);
  }
  assert.equal(features.audienceOf(anonymous), "everyone");
  assert.equal(features.audienceOf(player), "everyone");
  assert.equal(features.audienceOf(admin), "staff");
  // A typo, or a flag whose file was deleted too early, is off rather than an error.
  const error = console.error;
  console.error = () => {};
  t.after(() => (console.error = error));
  assert.equal(features.isEnabled("no-such-flag", admin), false);
});

test("GET /api/features: each viewer's flags, never cached for anyone else", async (t) => {
  t.after(features.override({ "tick-reasons": "staff", "stream-calendar": "off" }));
  const app = await serve(t, (express) => express.use("/api/features", featuresRoutes));
  for (const [user, expected] of [[anonymous, false], [player, false], [admin, true]]) {
    const response = await app.as(user).get("/api/features");
    assert.equal(response.status, 200);
    assert.equal(response.cache, "private, no-store");
    assert.equal(response.body.features["tick-reasons"], expected);
    assert.equal(response.body.features["stream-calendar"], false);
  }
});

test("a gated field is dropped at any depth for audiences without it", (t) => {
  t.after(only({ secret: { state: "staff", fields: ["secret_note"] } }));
  const payload = { items: [{ price: 1, secret_note: "hi", nested: { secret_note: "deep", keep: true } }], secret_note: "top" };
  assert.deepEqual(features.forAudience(payload, "everyone"), { items: [{ price: 1, nested: { keep: true } }] });
  assert.equal(features.forAudience(payload, "staff"), payload, "staff get it untouched");
  assert.equal(features.staffSeesMore(), true);
  assert.equal(features.cacheKey("market:assets", admin), "market:assets|staff");
  assert.equal(features.cacheKey("market:assets", player), "market:assets");
  const texts = features.audienceTexts({ type: "x", secret_note: "hi" });
  assert.equal(texts.everyone, '{"type":"x"}');
  assert.equal(texts.staff, '{"type":"x","secret_note":"hi"}');

  // Turned on, everyone shares one copy.
  const restore = features.override({ secret: "on" });
  try {
    assert.equal(features.forAudience(payload, "everyone"), payload);
    assert.equal(features.staffSeesMore(), false);
    assert.equal(features.cacheKey("market:assets", admin), "market:assets");
    const same = features.audienceTexts({ type: "x", secret_note: "hi" });
    assert.equal(same.everyone, same.staff);
  } finally {
    restore();
  }
});

test("a shared cache keeps a staff copy apart, whoever asks first", async (t) => {
  t.after(only({ secret: { state: "staff", fields: ["secret_note"] } }));
  let version = 1;
  let builds = 0;
  const app = await serve(t, (express) =>
    express.get("/board/:name", (req, res, next) =>
      sendCachedJson(req, res, `test:board:${req.params.name}`, {
        ttlSeconds: 60,
        memoMs: 60_000,
        features: true,
        load: async () => {
          builds += 1;
          return { version, rows: [{ symbol: "PEK", secret_note: "staff only" }] };
        },
      }).catch(next)
    )
  );

  // Staff first: the copy they warm is theirs alone.
  const staffFirst = await app.as(admin).get("/board/a");
  assert.equal(staffFirst.body.rows[0].secret_note, "staff only");
  assert.equal(staffFirst.cache, "private, no-cache");
  for (const user of [anonymous, player]) {
    const response = await app.as(user).get("/board/a");
    assert.ok(!response.text.includes("secret_note"), "a staff copy never reaches anyone else");
    assert.equal(response.cache, "private, no-cache");
  }

  // Everyone first: staff still get theirs.
  assert.ok(!(await app.as(anonymous).get("/board/b")).text.includes("secret_note"));
  assert.equal((await app.as(admin).get("/board/b")).body.rows[0].secret_note, "staff only");
  assert.ok(!(await app.as(player).get("/board/b")).text.includes("secret_note"));

  // Clearing a key clears every audience's copy.
  version = 2;
  const before = builds;
  await invalidateCachedJson(null, ["test:board:a"]);
  assert.equal((await app.as(admin).get("/board/a")).body.version, 2);
  assert.equal((await app.as(player).get("/board/a")).body.version, 2);
  assert.equal(builds, before + 2);

  // Turned on: one copy for everyone, and no longer private.
  const restore = features.override({ secret: "on" });
  try {
    const shared = await app.as(player).get("/board/c");
    assert.equal(shared.body.rows[0].secret_note, "staff only");
    assert.equal(shared.cache, "no-cache");
  } finally {
    restore();
  }
});

test("the stream calendar's endpoint is a 404 for anyone without the flag", async (t) => {
  const app = await serve(t, (express) => express.use("/api/livestreams", livestreamsRoutes));
  const cases = [
    ["staff", [404, 404, 200]],
    ["off", [404, 404, 404]],
    ["on", [200, 200, 200]],
  ];
  for (const [state, statuses] of cases) {
    const restore = only({ "stream-calendar": state });
    try {
      for (const [index, user] of [anonymous, player, admin].entries()) {
        const response = await app.as(user).get("/api/livestreams/calendar?days=7");
        assert.equal(response.status, statuses[index], `${state}, viewer ${index}`);
        if (response.status === 404) assert.deepEqual(response.body, { error: "not_found" });
        else assert.ok(Array.isArray(response.body.streams));
        // While it's staff-only the answer depends on who asks, so no proxy may keep either one.
        if (state === "staff") assert.match(response.cache ?? "", /private/);
        if (state === "on") assert.equal(response.cache, "no-cache");
      }
    } finally {
      restore();
    }
  }
});

test("the market socket sends staff-only fields to staff sockets only", (t) => {
  t.after(only({ secret: { state: "staff", fields: ["secret_note"] } }));
  const sent = new Map();
  const socket = (name, props) => ({ name, ...props });
  const sockets = [
    socket("player, bundles", { marketBundles: true }),
    socket("player, one by one", {}),
    socket("staff, bundles", { marketBundles: true, marketStaff: true }),
    socket("staff, one by one", { marketStaff: true }),
  ];
  const fanout = createMarketFanout({
    clients: () => sockets,
    send: (client, text) => sent.set(client.name, [...(sent.get(client.name) ?? []), text]),
    bundleMs: 60_000,
  });
  const tick = features.audienceTexts({ type: "market.adjustments_applied", adjustments: [{ symbol: "PEK", secret_note: "why" }] });
  fanout.queue(tick.everyone, tick.staff);
  fanout.queue('{"type":"market.fill"}');
  fanout.flush();
  for (const [name, texts] of sent) {
    const all = texts.join("\n");
    if (name.startsWith("staff")) assert.ok(all.includes("secret_note"), name);
    else assert.ok(!all.includes("secret_note"), name);
    assert.equal(texts.length, name.endsWith("bundles") ? 1 : 2, name);
    if (name.endsWith("bundles")) assert.equal(JSON.parse(texts[0]).events.length, 2);
  }
  assert.equal(sent.size, 4);
});

test("code only names flags that have a file", () => {
  const known = new Set(features.list().map((flag) => flag.key));
  const roots = [path.join(__dirname, "..", "src"), path.join(__dirname, "..", "..", "app-client", "app")];
  const uses = /\b(?:requireFeature|isEnabled|enabledFor|useFeature)\(\s*"([^"]+)"|\bfeature:\s*"([^"]+)"/g;
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(full);
      } else if (/\.(js|ts|tsx)$/.test(entry.name)) {
        for (const match of fs.readFileSync(full, "utf8").matchAll(uses)) found.push([path.relative(path.join(__dirname, "..", ".."), full), match[1] ?? match[2]]);
      }
    }
  };
  roots.forEach(walk);
  assert.ok(found.some(([, flag]) => flag === "stream-calendar"), "the scan sees the calendar's checks");
  for (const [file, flag] of found) assert.ok(known.has(flag), `${file} names "${flag}", which has no file in api/src/features`);
});
