const KEY_PREFIX = "nasfaq:ops:scheduler:";
const MINUTE = 60_000;
// Rows are republished every 15 s by the process running the loop. One older than this means that
// process is gone (a rollout's restart takes well under it).
const GONE_AFTER_MS = 3 * MINUTE;

// Every scheduler that reports a heartbeat, in the order the admin hub lists them. The watchdog
// (watchdog.js) calls one failing after `staleAfterMs` without a clean tick, and stalled once a tick
// has run `stallAfterMs` (default: 3 intervals, at least 2 minutes).
const SCHEDULERS = [
  // Settlement failures have alerts of their own (watchdog.js, marketScheduler.js); here the watchdog
  // only asks whether the loop is alive.
  { name: "settlement", label: "Settlement", staleAfterMs: 15 * MINUTE, stallAfterMs: 30 * MINUTE, alertOnErrors: false },
  { name: "adjustment", label: "Ticks", staleAfterMs: 10 * MINUTE },
  { name: "live-orders", label: "Live orders", staleAfterMs: 5 * MINUTE },
  // A failed evaluation retries every 15 minutes inside its 36-hour catch-up window: an hour of
  // failures still leaves most of the window to fix it in.
  { name: "weekly-evaluation", label: "Weekly eval", staleAfterMs: 60 * MINUTE, stallAfterMs: 30 * MINUTE },
  { name: "ipo", label: "IPO", staleAfterMs: 15 * MINUTE },
  { name: "predictions", label: "Predictions", staleAfterMs: 10 * MINUTE, stallAfterMs: 10 * MINUTE },
  { name: "exchange", label: "Exchange", staleAfterMs: 5 * MINUTE },
  { name: "wire", label: "Wire", staleAfterMs: 45 * MINUTE },
  // Reads 4chan, which goes down by itself now and then: only a long outage is worth a message.
  { name: "chatter", label: "Chatter", staleAfterMs: 180 * MINUTE, stallAfterMs: 30 * MINUTE },
  // Readers see the same history either way; a backlog only makes chat.messages bigger.
  { name: "chat-archive", label: "Chat archive", staleAfterMs: 120 * MINUTE },
  { name: "watchdog", label: "Watchdog", staleAfterMs: 10 * MINUTE },
];
const specFor = (name) => SCHEDULERS.find((spec) => spec.name === name) || null;
// A shared loop's last clean tick on any pod. The pods race for the loop's lock, and the web pods can
// win it every time for hours; the work still gets done, so their clean ticks count too.
const cleanKey = (name) => `${KEY_PREFIX}${name}:clean`;

/**
 * Whether this process speaks for the loops that run on every API pod under an advisory lock
 * (exchange, Wire, chatter): the scheduler pod, or a lone local process. Web and games pods run them
 * too, but their heartbeats would overwrite each other.
 */
