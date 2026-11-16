const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const webpushLib = require("web-push");
const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const webPush = require("../src/services/webPush");
const notifications = require("../src/services/notifications");
const settings = require("../src/services/notificationSettings");
const push = require("../src/services/pushNotifications");

// Bell notifications as pushes, by group (services/pushNotifications.js), and their settings
// (services/notificationSettings.js, routes/settings.js). The pure parts run anywhere; the rest needs
// CHAT_TEST_DATABASE_URL (a local server) and makes its own database. Keys are made fresh for each run
// and never leave the process.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const keys = webpushLib.generateVAPIDKeys();
const KEYED = { WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_SUBJECT: "mailto:owner@example.test" };
const b64 = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const subscription = (host = "fcm.googleapis.com") => ({ endpoint: `https://${host}/fcm/send/${b64(24)}`, keys: { p256dh: b64(65), auth: b64(16) } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Pure ──────────────────────────────────────────────────────────────────
test("every notification kind is in exactly one push group; only the check-in reminder has its own", () => {
  assert.deepEqual([...notifications.KINDS].sort(), Object.keys(notifications.KIND_GROUPS).sort());
  for (const [kind, group] of Object.entries(notifications.KIND_GROUPS)) {
    if (kind === "checkin") {
      assert.equal(group, null, "the reminder pushes by itself (checkinReminders.js)");
      continue;
    }
    assert.ok(notifications.PUSH_GROUPS.includes(group), `${kind} → ${group}`);
    assert.ok(push.PLURALS[kind], `${kind} has a summary title`);
  }
  for (const group of notifications.PUSH_GROUPS) {
    assert.ok(push.DELIVERY[group], `${group} has a delivery policy`);
    assert.ok(settings.PREFERENCES[`push_${group}`], `${group} has a preference`);
    assert.equal(settings.PREFERENCES[`push_${group}`].default, false, "off until turned on");
  }
  // The groups the owner approved.
  const kindsOf = (group) => Object.entries(notifications.KIND_GROUPS).filter(([, g]) => g === group).map(([kind]) => kind);
  for (const kind of ["dividend", "buyback", "ipo"]) assert.ok(kindsOf("market").includes(kind));
  assert.deepEqual(kindsOf("bets").sort(), ["prediction_lost", "prediction_void", "prediction_won"]);
  for (const kind of ["mention", "reply", "friend_request", "friend_accepted"]) assert.ok(kindsOf("social").includes(kind));
  assert.deepEqual(kindsOf("exchange").sort(), ["exchange", "wishlist"]);
  assert.equal(notifications.KIND_GROUPS.dividend, "market");
});

test("a burst of one kind for one player becomes one push that sums it up", () => {
  const row = (id, userId, kind, extra = {}) => ({ id, user_id: userId, kind, push_group: notifications.KIND_GROUPS[kind], title: `t${id}`, body: `b${id}`, href: "/market/dividends", ...extra });
  const messages = push.collapse([row(3, 1, "dividend"), row(1, 1, "dividend"), row(2, 2, "mention", { href: "/chat?channel=general" }), row(4, 2, "mention", { href: "/chat?channel=vt" }), row(5, 2, "prediction_won", { href: "//evil.test" })]);
  assert.equal(messages.length, 3);
  const dividend = messages.find((m) => m.kind === "dividend");
  assert.equal(dividend.count, 2);
  assert.deepEqual(dividend.payload, { title: "2 new dividend updates", body: "t3, and 1 more.", url: "/market/dividends", tag: "nasfaq-dividend" });
  assert.deepEqual(dividend.options, { ttlSeconds: 24 * 3600, urgency: "low", topic: "dividend" });
  const mention = messages.find((m) => m.kind === "mention");
  assert.equal(mention.payload.url, "/notifications", "different pages: the bell's page");
  assert.equal(mention.payload.tag, undefined, "mentions don't replace each other");
  assert.equal(mention.options.urgency, "normal");
  assert.equal(mention.options.topic, undefined);
  const won = messages.find((m) => m.kind === "prediction_won");
  assert.deepEqual(won.payload, { title: "t5", body: "b5", url: "/notifications" }, "one row is sent as it is; a bad href goes to the bell");
  assert.equal(won.options.urgency, "normal");
});

test("without the keys or the flag nothing is queued, and no query runs", async () => {
  const pool = { query: () => assert.fail("no query") };
  const rows = [{ id: 1, user_id: 1, kind: "mention" }];
  let restore = webPush.override({});
  let restoreFlags = features.override({ "checkin-reminders": "on" });
  try {
    assert.deepEqual(await push.enqueue(pool, rows), { queued: 0, missing: [] });
    assert.deepEqual(await push.runPushQueue(pool), { skipped: "push_off" });
  } finally {
    restoreFlags();
    restore();
  }
  restore = webPush.override(KEYED);
  restoreFlags = features.override({ "checkin-reminders": "off" });
  try {
    assert.deepEqual(await push.enqueue(pool, rows), { queued: 0, missing: [] });
    // The reminder's own kind never queues here.
    restoreFlags();
    restoreFlags = features.override({ "checkin-reminders": "on" });
    assert.deepEqual(await push.enqueue(pool, [{ id: 1, user_id: 1, kind: "checkin" }]), { queued: 0, missing: [] });
  } finally {
    restoreFlags();
    restore();
  }
  const quiet = webPush.override({});
  try {
    const stop = push.startPushQueueScheduler(pool, { log() {}, error() {} }, null, { intervalMs: 1, firstTickMs: 1 });
    await sleep(20);
    stop();
  } finally {
    quiet();
  }
});

test("publish() hands its rows to the listener afterwards, and a failing listener can't hurt it", async () => {
  const seen = [];
  notifications.onPublish((rows) => {
    seen.push(rows.map((row) => row.id));
    throw new Error("listener broke");
  });
  try {
    notifications.publish([{ id: 7, user_id: 1, kind: "mention", title: "x" }, null]);
    assert.deepEqual(seen, [], "not while publish runs");
    await sleep(10);
    assert.deepEqual(seen, [[7]]);
    notifications.publish([]);
    await sleep(10);
    assert.equal(seen.length, 1, "nothing for an empty batch");
  } finally {
    notifications.onPublish(null);
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

async function addUser(pool, name, { admin = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, is_admin, password_hash, password_salt, password_params_json)
     VALUES ($1, lower($1), lower($1) || '@example.test', true, $2, 'x', 'x', '{}') RETURNING id`,
    [name, admin]
  );
  return Number(rows[0].id);
}

test("push notifications by group", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const name = "nasfaq_push_groups_test";
  const pool = await freshDatabase(name);
  t.after(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });
  const restoreKeys = webPush.override(KEYED);
  t.after(restoreKeys);

  const device = async (userId, host) => (await settings.addDevice(pool, userId, subscription(host))).device_id;
  /** A fake push service: records each send; `answers` maps a device id to the status it fails with. */
  const pushService = (answers = new Map(), delayMs = 0) => {
    const calls = [];
    return {
      calls,
      send: async (row, payload, options) => {
        calls.push({ deviceId: Number(row.id), userId: Number(row.user_id), payload, options });
        if (delayMs) await sleep(delayMs);
        const status = answers.get(Number(row.id));
        if (status) throw Object.assign(new Error(`push_failed_${status}`), { code: "push_failed", statusCode: status });
      },
    };
  };
  const queueRows = async () => (await pool.query(`SELECT notification_id, user_id, kind, push_group, claimed_at FROM market.push_queue ORDER BY id`)).rows;
  const clearQueue = () => pool.query(`DELETE FROM market.push_queue`);
  const bell = (items) => notifications.notifyMany(pool, items.map(([userId, kind, extra = {}]) => ({ userId, kind, title: `${kind} for ${userId}`, body: "b", href: "/notifications", ...extra })));

  const staff = await addUser(pool, "Staffer", { admin: true }); // Market and Social on, a device
  const player = await addUser(pool, "Player"); // Bets on, a device
  const deviceless = await addUser(pool, "Deviceless"); // everything on, no device
  const quiet = await addUser(pool, "Quiet"); // a device, nothing on
  await settings.updatePreferences(pool, staff, { push_market: true, push_social: true });
  await settings.updatePreferences(pool, player, { push_bets: true });
  await settings.updatePreferences(pool, deviceless, { push_market: true, push_bets: true, push_social: true, push_exchange: true, checkin_reminder_push: true });
  const staffDevice = await device(staff);
  const playerDevice = await device(player);
  const playerSecond = await device(player, "web.push.apple.com");
  await device(quiet);

  await t.test("the settings validate the group preferences", async () => {
    assert.deepEqual((await settings.getSettings(pool, quiet)).preferences, { checkin_reminder_push: false, push_market: false, push_bets: false, push_social: false, push_exchange: false });
    await assert.rejects(settings.updatePreferences(pool, quiet, { push_market: "yes" }), { code: "invalid_preferences" });
    await assert.rejects(settings.updatePreferences(pool, quiet, { push_everything: true }), { code: "unknown_preference" });
    await assert.rejects(settings.updatePreferences(pool, quiet, {}), { code: "invalid_preferences" });
    const both = await settings.updatePreferences(pool, quiet, { push_exchange: true, push_bets: false });
    assert.equal(both.preferences.push_exchange, true);
    assert.equal(both.preferences.push_market, false, "the rest stay off");
    assert.equal((await settings.updatePreferences(pool, quiet, { push_exchange: false })).preferences.push_exchange, false);

    // Through the endpoint.
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { pool, redis: null, user: { id: quiet, is_admin: false, email_verified: true } };
      next();
    });
    app.use("/api/settings", require("../src/routes/settings"));
    const server = app.listen(0, "127.0.0.1");
    t.after(() => server.close());
    await new Promise((resolve) => server.once("listening", resolve));
    const put = (preferences) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/settings/notifications`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferences }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      assert.equal((await put({ push_social: 1 })).status, 400);
      assert.equal((await put({ push_lottery: true })).body.error, "unknown_preference");
      const ok = await put({ push_social: true });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.preferences.push_social, true);
      assert.equal((await put({ push_social: false })).body.preferences.push_social, false);
    } finally {
      restore();
    }
  });

  await t.test("only opted-in players with a device, and only their groups' kinds, are queued", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      const rows = await bell([
        [staff, "dividend"],
        [staff, "mention"],
        [staff, "prediction_won"], // Bets is off for staff
        [player, "prediction_lost"],
        [player, "dividend"], // Market is off for player
        [player, "checkin"], // the reminder pushes by itself
        [deviceless, "dividend"],
        [quiet, "exchange"],
      ]);
      const result = await push.enqueue(pool, rows);
      assert.equal(result.queued, 3);
      assert.deepEqual(result.missing, []);
      const queued = (await queueRows()).map((row) => [Number(row.user_id), row.kind, row.push_group]);
      assert.deepEqual(queued.sort(), [[staff, "dividend", "market"], [staff, "mention", "social"], [player, "prediction_lost", "bets"]].sort());
      // Published twice: still queued once.
      assert.equal((await push.enqueue(pool, rows)).queued, 0);
      assert.equal((await queueRows()).length, 3);
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("at staff only admins are queued; off, nobody", async () => {
    let restore = features.override({ "checkin-reminders": "staff" });
    try {
      const rows = await bell([[staff, "dividend"], [player, "prediction_won"]]);
      assert.equal((await push.enqueue(pool, rows)).queued, 1);
      assert.deepEqual((await queueRows()).map((row) => Number(row.user_id)), [staff]);
    } finally {
      restore();
      await clearQueue();
    }
    restore = features.override({ "checkin-reminders": "off" });
    try {
      const rows = await bell([[staff, "dividend"], [player, "prediction_won"]]);
      assert.equal((await push.enqueue(pool, rows)).queued, 0);
      assert.equal((await queueRows()).length, 0);
    } finally {
      restore();
    }
    // Queued while it was on, then turned down to staff: the player's push isn't sent.
    restore = features.override({ "checkin-reminders": "on" });
    await push.enqueue(pool, await bell([[staff, "mention"], [player, "prediction_won"]]));
    restore();
    restore = features.override({ "checkin-reminders": "staff" });
    try {
      const service = pushService();
      const result = await push.runPushQueue(pool, { send: service.send, holdMs: 0 });
      assert.deepEqual([...new Set(service.calls.map((call) => call.userId))], [staff]);
      assert.equal(result.skipped, 1);
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("pushes are queued only after the commit, and a rolled-back notify sends nothing", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    const quietLog = { error() {} };
    try {
      // { publish: false } in a transaction: not there until COMMIT.
      const client = await pool.connect();
      let row;
      try {
        await client.query("BEGIN");
        row = await notifications.notify(client, player, { kind: "prediction_won", title: "You called it", href: "/predictions/x" }, { publish: false });
        const early = await push.enqueue(pool, [row]);
        assert.deepEqual(early, { queued: 0, missing: [Number(row.id)] }, "not visible before COMMIT");
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      assert.equal((await push.enqueue(pool, [row])).queued, 1);
      await clearQueue();

      // Rolled back: the listener looks again and still finds nothing.
      const rollback = await pool.connect();
      let gone;
      try {
        await rollback.query("BEGIN");
        gone = await notifications.notify(rollback, player, { kind: "prediction_lost", title: "Resolved" }, { publish: false });
        await rollback.query("ROLLBACK");
      } finally {
        rollback.release();
      }
      await push.enqueueLater(pool, [gone], { retries: [50], logger: quietLog });
      await sleep(150);
      assert.equal((await queueRows()).length, 0);

      // notify() without { publish: false } publishes on a 400 ms timer, which can beat its COMMIT
      // (the prediction resolvers do this): the listener looks again and queues it once it commits.
      push.usePool(pool, { retries: [300, 300, 300, 300, 300, 300, 300, 300, 300, 300], logger: quietLog });
      const waitForQueue = async (count) => {
        for (let i = 0; i < 50 && (await queueRows()).length < count; i += 1) await sleep(100);
        return queueRows();
      };
      try {
        const slow = await pool.connect();
        let late;
        try {
          await slow.query("BEGIN");
          late = await notifications.notify(slow, player, { kind: "prediction_void", title: "Voided", href: "/predictions/y" });
          await sleep(600); // the timer has fired and found nothing
          assert.equal((await queueRows()).length, 0);
          await slow.query("COMMIT");
        } finally {
          slow.release();
        }
        assert.deepEqual((await waitForQueue(1)).map((r) => Number(r.notification_id)), [Number(late.id)]);
        await clearQueue();

        // The same, rolled back: nothing, ever.
        const undone = await pool.connect();
        try {
          await undone.query("BEGIN");
          await notifications.notify(undone, player, { kind: "prediction_void", title: "Voided" });
          await sleep(500);
          await undone.query("ROLLBACK");
        } finally {
          undone.release();
        }
        await sleep(3500); // past every retry
        assert.equal((await queueRows()).length, 0);
      } finally {
        notifications.onPublish(null);
      }
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("two workers at once send each push once", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      const items = [];
      for (let i = 0; i < 30; i += 1) items.push([player, i % 3 === 0 ? "prediction_won" : i % 3 === 1 ? "prediction_lost" : "prediction_void", { title: `bet ${i}` }]);
      for (let i = 0; i < 20; i += 1) items.push([staff, "mention", { title: `mention ${i}` }]);
      // Notifications in separate batches, so each kind is several claims' worth when the limit is small.
      for (const item of items) await push.enqueue(pool, await bell([item]));
      assert.equal((await queueRows()).length, 50);
      const racers = [pushService(new Map(), 2), pushService(new Map(), 2)];
      const results = await Promise.all(racers.map((racer) => push.runPushQueue(pool, { send: racer.send, holdMs: 0, limit: 3 })));
      assert.equal(results[0].claimed + results[1].claimed, 50, "every row claimed once");
      const calls = racers.flatMap((racer) => racer.calls);
      // One push per player and kind (they were all pending together), to each of their devices.
      const perDevice = new Map();
      for (const call of calls) perDevice.set(`${call.deviceId}:${call.payload.title}`, (perDevice.get(`${call.deviceId}:${call.payload.title}`) || 0) + 1);
      assert.ok([...perDevice.values()].every((n) => n === 1), "no device got the same push twice");
      const summed = calls.filter((call) => call.userId === player).length + calls.filter((call) => call.userId === staff).length;
      assert.equal(summed, calls.length);
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.push_queue WHERE claimed_at IS NULL`)).rows[0].n, 0);
      // Nothing left: another run sends nothing.
      const after = pushService();
      assert.equal((await push.runPushQueue(pool, { send: after.send, holdMs: 0 })).claimed, 0);
      assert.equal(after.calls.length, 0);
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("the Saturday review's dividend notice and a bailout become one push", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      // One insert, as the review does it: the newest row leads the summary.
      const rows = await bell([[staff, "dividend", { title: "DIVS: $12.00", href: "/market/dividends" }], [staff, "dividend", { title: "Bailout: $50.00", href: "/market/dividends" }], [staff, "ipo", { title: "IPO open", href: "/market/ipo" }]]);
      const newest = rows.filter((row) => row.kind === "dividend").sort((a, b) => Number(b.id) - Number(a.id))[0];
      await push.enqueue(pool, rows);
      // Held back for a moment so a burst is claimed together.
      const early = pushService();
      assert.equal((await push.runPushQueue(pool, { send: early.send, holdMs: 60_000 })).claimed, 0);
      const service = pushService();
      const result = await push.runPushQueue(pool, { send: service.send, holdMs: 0 });
      assert.equal(result.claimed, 3);
      assert.equal(result.pushes, 2);
      const dividend = service.calls.find((call) => call.payload.tag === "nasfaq-dividend");
      assert.deepEqual(dividend.payload, { title: "2 new dividend updates", body: `${newest.title}, and 1 more.`, url: "/market/dividends", tag: "nasfaq-dividend" });
      assert.equal(dividend.options.urgency, "low");
      assert.equal(dividend.options.topic, "dividend");
      assert.equal(dividend.deviceId, staffDevice);
      const ipo = service.calls.find((call) => call.payload.tag === "nasfaq-ipo");
      assert.equal(ipo.payload.title, "IPO open");
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("a 404 or 410 removes the device; a group turned off before the send isn't sent", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      await push.enqueue(pool, await bell([[player, "prediction_won", { title: "Won" }]]));
      const service = pushService(new Map([[playerSecond, 410]]));
      const result = await push.runPushQueue(pool, { send: service.send, holdMs: 0 });
      assert.deepEqual(service.calls.map((call) => call.deviceId).sort(), [playerDevice, playerSecond].sort());
      assert.deepEqual({ delivered: result.delivered, removed: result.removed, failed: result.failed }, { delivered: 1, removed: 1, failed: 0 });
      const { rows: left } = await pool.query(`SELECT id, last_success_at FROM market.push_subscriptions WHERE user_id = $1`, [player]);
      assert.deepEqual(left.map((row) => Number(row.id)), [playerDevice]);
      assert.ok(left[0].last_success_at);

      await push.enqueue(pool, await bell([[player, "prediction_lost", { title: "Lost" }]]));
      const notFound = pushService(new Map([[playerDevice, 404]]));
      assert.equal((await push.runPushQueue(pool, { send: notFound.send, holdMs: 0 })).removed, 1);
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.push_subscriptions WHERE user_id = $1`, [player])).rows[0].n, 0);

      // A failure that isn't 404/410 keeps the device.
      const kept = await device(player);
      await push.enqueue(pool, await bell([[player, "prediction_void", { title: "Void" }]]));
      const flaky = pushService(new Map([[kept, 500]]));
      const failed = await push.runPushQueue(pool, { send: flaky.send, holdMs: 0 });
      assert.deepEqual(failed.failures, { 500: 1 });
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.push_subscriptions WHERE id = $1`, [kept])).rows[0].n, 1);

      // Queued, then the player turns Bets off: nothing goes out.
      await push.enqueue(pool, await bell([[player, "prediction_won", { title: "Won again" }]]));
      await settings.updatePreferences(pool, player, { push_bets: false });
      const off = pushService();
      const skipped = await push.runPushQueue(pool, { send: off.send, holdMs: 0 });
      assert.equal(off.calls.length, 0);
      assert.equal(skipped.skipped, 1);
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("a backlog older than six hours is never sent", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      await push.enqueue(pool, await bell([[staff, "mention", { title: "Old news" }]]));
      await pool.query(`UPDATE market.push_queue SET queued_at = now() - interval '7 hours'`);
      const service = pushService();
      assert.equal((await push.runPushQueue(pool, { send: service.send, holdMs: 0 })).claimed, 0);
      assert.equal(service.calls.length, 0);
      assert.deepEqual(await push.prune(pool), { claimed: 0, stale: 1 });
    } finally {
      restore();
      await clearQueue();
    }
  });

  await t.test("old rows are pruned, and the admin summary counts each group", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      await push.enqueue(pool, await bell([[staff, "mention"], [staff, "dividend"]]));
      await pool.query(`UPDATE market.push_queue SET claimed_at = now() - interval '2 days' WHERE kind = 'mention'`);
      await pool.query(`UPDATE market.push_queue SET queued_at = now() - interval '7 hours' WHERE kind = 'dividend'`);
      assert.deepEqual(await push.prune(pool), { claimed: 1, stale: 1 });
      assert.equal((await queueRows()).length, 0);
    } finally {
      restore();
    }
    const summary = await settings.pushSummary(pool);
    assert.equal(summary.configured, true);
    assert.equal(summary.group_players.market, 1, "staff; the player without a device doesn't count");
    assert.equal(summary.group_players.social, 1);
    assert.equal(summary.group_players.bets, 0);
    assert.ok(Number.isInteger(summary.checkin_reminder_players));
  });

  await t.test("deleting a player or their notification deletes their queued pushes", async () => {
    const restore = features.override({ "checkin-reminders": "on" });
    try {
      const leaving = await addUser(pool, "Leaving");
      await settings.updatePreferences(pool, leaving, { push_social: true });
      await device(leaving);
      const rows = await bell([[leaving, "mention"], [staff, "mention"]]);
      assert.equal((await push.enqueue(pool, rows)).queued, 2);
      await pool.query(`DELETE FROM market.users WHERE id = $1`, [leaving]);
      assert.deepEqual((await queueRows()).map((row) => Number(row.user_id)), [staff]);
      await pool.query(`DELETE FROM market.notifications WHERE user_id = $1`, [staff]);
      assert.equal((await queueRows()).length, 0);
    } finally {
      restore();
    }
  });
});
