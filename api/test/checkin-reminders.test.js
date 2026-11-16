const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const webpushLib = require("web-push");
const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const webPush = require("../src/services/webPush");
const settings = require("../src/services/notificationSettings");
const reminders = require("../src/services/checkinReminders");

// The daily check-in reminder by push (services/checkinReminders.js), its settings
// (services/notificationSettings.js, routes/settings.js) and the push sender (services/webPush.js).
// The pure parts run anywhere; the rest needs CHAT_TEST_DATABASE_URL (a local server) and makes its
// own database. Keys are made fresh for each run and never leave the process.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const keys = webpushLib.generateVAPIDKeys();
const KEYED = { WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_SUBJECT: "mailto:owner@example.test" };
const b64 = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const subscription = (host = "fcm.googleapis.com") => ({ endpoint: `https://${host}/fcm/send/${b64(24)}`, keys: { p256dh: b64(65), auth: b64(16) } });

// ── Pure ──────────────────────────────────────────────────────────────────
test("push is off unless all three settings are there and well-formed; the startup line never shows a key", () => {
  assert.equal(webPush.readConfig({}).config, null);
  assert.equal(webPush.readConfig({}).reason, "unset");
  assert.equal(webPush.readConfig({ ...KEYED, WEB_PUSH_SUBJECT: "" }).reason, "unset");
  assert.equal(webPush.readConfig({ ...KEYED, WEB_PUSH_VAPID_PRIVATE_KEY: "short" }).reason, "invalid");
  assert.equal(webPush.readConfig({ ...KEYED, WEB_PUSH_SUBJECT: "not a url" }).reason, "invalid");
  assert.deepEqual(webPush.readConfig(KEYED).config, { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: KEYED.WEB_PUSH_SUBJECT });

  for (const env of [{}, KEYED, { ...KEYED, WEB_PUSH_VAPID_PRIVATE_KEY: "short" }]) {
    const restore = webPush.override(env);
    try {
      const line = webPush.startupLine();
      assert.match(line, /^web push: (on|off)/);
      assert.ok(!line.includes(keys.publicKey) && !line.includes(keys.privateKey), "no key in the line");
      assert.equal(webPush.isConfigured(), env === KEYED);
      assert.equal(webPush.publicKey(), env === KEYED ? keys.publicKey : null);
    } finally {
      restore();
    }
  }
});

test("subscriptions: only https endpoints at known push services", () => {
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) {
    assert.ok(webPush.cleanSubscription(subscription(host)), host);
  }
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://evil.test/push.apple.com",
    "https://127.0.0.1/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    `https://fcm.googleapis.com/${"x".repeat(3000)}`,
    "",
    null,
  ]) {
    assert.equal(webPush.allowedEndpoint(endpoint), false, String(endpoint).slice(0, 60));
  }
  const good = subscription();
  assert.equal(webPush.cleanSubscription({ ...good, keys: { ...good.keys, p256dh: "not base64!" } }), null);
  assert.equal(webPush.cleanSubscription({ ...good, keys: { p256dh: good.keys.p256dh } }), null);
  assert.deepEqual(webPush.cleanSubscription({ ...good, expirationTime: null, extra: 1 }), { endpoint: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth });
});

test("a failed send keeps only the status code, never the endpoint", async () => {
  const restore = webPush.override(KEYED);
  const original = webpushLib.sendNotification;
  const device = { endpoint: "https://fcm.googleapis.com/fcm/send/secret-endpoint", p256dh: b64(65), auth: b64(16) };
  let options = null;
  webpushLib.sendNotification = async (_sub, _body, opts) => {
    options = opts;
    throw new webpushLib.WebPushError("Received unexpected response code", 410, {}, "gone", device.endpoint);
  };
  try {
    const error = await webPush.send(device, { title: "t" }, { ttlSeconds: 120 }).then(() => null, (caught) => caught);
    assert.equal(error.statusCode, 410);
    assert.ok(webPush.isGone(error));
    assert.ok(!JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes("secret-endpoint"));
    assert.equal(options.TTL, 120);
    assert.equal(options.vapidDetails.publicKey, keys.publicKey);
  } finally {
    webpushLib.sendNotification = original;
    restore();
  }
  await assert.rejects(webPush.send(device, {}), { code: "push_unavailable" }, "off without keys");
});