function ownsSharedSchedulers() {
  if (process.env.SCHEDULER_STATUS_OWNER !== undefined) return process.env.SCHEDULER_STATUS_OWNER === "true";
  return (process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
}

function summarize(row, now = Date.now()) {
  if (!row) return { scheduler_enabled: false, scheduler_status: "unknown", scheduler_interval_ms: null, scheduler_last_seen_at: null };
  const fresh = Number.isFinite(Date.parse(row.last_seen_at)) && now - Date.parse(row.last_seen_at) < 90000;
  const stalled = row.state === "running" && now - Date.parse(row.tick_started_at) > (row.stall_after_ms || Math.max(120000, row.interval_ms * 3));
  const status = !fresh ? "stale" : !row.enabled ? "off" : row.state === "error" ? "error" : stalled ? "stalled" : "running";
  return { scheduler_enabled: fresh && Boolean(row.enabled), scheduler_status: status,
    scheduler_interval_ms: row.interval_ms, scheduler_last_seen_at: row.last_seen_at,
    scheduler_last_success_at: row.last_success_at || null, scheduler_error_code: row.error_code || null };
}

function age(ms) {
  const minutes = Math.round(ms / MINUTE);
  return minutes < 90 ? `${Math.max(1, minutes)}m` : `${Math.round(minutes / 60)}h`;
}

/**
 * What the watchdog makes of one heartbeat: null when it's fine (or turned off), else
 * { problem: "missing" | "gone" | "stalled" | "failing", detail }.
 */
function checkHeartbeat(spec, row, now = Date.now()) {
  if (!row) return { problem: "missing", detail: "has not reported in the last day" };
  if (!row.enabled) return null;
  const seen = Date.parse(row.last_seen_at);
  if (!(now - seen <= GONE_AFTER_MS)) return { problem: "gone", detail: `no heartbeat for ${age(now - seen)}` };
  if (row.state === "running") {
    const running = now - Date.parse(row.tick_started_at);
    const limit = spec.stallAfterMs || Math.max(2 * MINUTE, row.interval_ms * 3);
    return running > limit ? { problem: "stalled", detail: `one tick has been running for ${age(running)}` } : null;
  }
  if (spec.alertOnErrors === false) return null;
  const last = Date.parse(row.last_success_at || row.started_at);
  if (now - last > spec.staleAfterMs) {
    return { problem: "failing", detail: `no clean tick for ${age(now - last)}${row.error_code ? ` (last error: ${row.error_code})` : ""}` };
  }
  return null;
}

/**
 * Every registered heartbeat row (null where none), in SCHEDULERS order, with a shared loop's clean
 * tick on another pod as its last success when that's later. Throws when Redis does.
 */
async function readHeartbeats(redis) {
  const values = await redis.mGet([...SCHEDULERS.map((spec) => KEY_PREFIX + spec.name), ...SCHEDULERS.map((spec) => cleanKey(spec.name))]);
  return SCHEDULERS.map((spec, index) => {
    let row;
    try {
      row = JSON.parse(values[index] || "null");
    } catch {
      return null;
    }
    const elsewhere = values[SCHEDULERS.length + index];
    if (row && elsewhere && !(Date.parse(row.last_success_at) >= Date.parse(elsewhere))) row.last_success_at = elsewhere;
    return row;
  });
}

/** The admin hub's view: every scheduler with its status, last clean tick and the watchdog's verdict. */
async function listSchedulerHealth(redis, now = Date.now()) {
  let rows = SCHEDULERS.map(() => null);
  if (redis) rows = await readHeartbeats(redis).catch(() => rows);
  return SCHEDULERS.map((spec, index) => {
    const row = rows[index];
    const verdict = checkHeartbeat(spec, row, now);
    return {
      name: spec.name,
      label: spec.label,
      ...summarize(row, now),
      stale_after_ms: spec.staleAfterMs,
      problem: verdict?.problem || null,
      problem_detail: verdict?.detail || null,
      consecutive_failures: row?.consecutive_failures || 0,
      retry_at: row?.retry_at || null,
    };
  });
}

async function getSchedulerHealth(redis, name) {
  try { return summarize(JSON.parse(await redis?.get(KEY_PREFIX + name) || "null")); }
  catch { return summarize(null); }
}

/**
 * Publishes `name`'s heartbeat every 15 s while the loop runs. The loop calls update("running") as a
 * tick starts, update("idle") when it finishes clean (the last clean tick is what the watchdog
 * watches), update("error", error) when it fails, and skip() when another process held the lock.
 * `extra` fields ride along on the row (the settlement backoff). `shared` loops run on every pod;
 * only the scheduler pod reports them, and the other pods record just their clean ticks.
 */
function startSchedulerHeartbeat(redis, name, { enabled, intervalMs, shared = false }, logger = console) {
  // Disabled web/game replicas must never overwrite the actual scheduler's heartbeat.
  const reportsHere = shared ? ownsSharedSchedulers() : enabled || process.env.SCHEDULER_STATUS_OWNER === "true";
  if (redis && shared && !reportsHere) {
    return {
      update(state) {
        if (state !== "idle") return;
        Promise.resolve()
          .then(() => redis.set(cleanKey(name), new Date().toISOString(), { EX: 86400 }))
          .catch((error) => logger.error?.("scheduler heartbeat failed", name, error?.code || "redis_error"));
      },
      skip() {},
      stop() {},
    };
  }
  if (!redis || !reportsHere) return { update() {}, skip() {}, stop() {} };
  const row = { enabled, interval_ms: intervalMs, stall_after_ms: specFor(name)?.stallAfterMs || null, state: "idle",
    started_at: new Date().toISOString(), last_success_at: null, error_code: null };
  let publishing = false;
  async function publish() {
    if (publishing) return;
    publishing = true;
    try { await redis.set(KEY_PREFIX + name, JSON.stringify({ ...row, last_seen_at: new Date().toISOString() }), { EX: 86400 }); }
    catch (error) { logger.error?.("scheduler heartbeat failed", name, error?.code || "redis_error"); }
    finally { publishing = false; }
  }
  void publish();
  const timer = setInterval(() => { void publish(); }, 15000);
  timer.unref?.();
  return {
    update(state, error = null, extra = null) {
      row.state = state;
      if (state === "running") row.tick_started_at = new Date().toISOString();
      if (state === "idle") row.last_success_at = new Date().toISOString();
      // A tick starting keeps the last one's error until it ends one way or the other.
      if (state !== "running") row.error_code = error ? String(error.code || "scheduler_error") : null;
      if (extra) Object.assign(row, extra);
    },
    skip() {
      row.state = row.error_code ? "error" : "idle";
    },
    stop() { clearInterval(timer); },
  };
}

module.exports = {
  GONE_AFTER_MS,
  KEY_PREFIX,
  SCHEDULERS,
  checkHeartbeat,
  getSchedulerHealth,
  listSchedulerHealth,
  ownsSharedSchedulers,
  readHeartbeats,
  startSchedulerHeartbeat,
  summarize,
};
