// The daily check-in reminder: once a New York day, at REMINDER_HOUR (18:00 ET by default, six hours
// before the check-in resets at midnight), every player who turned it on in Settings and hasn't checked
// in yet gets one push on each browser or phone they turned push on in, plus a row in the bell
// (notifications.js, kind "checkin") so it's there on the site too.
//
// Who gets one: checkin_reminder_push on (notificationSettings.js), at least one push subscription, a
// verified email (only those can check in), not suspended, no check-in today (checkins.js), and no
// reminder today. Behind the checkin-reminders flag, resolved per player like the daily-checkin flag:
// at "staff" only admins get one.
//
// Once a day, whatever happens: the scheduler pod runs it under an advisory lock, and each player's
// market.checkin_reminder_sends row for the day is written (ON CONFLICT DO NOTHING) before anything is
// sent, so a second pod, a restart or a retry never sends again. A crash between that row and the
// send costs the player that day's reminder rather than doubling it. If the pod was down at the hour,
// the next tick before midnight sends; after midnight the day is gone.
//
// Inert without the VAPID keys (webPush.js): the scheduler reports Off and sends nothing.

const features = require("../features");
const notifications = require("./notifications");
const schedulerHealth = require("./schedulerHealth");
const webPush = require("./webPush");
const { activeSuspensionSql } = require("./moderation");
const { TIME_ZONE } = require("./visits");

const FLAG = "checkin-reminders";
const LOCK_KEY = 9_204_140;
const INTERVAL_MS = 5 * 60_000;
const BATCH = 200;
const SEND_CONCURRENCY = 8;
const KEEP_DAYS = 35;
const HREF = "/#checkin";
const COPY = Object.freeze({
  title: "Your daily check-in is ready",
  body: "Free Credit is waiting on the home page. It resets at midnight ET.",
});

