const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const display = require("../src/services/displaySettings");

// Display settings (services/displaySettings.js, the /display endpoints in routes/settings.js):
// New York market time or the player's own. Needs CHAT_TEST_DATABASE_URL (a local server) and makes
// its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

async function freshDatabase(name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "a local test server only");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
    // A second run changes nothing and doesn't fail.
    await applySchema(pool);
  } finally {
    [console.log, console.warn] = log;
  }
  return pool;
}

async function addUser(pool, name, { admin = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, is_admin, password_hash, password_salt, password_params_json, suspended_at)
     VALUES ($1, lower($1), lower($1) || '@example.test', true, $2, 'x', 'x', '{}', NULL) RETURNING id`,
    [name, admin]
  );
  return Number(rows[0].id);
}

test("display settings", { skip: !databaseUrl, timeout: 60_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_display_settings_test");
  t.after(() => pool.end());

  await t.test("nothing picked reads as null; a pick holds and only for that player", async () => {
    const one = await addUser(pool, "One");
    const two = await addUser(pool, "Two");
    assert.deepEqual(await display.getDisplaySettings(pool, one), { time_zone: null });
    assert.deepEqual(await display.updateDisplaySettings(pool, one, { time_zone: "local" }), { time_zone: "local" });
    assert.deepEqual(await display.getDisplaySettings(pool, two), { time_zone: null }, "only the caller's");
    assert.deepEqual(await display.updateDisplaySettings(pool, one, { time_zone: "market" }), { time_zone: "market" });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM market.display_preferences WHERE user_id = $1`, [one]);
    assert.equal(rows[0].n, 1, "one row per player");

    for (const bad of [null, undefined, {}, [], "local", { time_zone: "Asia/Tokyo" }, { time_zone: "" }, { time_zone: null }, { time_zone: true }]) {
      await assert.rejects(display.updateDisplaySettings(pool, one, bad), (error) => error.status === 400 && error.code === "invalid_settings", JSON.stringify(bad));
    }
    await assert.rejects(display.updateDisplaySettings(pool, one, { colors: "loud" }), (error) => error.code === "unknown_setting");
    await assert.rejects(display.updateDisplaySettings(pool, one, { __proto__: { time_zone: "local" }, toString: "x" }), (error) => error.code === "unknown_setting");
    assert.deepEqual(await display.getDisplaySettings(pool, one), { time_zone: "market" }, "a refused change leaves it alone");
    await assert.rejects(pool.query(`UPDATE market.display_preferences SET time_zone = 'utc' WHERE user_id = $1`, [one]), /check/i, "the column takes only the two values");
  });

  await t.test("the endpoints: signed in, behind the flag", async () => {
    const express = require("express");
    const settingsRoutes = require("../src/routes/settings");
    const { blockSuspendedWrites } = require("../src/userContext");
    const staff = await addUser(pool, "Staff", { admin: true });
    const player = await addUser(pool, "Player");
    const benched = await addUser(pool, "Benched");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = Number(req.headers["x-test-user"]) || null;
      req.ctx = { pool, redis: null, user: id ? { id, is_admin: id === staff, email_verified: true, suspension: id === benched ? { reason: "test", until: null, permanent: true } : null } : null };
      next();
    });
    app.use(blockSuspendedWrites);
    app.use("/api/settings", settingsRoutes);
    const server = app.listen(0, "127.0.0.1");
    t.after(() => server.close());
    await new Promise((resolve) => server.once("listening", resolve));
    const call = async (method, path, userId, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings${path}`, {
        method,
        headers: { ...(userId ? { "x-test-user": String(userId) } : {}), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null), cache: response.headers.get("cache-control") };
    };

    let restore = features.override({ "timezone-setting": "off" });
    try {
      assert.equal((await call("GET", "/display", staff)).status, 404, "off for everyone");
    } finally {
      restore();
    }

    restore = features.override({ "timezone-setting": "staff" });
    try {
      assert.equal((await call("GET", "/display", player)).status, 404, "not staff");
      assert.equal((await call("PUT", "/display", player, { display: { time_zone: "local" } })).status, 404);
      assert.equal((await call("GET", "/display", null)).status, 404, "signed out");
      const staffRead = await call("GET", "/display", staff);
      assert.equal(staffRead.status, 200);
      assert.deepEqual(staffRead.body, { display: { time_zone: null } });
      assert.equal(staffRead.cache, "no-store");
    } finally {
      restore();
    }

    restore = features.override({ "timezone-setting": "on" });
    try {
      assert.equal((await call("GET", "/display", null)).status, 401);
      assert.equal((await call("PUT", "/display", null, { display: { time_zone: "local" } })).status, 401);
      const set = await call("PUT", "/display", player, { display: { time_zone: "local" } });
      assert.equal(set.status, 200);
      assert.deepEqual(set.body, { display: { time_zone: "local" } });
      assert.deepEqual((await call("GET", "/display", player)).body, { display: { time_zone: "local" } });
      assert.equal((await call("PUT", "/display", player, { display: { time_zone: "utc" } })).status, 400);
      assert.equal((await call("PUT", "/display", player, { display: { font: "big" } })).body.error, "unknown_setting");
      assert.equal((await call("PUT", "/display", player, {})).body.error, "invalid_settings");
      assert.deepEqual((await call("GET", "/display", staff)).body, { display: { time_zone: null } }, "only the caller's");
      // A suspended player can still pick how times show, but not much else.
      assert.equal((await call("PUT", "/display", benched, { display: { time_zone: "market" } })).status, 200);
      assert.equal((await call("PUT", "/displays", benched, {})).status, 403, "the allowance is for this path only");
    } finally {
      restore();
    }
  });
});