test("device labels are coarse", () => {
  assert.equal(settings.deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(settings.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"), "Home Screen app on iPhone");
  assert.equal(settings.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"), "Firefox on Windows");
  assert.equal(settings.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge on Windows");
  assert.equal(settings.deviceLabel(""), "Browser");
});

test("the reminder hour: 18 ET unless set to another whole hour", () => {
  assert.equal(reminders.reminderHour({}), 18);
  assert.equal(reminders.reminderHour({ CHECKIN_REMINDER_HOUR: "12" }), 12);
  assert.equal(reminders.reminderHour({ CHECKIN_REMINDER_HOUR: "25" }), 18);
  assert.equal(reminders.reminderHour({ CHECKIN_REMINDER_HOUR: "7.5" }), 18);
});

test("without the keys the scheduler is inert: it sends nothing and starts no timer", async () => {
  const restore = webPush.override({});
  const restoreFlags = features.override({ "checkin-reminders": "on", "daily-checkin": "on" });
  try {
    let sent = 0;
    const pool = { query: () => assert.fail("no query"), connect: () => assert.fail("no connection") };
    assert.deepEqual(await reminders.sendCheckinReminders(pool, { send: async () => (sent += 1) }), { skipped: "push_off" });
    const stop = reminders.startCheckinReminderScheduler(pool, { log() {}, error() {} }, null, { intervalMs: 1, firstTickMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    assert.equal(sent, 0);
  } finally {
    restoreFlags();
    restore();
  }
});

// ── With a database ───────────────────────────────────────────────────────
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
  } finally {
    [console.log, console.warn] = log;
  }
  return pool;
}

async function addUser(pool, name, { verified = true, admin = false, suspended = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, is_admin, password_hash, password_salt, password_params_json, suspended_at)
     VALUES ($1, lower($1), lower($1) || '@example.test', $2, $3, 'x', 'x', '{}', CASE WHEN $4 THEN now() END) RETURNING id`,
    [name, verified, admin, suspended]
  );
  return Number(rows[0].id);
}

test("check-in reminders", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_push_test");
  t.after(() => pool.end());
  const restoreKeys = webPush.override(KEYED);
  t.after(restoreKeys);

  // A New York wall-clock time as an instant: at("2026-11-16", "18:05").
  const at = async (day, time) => (await pool.query(`SELECT ($1::date + $2::time) AT TIME ZONE 'America/New_York' AS at`, [day, time])).rows[0].at;
  const optIn = (userId) => settings.updatePreferences(pool, userId, { checkin_reminder_push: true });
  const device = async (userId, host) => (await settings.addDevice(pool, userId, subscription(host), { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36" })).device_id;
  const checkIn = (userId, day) => pool.query(`INSERT INTO market.daily_checkins (user_id, checkin_day, streak_days, reward) VALUES ($1, $2::date, 0, 50)`, [userId, day]);
  /** A fake push service: records each send; `answers` maps a device id to the status it fails with. */
  const pushService = (answers = new Map()) => {
    const calls = [];
    return {
      calls,
      send: async (row, payload, options) => {
        calls.push({ deviceId: Number(row.id), userId: Number(row.user_id), payload, options });
        const status = answers.get(Number(row.id));
        if (status) throw Object.assign(new Error(`push_failed_${status}`), { code: "push_failed", statusCode: status });
      },
    };
  };

  const ready = await addUser(pool, "Ready"); // opted in, not checked in: reminded
  const done = await addUser(pool, "Done"); // opted in, already checked in
  const quiet = await addUser(pool, "Quiet"); // has a device, never opted in
  const deviceless = await addUser(pool, "Deviceless"); // opted in, no device
  const unverified = await addUser(pool, "Unverified", { verified: false });
  const suspended = await addUser(pool, "Suspended", { suspended: true });
  const staff = await addUser(pool, "Staffer", { admin: true });
  for (const id of [ready, done, deviceless, unverified, suspended, staff]) await optIn(id);
  const readyGood = await device(ready);
  const readyGone = await device(ready, "web.push.apple.com");
  for (const id of [done, quiet, unverified, suspended, staff]) await device(id);
  await checkIn(done, "2026-11-16");

  await t.test("off by default", async () => {
    const fresh = await addUser(pool, "Fresh");
    assert.deepEqual((await settings.getSettings(pool, fresh)).preferences, { checkin_reminder_push: false });
    assert.deepEqual((await settings.getSettings(pool, quiet)).preferences, { checkin_reminder_push: false });
  });

  await t.test("before the hour nothing goes out", async () => {
    const restore = features.override({ "checkin-reminders": "on", "daily-checkin": "on" });
    try {
      const service = pushService();
      const result = await reminders.sendCheckinReminders(pool, { now: await at("2026-11-16", "17:59"), send: service.send, hour: 18 });
      assert.deepEqual(result, { skipped: "not_yet", day: "2026-11-16" });
      assert.equal(service.calls.length, 0);
    } finally {
      restore();
    }
  });

  await t.test("at the hour: opted-in players who haven't checked in, once a day; a 410 removes the device", async () => {
    const restore = features.override({ "checkin-reminders": "on", "daily-checkin": "on" });
    try {
      const service = pushService(new Map([[readyGone, 410]]));
      const now = await at("2026-11-16", "18:05");
      const result = await reminders.sendCheckinReminders(pool, { now, send: service.send, hour: 18 });
      assert.equal(result.day, "2026-11-16");
      assert.deepEqual([...new Set(service.calls.map((call) => call.userId))].sort((a, b) => a - b), [ready, staff].sort((a, b) => a - b));
      assert.deepEqual(service.calls.filter((call) => call.userId === ready).map((call) => call.deviceId).sort(), [readyGood, readyGone].sort());
      assert.deepEqual({ reminded: result.reminded, delivered: result.delivered, removed: result.removed, failed: result.failed }, { reminded: 2, delivered: 2, removed: 1, failed: 0 });

      const call = service.calls[0];
      assert.equal(call.payload.title, "Your daily check-in is ready");
      assert.equal(call.payload.url, "/#checkin");
      // Expires at the reset: 5 h 55 m after 18:05.
      assert.equal(call.options.ttlSeconds, (5 * 60 + 55) * 60);

      const { rows: left } = await pool.query(`SELECT id, last_success_at FROM market.push_subscriptions WHERE user_id = $1`, [ready]);
      assert.deepEqual(left.map((row) => Number(row.id)), [readyGood], "the 410 device is gone");
      assert.ok(left[0].last_success_at, "the good one is marked");
      const { rows: sends } = await pool.query(`SELECT user_id, delivered FROM market.checkin_reminder_sends WHERE day = '2026-11-16' ORDER BY user_id`);
      assert.deepEqual(sends.map((row) => [Number(row.user_id), row.delivered]), [[ready, 1], [staff, 1]].sort((a, b) => a[0] - b[0]));
      // The bell gets the same reminder.
      const { rows: bell } = await pool.query(`SELECT user_id, kind, title, href FROM market.notifications WHERE kind = 'checkin' ORDER BY user_id`);
      assert.deepEqual(bell.map((row) => Number(row.user_id)), [ready, staff].sort((a, b) => a - b));
      assert.equal(bell[0].href, "/#checkin");

      // Again the same day (another pod, a retry, a later tick): nothing.
      const again = pushService();
      const second = await reminders.sendCheckinReminders(pool, { now: await at("2026-11-16", "21:30"), send: again.send, hour: 18 });
      assert.equal(second.reminded, 0);
      assert.equal(again.calls.length, 0);
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.notifications WHERE kind = 'checkin'`)).rows[0].n, 2);

      // Racing runs at once still remind each player once.
      await pool.query(`DELETE FROM market.checkin_reminder_sends`);
      const racers = [pushService(), pushService()];
      await Promise.all(racers.map(async (racer) => reminders.sendCheckinReminders(pool, { now, send: racer.send, hour: 18 })));
      const userCalls = racers.flatMap((racer) => racer.calls.map((c) => c.userId));
      assert.deepEqual(userCalls.sort((a, b) => a - b), [ready, staff].sort((a, b) => a - b));

      // The next day: reminded again (and a 404 also removes the device).
      const next = pushService(new Map([[readyGood, 404]]));
      const tomorrow = await reminders.sendCheckinReminders(pool, { now: await at("2026-11-17", "18:00"), send: next.send, hour: 18 });
      assert.equal(tomorrow.day, "2026-11-17");
      assert.ok(next.calls.some((c) => c.userId === done), "Done hasn't checked in on the 17th");
      assert.equal(tomorrow.removed, 1);
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.push_subscriptions WHERE user_id = $1`, [ready])).rows[0].n, 0);
    } finally {
      restore();
    }
  });

  await t.test("at staff only admins are reminded; off, nobody", async () => {
    let restore = features.override({ "checkin-reminders": "staff", "daily-checkin": "on" });
    try {
      const service = pushService();
      await reminders.sendCheckinReminders(pool, { now: await at("2026-11-18", "19:00"), send: service.send, hour: 18 });
      assert.deepEqual([...new Set(service.calls.map((call) => call.userId))], [staff]);
    } finally {
      restore();
    }
    restore = features.override({ "checkin-reminders": "off", "daily-checkin": "on" });
    try {
      const service = pushService();
      assert.deepEqual(await reminders.sendCheckinReminders(pool, { now: await at("2026-11-19", "19:00"), send: service.send, hour: 18 }), { skipped: "flag_off" });
      assert.equal(service.calls.length, 0);
    } finally {
      restore();
    }
  });

  await t.test("without the keys nothing is sent and subscribing is refused", async () => {
    const restoreFlags = features.override({ "checkin-reminders": "on", "daily-checkin": "on" });
    const restore = webPush.override({});
    try {
      const service = pushService();
      assert.deepEqual(await reminders.sendCheckinReminders(pool, { now: await at("2026-11-20", "19:00"), send: service.send, hour: 18 }), { skipped: "push_off" });
      assert.equal(service.calls.length, 0);
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.checkin_reminder_sends WHERE day = '2026-11-20'`)).rows[0].n, 0);
      await assert.rejects(settings.addDevice(pool, ready, subscription()), { code: "push_unavailable" });
      assert.deepEqual((await settings.getSettings(pool, ready)).push, { available: false, public_key: null });
    } finally {
      restore();
      restoreFlags();
    }
  });

  await t.test("the endpoints: signed in, behind the flag, and only your own devices", async () => {
    const express = require("express");
    const settingsRoutes = require("../src/routes/settings");
    const owner = await addUser(pool, "Owner");
    const other = await addUser(pool, "Other");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = Number(req.headers["x-test-user"]) || null;
      req.ctx = { pool, redis: null, user: id ? { id, is_admin: id === staff, email_verified: true } : null };
      next();
    });
    app.use("/api/settings", settingsRoutes);
    const server = app.listen(0, "127.0.0.1");
    t.after(() => server.close());
    await new Promise((resolve) => server.once("listening", resolve));
    const call = async (method, path, userId, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings${path}`, {
        method,
        headers: { ...(userId ? { "x-test-user": String(userId) } : {}), "content-type": "application/json", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    let restore = features.override({ "checkin-reminders": "staff" });
    try {
      assert.equal((await call("GET", "/notifications", owner)).status, 404, "not staff");
      assert.equal((await call("GET", "/notifications", null)).status, 404, "signed out");
      assert.equal((await call("PUT", "/notifications", owner, { preferences: { checkin_reminder_push: true } })).status, 404);
      assert.equal((await call("GET", "/notifications", staff)).status, 200);
    } finally {
      restore();
    }

    restore = features.override({ "checkin-reminders": "on" });
    try {
      assert.equal((await call("GET", "/notifications", null)).status, 401);
      assert.equal((await call("PUT", "/notifications", null, { preferences: { checkin_reminder_push: true } })).status, 401);
      assert.equal((await call("POST", "/notifications/devices", null, { subscription: subscription() })).status, 401);

      const initial = await call("GET", "/notifications", owner);
      assert.equal(initial.status, 200);
      assert.deepEqual(initial.body.preferences, { checkin_reminder_push: false });
      assert.deepEqual(initial.body.push, { available: true, public_key: keys.publicKey });
      assert.deepEqual(initial.body.devices, []);

      const on = await call("PUT", "/notifications", owner, { preferences: { checkin_reminder_push: true } });
      assert.equal(on.status, 200);
      assert.equal(on.body.preferences.checkin_reminder_push, true);
      assert.equal((await call("PUT", "/notifications", owner, { preferences: { checkin_reminder_push: "yes" } })).status, 400);
      assert.equal((await call("PUT", "/notifications", owner, { preferences: { email_everything: true } })).body.error, "unknown_preference");
      assert.equal((await settings.getSettings(pool, other)).preferences.checkin_reminder_push, false, "only the caller's");

      assert.equal((await call("POST", "/notifications/devices", owner, { subscription: { endpoint: "https://evil.test/x", keys: subscription().keys } })).body.error, "invalid_subscription");
      const sub = subscription();
      const added = await call("POST", "/notifications/devices", owner, { subscription: sub });
      assert.equal(added.status, 200);
      assert.equal(added.body.devices.length, 1);
      assert.equal(added.body.devices[0].label, "Chrome on Android");
      assert.ok(!JSON.stringify(added.body).includes(sub.endpoint), "the endpoint never comes back");

      // Someone else's id does nothing; the owner's removes it.
      await call("DELETE", `/notifications/devices/${added.body.device_id}`, other);
      assert.equal((await settings.getSettings(pool, owner)).devices.length, 1);
      const removed = await call("DELETE", `/notifications/devices/${added.body.device_id}`, owner);
      assert.deepEqual(removed.body.devices, []);

      // This browser turning push off removes its own row by endpoint, and only the caller's.
      await call("POST", "/notifications/devices", owner, { subscription: sub });
      await call("POST", "/notifications/devices/remove", other, { endpoint: sub.endpoint });
      assert.equal((await settings.getSettings(pool, owner)).devices.length, 1);
      assert.deepEqual((await call("POST", "/notifications/devices/remove", owner, { endpoint: sub.endpoint })).body.devices, []);

      // The same browser subscribing for a second account moves to it.
      await call("POST", "/notifications/devices", owner, { subscription: sub });
      await call("POST", "/notifications/devices", other, { subscription: sub });
      assert.equal((await settings.getSettings(pool, owner)).devices.length, 0);
      assert.equal((await settings.getSettings(pool, other)).devices.length, 1);

      // Turning reminders off.
      assert.equal((await call("PUT", "/notifications", owner, { preferences: { checkin_reminder_push: false } })).body.preferences.checkin_reminder_push, false);
    } finally {
      restore();
    }
  });

  await t.test("the admin summary counts players and devices", async () => {
    const summary = await settings.pushSummary(pool);
    assert.equal(summary.configured, true);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS devices, COUNT(DISTINCT user_id)::int AS players FROM market.push_subscriptions`);
    assert.equal(summary.devices, rows[0].devices);
    assert.equal(summary.players, rows[0].players);
    assert.ok(Number.isInteger(summary.checkin_reminder_players));
  });
});
