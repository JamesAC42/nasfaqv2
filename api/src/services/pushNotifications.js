// Bell notifications as phone and browser pushes, for players who turned the notification's group on
// in Settings (notificationSettings.js; groups in notifications.js KIND_GROUPS). Behind the
// checkin-reminders flag, like the daily reminder: at "staff" only admins get them.
//
// Two halves, so nothing here runs inside a caller's transaction or slows notify() down:
//
// 1. Queue. notifications.publish(rows) hands every published batch to enqueue() a moment later. One
//    INSERT … SELECT reads the rows back from market.notifications by id, so a notification that
//    rolled back (or hasn't committed yet) queues nothing, and only players with the group on, a
//    device, and the flag get a market.push_queue row. One row per notification (UNIQUE), so
//    publishing a row twice still queues it once. notify() without { publish: false } publishes on a
//    timer that can beat its transaction's COMMIT; ids that weren't there yet are looked for again
//    after RETRY_MS.
//
// 2. Send. The scheduler pod works the queue every INTERVAL_MS. It claims whole (player, kind) groups
//    of pending rows in one UPDATE (claimed_at) before sending anything, so two workers never send the
//    same row and a crash after the claim loses that push rather than sending it twice. Several rows
//    for one player and kind become one push that sums them up (the Saturday review's dividend
//    notice plus a bailout, a run of achievements). Sends go SEND_CONCURRENCY at a time; a 404 or 410
//    deletes the device, as for the reminder. Rows wait HOLD_MS first so a burst is claimed together.
//
// Inert without the VAPID keys (webPush.js) or with the flag off: nothing is queued or sent.

const features = require("../features");
const notifications = require("./notifications");
const schedulerHealth = require("./schedulerHealth");
const webPush = require("./webPush");

const FLAG = "checkin-reminders";
const INTERVAL_MS = 5_000;
const HOLD_MS = 3_000;
const RETRY_MS = [10_000, 60_000];
const CLAIM_LIMIT = 200;
const SEND_CONCURRENCY = 16;
// One tick stops claiming after this long; the rest waits for the next tick.
const TICK_BUDGET_MS = 2 * 60_000;
// Pending rows older than this (push off, the worker down) are dropped: old news by then.
const STALE_PENDING = "6 hours";
// Claimed rows are kept this long (for the admin hub and a look after an incident), then deleted.
const KEEP_CLAIMED = "1 day";
const ENQUEUE_CHUNK = 1000;

/**
 * How each group's pushes travel. Market news can wait (low urgency) and a newer one of the same kind
 * replaces the older on the device (topic at the push service, tag on the device). Bets and chat go
 * at normal urgency and each one stands on its own.
 */
const DELIVERY = Object.freeze({
  market: { urgency: "low", ttlSeconds: 24 * 3600, replace: true },
  bets: { urgency: "normal", ttlSeconds: 12 * 3600, replace: false },
  social: { urgency: "normal", ttlSeconds: 6 * 3600, replace: false },
  exchange: { urgency: "normal", ttlSeconds: 6 * 3600, replace: false },
});

/** "3 new mentions": the title of a push that stands for several notifications of one kind. */
const PLURALS = Object.freeze({
  dividend: "dividend updates",
  buyback: "buyback updates",
  ipo: "IPO updates",
  achievement: "achievements",
  prediction_won: "bets won",
  prediction_lost: "bets lost",
  prediction_void: "bets voided",
  mention: "mentions",
  reply: "replies",
  friend_request: "friend requests",
  friend_accepted: "new friends",
  referral: "referral bonuses",
  proposal_approved: "approved proposals",
  exchange: "exchange updates",
  wishlist: "wishlist alerts",
});

const preferenceColumn = (group) => `push_${group}`;

/** Which audiences get bell pushes: the checkin-reminders flag alone (not daily-checkin). */
function audiences() {
  return { everyone: features.enabledFor(FLAG, "everyone"), staff: features.enabledFor(FLAG, "staff") };
}

/** Whether anything could be pushed right now: the keys are set and the flag is on for someone. */
function active() {
  if (!webPush.isConfigured()) return null;
  const who = audiences();
  return who.everyone || who.staff ? who : null;
}

// ── Queue ─────────────────────────────────────────────────────────────────