function reminderHour(env = process.env) {
  const raw = env.CHECKIN_REMINDER_HOUR;
  const hour = raw === undefined || raw === "" ? 18 : Number(raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 18;
}

/** Which audiences get a reminder: both flags on for them (checkin-reminders and daily-checkin). */
function audiences() {
  const on = (audience) => features.enabledFor(FLAG, audience) && features.enabledFor("daily-checkin", audience);
  return { everyone: on("everyone"), staff: on("staff") };
}

/** The New York day and hour at `now` (the database's clock unless a test sets it), and the reset. */
async function readClock(db, now = null) {
  const { rows } = await db.query(
    `SELECT local::date::text AS today, extract(hour FROM local)::int AS hour,
            ((local::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}') AS resets_at,
            COALESCE($1::timestamptz, now()) AS at
     FROM (SELECT COALESCE($1::timestamptz, now()) AT TIME ZONE '${TIME_ZONE}' AS local) AS clock`,
    [now]
  );
  return rows[0];
}

/**
 * Claims up to BATCH of today's recipients: writes their reminder rows and bell rows in one
 * transaction and returns the ids. Players already claimed today aren't returned again.
 */
async function claimBatch(pool, today, { everyone }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      INSERT INTO market.checkin_reminder_sends (user_id, day)
      SELECT u.id, $1::date
      FROM market.notification_preferences p
      JOIN market.users u ON u.id = p.user_id
      WHERE p.checkin_reminder_push
        AND u.email_verified
        AND NOT ${activeSuspensionSql("u")}
        AND ($2::boolean OR u.is_admin)
        AND EXISTS (SELECT 1 FROM market.push_subscriptions s WHERE s.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM market.daily_checkins c WHERE c.user_id = u.id AND c.checkin_day = $1::date)
        AND NOT EXISTS (SELECT 1 FROM market.checkin_reminder_sends r WHERE r.user_id = u.id AND r.day = $1::date)
      ORDER BY u.id
      LIMIT $3
      ON CONFLICT (user_id, day) DO NOTHING
      RETURNING user_id
    `,
      [today, everyone, BATCH]
    );
    const userIds = rows.map((row) => Number(row.user_id));
    const bell = await notifications.notifyMany(
      client,
      userIds.map((userId) => ({ userId, kind: "checkin", title: COPY.title, body: COPY.body, href: HREF, data: { day: today } }))
    );
    await client.query("COMMIT");
    notifications.publish(bell);
    if (userIds.length) await notifications.pruneInboxes(pool, userIds).catch(() => {});
    return userIds;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `work` over `items`, `limit` at a time. */
async function eachLimited(items, limit, work) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(runners);
}

/** Sends one reminder to each of these players' devices; deletes any the push service says are gone. */
async function deliver(pool, userIds, { today, ttlSeconds, send }) {
  const totals = { delivered: 0, removed: 0, failed: 0, failures: {} };
  if (!userIds.length) return totals;
  const { rows: devices } = await pool.query(
    `SELECT id, user_id, endpoint, p256dh, auth FROM market.push_subscriptions WHERE user_id = ANY($1::bigint[]) ORDER BY user_id, id`,
    [userIds]
  );
  const payload = { title: COPY.title, body: COPY.body, url: HREF, tag: "checkin-reminder", day: today };
  const deliveredTo = new Map();
  await eachLimited(devices, SEND_CONCURRENCY, async (device) => {
    try {
      await send(device, payload, { ttlSeconds, urgency: "normal", topic: "checkin" });
      totals.delivered += 1;
      deliveredTo.set(Number(device.user_id), (deliveredTo.get(Number(device.user_id)) || 0) + 1);
      await pool.query(`UPDATE market.push_subscriptions SET last_success_at = now() WHERE id = $1`, [device.id]);
    } catch (error) {
      if (webPush.isGone(error)) {
        totals.removed += 1;
        await pool.query(`DELETE FROM market.push_subscriptions WHERE id = $1`, [device.id]);
        return;
      }
      totals.failed += 1;
      // Only the status code: the error can't carry the endpoint here (webPush.send strips it).
      const key = String(error?.statusCode || error?.code || "error");
      totals.failures[key] = (totals.failures[key] || 0) + 1;
    }
  });
  if (deliveredTo.size) {
    await pool.query(
      `UPDATE market.checkin_reminder_sends r SET delivered = d.delivered
       FROM jsonb_to_recordset($2::jsonb) AS d(user_id bigint, delivered int)
       WHERE r.user_id = d.user_id AND r.day = $1::date`,
      [today, JSON.stringify([...deliveredTo].map(([userId, delivered]) => ({ user_id: userId, delivered })))]
    );
  }
  return totals;
}

/**
 * Today's reminders, if they're due and not sent yet. Safe to call as often as you like: it sends
 * each player at most one a day. `now` and `send` are for tests. Returns what it did, or
 * { skipped } with why it did nothing.
 */
async function sendCheckinReminders(pool, { now = null, send = webPush.send, hour = reminderHour() } = {}) {
  if (!webPush.isConfigured()) return { skipped: "push_off" };
  const who = audiences();
  if (!who.everyone && !who.staff) return { skipped: "flag_off" };
  const clock = await readClock(pool, now);
  if (clock.hour < hour) return { skipped: "not_yet", day: clock.today };
  const ttlSeconds = Math.max(60, Math.floor((new Date(clock.resets_at).getTime() - new Date(clock.at).getTime()) / 1000));
  const result = { day: clock.today, reminded: 0, delivered: 0, removed: 0, failed: 0, failures: {} };
  for (;;) {
    const userIds = await claimBatch(pool, clock.today, who);
    const totals = await deliver(pool, userIds, { today: clock.today, ttlSeconds, send });
    result.reminded += userIds.length;
    result.delivered += totals.delivered;
    result.removed += totals.removed;
    result.failed += totals.failed;
    for (const [key, count] of Object.entries(totals.failures)) result.failures[key] = (result.failures[key] || 0) + count;
    if (userIds.length < BATCH) break;
  }
  await pool.query(`DELETE FROM market.checkin_reminder_sends WHERE day < $1::date - $2::int`, [clock.today, KEEP_DAYS]);
  return result;
}

/**
 * Every INTERVAL_MS on the scheduler pod, under LOCK_KEY: sends today's reminders once they're due.
 * Off (and reporting Off) without the VAPID keys or with CHECKIN_REMINDERS_ENABLED=false.
 */
function startCheckinReminderScheduler(pool, logger = console, redis = null, { intervalMs = INTERVAL_MS, firstTickMs = 45_000 } = {}) {
  const enabled = webPush.isConfigured() && (process.env.CHECKIN_REMINDERS_ENABLED || "true").toLowerCase() !== "false";
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "checkin-reminders", { enabled, intervalMs }, logger);
  if (!enabled) return () => heartbeat.stop();
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    heartbeat.update("running");
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) {
        heartbeat.skip();
        return;
      }
      try {
        const result = await sendCheckinReminders(pool);
        if (result.reminded) {
          const failures = Object.entries(result.failures).map(([key, count]) => `${key}×${count}`).join(" ");
          logger.log?.(`checkin reminders ${result.day}: ${result.reminded} players, ${result.delivered} delivered, ${result.removed} gone, ${result.failed} failed${failures ? ` (${failures})` : ""}`);
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
      heartbeat.update("idle");
    } catch (error) {
      heartbeat.update("error", error);
      logger.error?.("checkin reminders failed", error?.code || error?.message || "error");
    } finally {
      client?.release();
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), firstTickMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    heartbeat.stop();
  };
}

module.exports = { COPY, FLAG, HREF, LOCK_KEY, audiences, readClock, reminderHour, sendCheckinReminders, startCheckinReminderScheduler };