/**
 * Queues pushes for these published notification rows (only their ids and kinds are read). Returns
 * { queued, missing }: missing are ids not in the database (yet): rolled back, or still committing.
 */
async function enqueue(pool, rows) {
  const who = active();
  if (!who) return { queued: 0, missing: [] };
  const ids = [...new Set((rows || []).filter((row) => row && notifications.KIND_GROUPS[row.kind]).map((row) => Number(row.id)))].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return { queued: 0, missing: [] };
  const groups = Object.entries(notifications.KIND_GROUPS)
    .filter(([, group]) => group)
    .map(([kind, group]) => ({ kind, grp: group }));
  const wants = notifications.PUSH_GROUPS.map((group) => `(g.grp = '${group}' AND p.${preferenceColumn(group)})`).join(" OR ");
  let queued = 0;
  const missing = [];
  for (let start = 0; start < ids.length; start += ENQUEUE_CHUNK) {
    const chunk = ids.slice(start, start + ENQUEUE_CHUNK);
    const { rows: result } = await pool.query(
      `
      WITH visible AS (
        SELECT n.id, n.user_id, n.kind, n.title, n.body, n.href FROM market.notifications n WHERE n.id = ANY($1::bigint[])
      ), queued AS (
        INSERT INTO market.push_queue (notification_id, user_id, kind, push_group, title, body, href)
        SELECT v.id, v.user_id, v.kind, g.grp, v.title, v.body, v.href
        FROM visible v
        JOIN jsonb_to_recordset($2::jsonb) AS g(kind text, grp text) ON g.kind = v.kind
        JOIN market.notification_preferences p ON p.user_id = v.user_id
        JOIN market.users u ON u.id = v.user_id
        WHERE (${wants})
          AND ($3::boolean OR u.is_admin)
          AND EXISTS (SELECT 1 FROM market.push_subscriptions s WHERE s.user_id = v.user_id)
        ON CONFLICT (notification_id) DO NOTHING
        RETURNING 1
      )
      SELECT (SELECT COUNT(*)::int FROM queued) AS queued, COALESCE((SELECT array_agg(id) FROM visible), '{}') AS visible
    `,
      [chunk, JSON.stringify(groups), who.everyone]
    );
    queued += result[0].queued;
    const visible = new Set(result[0].visible.map(Number));
    for (const id of chunk) if (!visible.has(id)) missing.push(id);
  }
  return { queued, missing };
}

/**
 * The listener notifications.publish() calls: queues now, and looks again for rows that weren't
 * committed yet. Never throws; errors only reach the log.
 */
function enqueueLater(pool, rows, { retries = RETRY_MS, logger = console } = {}) {
  const attempt = async (batch, left) => {
    try {
      const { missing } = await enqueue(pool, batch);
      if (!missing.length || !left.length) return;
      const ids = new Set(missing);
      const timer = setTimeout(() => void attempt(batch.filter((row) => ids.has(Number(row.id))), left.slice(1)), left[0]);
      timer.unref?.();
    } catch (error) {
      logger.error?.("push queue failed", error?.code || error?.message || "error");
    }
  };
  return attempt(rows, retries);
}

/** Queues pushes from everything notifications.publish() sends out from now on (server.js, every pod). */
function usePool(pool, options = {}) {
  notifications.onPublish((rows) => enqueueLater(pool, rows, options));
}

// ── Send ──────────────────────────────────────────────────────────────────

/**
 * Claims pending rows: the oldest `limit` rows' (player, kind) pairs, with every pending row of
 * those pairs, so a burst goes out as one push. Rows another worker is claiming right now are
 * skipped (SKIP LOCKED, so two workers never wait on or deadlock over each other), and a row it
 * claimed already fails the claimed_at check. Either way each row is claimed once.
 */
async function claim(pool, { limit = CLAIM_LIMIT, holdMs = HOLD_MS } = {}) {
  const { rows } = await pool.query(
    `
    WITH head AS (
      SELECT user_id, kind FROM market.push_queue
      WHERE claimed_at IS NULL AND queued_at <= now() - make_interval(secs => $2::double precision / 1000)
      ORDER BY id
      LIMIT $1
    ), pairs AS (SELECT DISTINCT user_id, kind FROM head),
    picked AS (
      SELECT q.id FROM market.push_queue q
      JOIN pairs ON pairs.user_id = q.user_id AND pairs.kind = q.kind
      WHERE q.claimed_at IS NULL
      FOR UPDATE OF q SKIP LOCKED
    )
    UPDATE market.push_queue q SET claimed_at = now()
    FROM picked
    WHERE q.id = picked.id AND q.claimed_at IS NULL
    RETURNING q.id, q.notification_id, q.user_id, q.kind, q.push_group, q.title, q.body, q.href
  `,
    [limit, holdMs]
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), notification_id: Number(row.notification_id), user_id: Number(row.user_id) }));
}

const safeHref = (href) => (typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : null);

/** One push per player and kind: the notification itself, or a summary when there are several. */
function collapse(rows) {
  const byPair = new Map();
  for (const row of [...rows].sort((a, b) => (a.notification_id ?? a.id) - (b.notification_id ?? b.id))) {
    const key = `${row.user_id}:${row.kind}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(row);
  }
  return [...byPair.values()].map((group) => {
    const newest = group[group.length - 1];
    const delivery = DELIVERY[newest.push_group] || DELIVERY.social;
    const hrefs = new Set(group.map((row) => safeHref(row.href) || "/notifications"));
    const single = group.length === 1;
    const payload = {
      title: single ? newest.title : `${group.length} new ${PLURALS[newest.kind] || "notifications"}`,
      body: single ? newest.body : `${newest.title}, and ${group.length - 1} more.`,
      url: hrefs.size === 1 ? [...hrefs][0] : "/notifications",
    };
    if (delivery.replace) payload.tag = `nasfaq-${newest.kind}`;
    return {
      userId: newest.user_id,
      kind: newest.kind,
      group: newest.push_group,
      count: group.length,
      payload,
      options: { ttlSeconds: delivery.ttlSeconds, urgency: delivery.urgency, ...(delivery.replace ? { topic: newest.kind.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}) },
    };
  });
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

/**
 * Sends these collapsed pushes to each player's devices, if they still want the group and the flag
 * is still on for them. Deletes devices the push service says are gone.
 */
async function deliver(pool, messages, { send, who }) {
  const totals = { pushes: 0, delivered: 0, removed: 0, failed: 0, skipped: 0, failures: {} };
  if (!messages.length) return totals;
  const userIds = [...new Set(messages.map((message) => message.userId))];
  const { rows: devices } = await pool.query(
    `
    SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, u.is_admin,
           ${notifications.PUSH_GROUPS.map((group) => `COALESCE(p.${preferenceColumn(group)}, false) AS ${preferenceColumn(group)}`).join(", ")}
    FROM market.push_subscriptions s
    JOIN market.users u ON u.id = s.user_id
    LEFT JOIN market.notification_preferences p ON p.user_id = s.user_id
    WHERE s.user_id = ANY($1::bigint[])
    ORDER BY s.user_id, s.id
  `,
    [userIds]
  );
  const devicesOf = new Map();
  for (const device of devices) {
    const userId = Number(device.user_id);
    if (!devicesOf.has(userId)) devicesOf.set(userId, []);
    devicesOf.get(userId).push(device);
  }
  const jobs = [];
  for (const message of messages) {
    const mine = (devicesOf.get(message.userId) || []).filter((device) => device[preferenceColumn(message.group)] && (who.everyone || device.is_admin));
    if (!mine.length) {
      totals.skipped += 1;
      continue;
    }
    totals.pushes += 1;
    for (const device of mine) jobs.push({ device, message });
  }
  const gone = new Set();
  const succeeded = new Set();
  await eachLimited(jobs, SEND_CONCURRENCY, async ({ device, message }) => {
    if (gone.has(Number(device.id))) return;
    try {
      await send(device, message.payload, message.options);
      totals.delivered += 1;
      succeeded.add(Number(device.id));
    } catch (error) {
      if (webPush.isGone(error)) {
        if (!gone.has(Number(device.id))) totals.removed += 1;
        gone.add(Number(device.id));
        return;
      }
      totals.failed += 1;
      // Only the status code: the error can't carry the endpoint here (webPush.send strips it).
      const key = String(error?.statusCode || error?.code || "error");
      totals.failures[key] = (totals.failures[key] || 0) + 1;
    }
  });
  if (gone.size) await pool.query(`DELETE FROM market.push_subscriptions WHERE id = ANY($1::bigint[])`, [[...gone]]);
  const ok = [...succeeded].filter((id) => !gone.has(id));
  if (ok.length) await pool.query(`UPDATE market.push_subscriptions SET last_success_at = now() WHERE id = ANY($1::bigint[])`, [ok]);
  return totals;
}

/** Deletes claimed rows past KEEP_CLAIMED and pending rows past STALE_PENDING. */
async function prune(pool) {
  const { rowCount: claimed } = await pool.query(`DELETE FROM market.push_queue WHERE claimed_at IS NOT NULL AND claimed_at < now() - $1::interval`, [KEEP_CLAIMED]);
  const { rowCount: stale } = await pool.query(`DELETE FROM market.push_queue WHERE claimed_at IS NULL AND queued_at < now() - $1::interval`, [STALE_PENDING]);
  return { claimed, stale };
}

/**
 * Works the queue until it's empty (or TICK_BUDGET_MS has gone by). Safe to run on several pods at
 * once: each row is claimed by one of them. `send` and `holdMs` are for tests.
 */
async function runPushQueue(pool, { send = webPush.send, holdMs = HOLD_MS, limit = CLAIM_LIMIT, budgetMs = TICK_BUDGET_MS } = {}) {
  if (!webPush.isConfigured()) return { skipped: "push_off" };
  const who = audiences();
  const result = { claimed: 0, pushes: 0, delivered: 0, removed: 0, failed: 0, skipped: 0, failures: {} };
  const started = Date.now();
  for (;;) {
    const rows = await claim(pool, { limit, holdMs });
    if (!rows.length) break;
    result.claimed += rows.length;
    // With the flag off for everyone the claimed rows are just dropped.
    const totals = who.everyone || who.staff ? await deliver(pool, collapse(rows), { send, who }) : { pushes: 0, delivered: 0, removed: 0, failed: 0, skipped: rows.length, failures: {} };
    for (const key of ["pushes", "delivered", "removed", "failed", "skipped"]) result[key] += totals[key];
    for (const [key, count] of Object.entries(totals.failures)) result.failures[key] = (result.failures[key] || 0) + count;
    if (Date.now() - started > budgetMs) break;
  }
  return result;
}

/**
 * Every INTERVAL_MS on the scheduler pod: works the push queue. Off (and reporting Off) without the
 * VAPID keys or with PUSH_NOTIFICATIONS_ENABLED=false.
 */
function startPushQueueScheduler(pool, logger = console, redis = null, { intervalMs = INTERVAL_MS, firstTickMs = 15_000 } = {}) {
  const enabled = webPush.isConfigured() && (process.env.PUSH_NOTIFICATIONS_ENABLED || "true").toLowerCase() !== "false";
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "push-queue", { enabled, intervalMs }, logger);
  if (!enabled) return () => heartbeat.stop();
  let running = false;
  let ticks = 0;
  async function tick() {
    if (running) return;
    running = true;
    heartbeat.update("running");
    try {
      const result = await runPushQueue(pool);
      if (result.claimed) {
        const failures = Object.entries(result.failures || {}).map(([key, count]) => `${key}×${count}`).join(" ");
        logger.log?.(`push queue: ${result.claimed} notifications, ${result.pushes} pushes, ${result.delivered} delivered, ${result.removed} gone, ${result.failed} failed${failures ? ` (${failures})` : ""}`);
      }
      // Pruning every minute or so is plenty.
      ticks += 1;
      if (ticks % 12 === 1) await prune(pool);
      heartbeat.update("idle");
    } catch (error) {
      heartbeat.update("error", error);
      logger.error?.("push queue failed", error?.code || error?.message || "error");
    } finally {
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

module.exports = {
  DELIVERY,
  FLAG,
  HOLD_MS,
  PLURALS,
  audiences,
  claim,
  collapse,
  deliver,
  enqueue,
  enqueueLater,
  preferenceColumn,
  prune,
  runPushQueue,
  startPushQueueScheduler,
  usePool,
};
