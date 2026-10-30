// The watchdog: once a minute on the scheduler pod (an advisory-lock singleton like the other loops),
// it checks for what nobody would otherwise notice at 3am and tells the team (alerts.js, Discord):
//
//   - no completed settlement for the market day by 30 minutes after settlement time (09:30 ET);
//   - the last settlement cycle errored (market_runtime_state.last_cycle_error);
//   - the day's YouTube scrape (ytscraper, 00:05 ET) left listed talents without stats, even after
//     the scraper's first retry an hour later;
//   - a scheduler's heartbeat went quiet, stalled, or stopped finishing clean ticks (schedulerHealth.js);
//   - more than WATCHDOG_ERROR_THRESHOLD unhandled API errors in 5 minutes, across every pod (recordError).
//
// The other API pods keep a standby: when the scheduler pod's own watchdog stops beating (that pod
// is down), one of them runs the checks instead, which is also how that outage gets reported.
// Each check says firing (raise), clear (resolve) or nothing to say right now (null).

const alerts = require("./alerts");
const schedulerHealth = require("./schedulerHealth");
const { getCurrentDateKey, getQueryTimeZone, loadSchedulerConfig, shiftDateKey } = require("./marketScheduler");

const LOCK_KEY = 9_204_110;
const INTERVAL_MS = 60_000;
const SETTLEMENT_GRACE_MINUTES = 30;
// The scraper runs at SCRAPE_AT_LOCAL_HOUR/MIN (00:05 by default) and retries what's missing every
// SCRAPE_RETRY_MINUTES (60). The alert waits for the first retry plus this long to finish, so a
// blip the scraper fixes by itself doesn't page anyone.
const SCRAPE_GRACE_MINUTES = 15;
// Where ytscraper says how today's scrape went (ytscraper/cmd/ytscraper/retry.go).
const SCRAPER_STATUS_KEY = "nasfaq:ytscraper:daily_stats";
const ERROR_WINDOW_MINUTES = 5;
const ERROR_KEY_PREFIX = "nasfaq:ops:errors:";
const LAST_ERROR_KEY = "nasfaq:ops:errors:last";

const envInt = (name, fallback) => {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const errorThreshold = () => Math.max(1, envInt("WATCHDOG_ERROR_THRESHOLD", 20));

function minutesInZone(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const zoneName = (now, timeZone) =>
  new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value || timeZone;

// ── Unhandled errors ──────────────────────────────────────────────────────

const minuteOf = (ms) => Math.floor(ms / 60_000);

/**
 * Counts an unhandled error (the API's error handler, unhandledRejection) toward the watchdog's
 * 5-minute window, shared by every pod through Redis. Never throws; callers don't wait for it.
 */
async function recordError(redis, { source, error, method = null, path = null } = {}, { now = Date.now() } = {}) {
  if (!redis) return;
  try {
    const key = ERROR_KEY_PREFIX + minuteOf(now);
    if ((await redis.incr(key)) === 1) await redis.expire(key, (ERROR_WINDOW_MINUTES + 10) * 60);
    // Just enough to point at the bug: where, the error's code and first line. No bodies or query strings.
    const sample = {
      at: new Date(now).toISOString(),
      source,
      where: method ? `${method} ${String(path || "").split("?")[0].slice(0, 120)}` : null,
      code: error?.code ? String(error.code).slice(0, 80) : null,
      message: String(error?.message || error || "").split("\n")[0].slice(0, 200),
    };
    await redis.set(LAST_ERROR_KEY, JSON.stringify(sample), { EX: (ERROR_WINDOW_MINUTES + 10) * 60 });
  } catch {}
}

/** Errors that are the client's doing (a bad body, a refused origin) aren't bugs to count. */
function isServerFault(error) {
  const status = Number(error?.status || error?.statusCode);
  if (Number.isFinite(status) && status < 500) return false;
  return error?.code !== "cors_origin_not_allowed";
}

async function countRecentErrors(redis, now) {
  const minute = minuteOf(now);
  const keys = Array.from({ length: ERROR_WINDOW_MINUTES }, (_, index) => ERROR_KEY_PREFIX + (minute - index));
  const [counts, last] = await Promise.all([redis.mGet(keys), redis.get(LAST_ERROR_KEY)]);
  let sample = null;
  try {
    sample = JSON.parse(last || "null");
  } catch {}
  return { count: counts.reduce((sum, value) => sum + (Number(value) || 0), 0), sample };
}

// ── Checks ────────────────────────────────────────────────────────────────

/** Settlement done for the market day, and the last cycle's error. One read of the market state. */
async function checkMarket(pool, { now }) {
  const config = loadSchedulerConfig();
  const { rows } = await pool.query(`
    SELECT s.trading_status, s.last_cycle_error,
           (SELECT max(market_date)::text FROM market.market_settlement_runs WHERE status = 'completed') AS last_completed
    FROM (SELECT 1) one
    LEFT JOIN market.market_runtime_state s ON s.state_key = 'primary'
  `);
  const state = rows[0] || {};
  const checks = [];

  // Every day settles. Before today's deadline, yesterday's settlement is the one that must be in.
  const deadline = Math.min(24 * 60 - 1, config.hour * 60 + config.minute + SETTLEMENT_GRACE_MINUTES);
  const today = getCurrentDateKey(now, config.timeZone);
  const pastDeadline = minutesInZone(now, config.timeZone) >= deadline;
  const expected = pastDeadline ? today : shiftDateKey(today, -1);
  const settled = Boolean(state.last_completed) && state.last_completed >= expected;
  const missing = {
    key: "settlement-missing",
    title: `No settlement for ${expected}`,
    severity: "error",
  };
  if (state.trading_status === "manual_closed") {
    // Paused by hand: settlement waits for the reopen on purpose.
    checks.push({ ...missing, firing: settled ? false : null });
  } else if (settled) {
    checks.push({ ...missing, firing: false, message: `${state.last_completed} is settled.` });
  } else {
    checks.push({
      ...missing,
      firing: true,
      message:
        `There's no completed settlement for ${expected} and it's past ${clock(deadline)} ${zoneName(now, config.timeZone)}. ` +
        `Trading is ${state.trading_status || "open"} on the last settled day (${state.last_completed || "none yet"}).`,
      fields: state.last_cycle_error ? [{ name: "Last cycle error", value: state.last_cycle_error }] : [],
    });
  }

  // A cycle under way clears the error as it starts: wait for it to finish before calling it either way.
  // `confirm`: the error has to outlast the scheduler's next-minute retry (a blip) before it fires.
  const cycle = { key: "settlement-error", title: "Settlement cycle failed", severity: "error", confirm: true };
  if (state.trading_status === "settling") checks.push({ ...cycle, firing: null });
  else if (state.last_cycle_error) {
    checks.push({
      ...cycle,
      firing: true,
      message: "The last settlement cycle failed; trading reopened on the previous market state. The scheduler retries on its own.",
      fields: [{ name: "Error", value: state.last_cycle_error }],
    });
  } else checks.push({ ...cycle, firing: false, message: "The last settlement cycle went through." });

  return checks;
}

/** What ytscraper last said about `day`'s scrape, or null. */
async function readScraperStatus(redis, day) {
  if (!redis) return null;
  try {
    const status = JSON.parse((await redis.get(SCRAPER_STATUS_KEY)) || "null");
    return status && status.day === day ? status : null;
  } catch {
    return null;
  }
}

/** One line on what the scraper is doing about it, so nobody races it (or waits on it in vain). */
function scraperLine(status, timeZone) {
  if (!status) return "ytscraper hasn't reported on today's scrape: check that it's running and its logs.";
  const quota = status.quota_exceeded ? " The YouTube quota is used up; it resets at midnight Pacific." : "";
  if (status.next_retry_at) {
    const next = new Date(status.next_retry_at);
    return `ytscraper is retrying them on its own: attempt ${status.attempts} didn't get them all, next try at ${clock(minutesInZone(next, timeZone))} ${zoneName(next, timeZone)}.${quota}`;
  }
  return `ytscraper has no retry left today (attempt ${status.attempts}).${quota} Fill them in with ytscraper's backfill-missing-daily-stats.`;
}

/** Today's YouTube stats: every listed talent needs a row before settlement can run. */
async function checkScrape(pool, { now, redis = null }) {
  const timeZone = getQueryTimeZone();
  const check = { key: "scrape-incomplete", title: "YouTube scrape incomplete", severity: "error" };
  const retryMinutes = Math.max(5, envInt("SCRAPE_RETRY_MINUTES", 60));
  const deadline = Math.min(24 * 60 - 1, envInt("SCRAPE_AT_LOCAL_HOUR", 0) * 60 + envInt("SCRAPE_AT_LOCAL_MIN", 5) + retryMinutes + SCRAPE_GRACE_MINUTES);
  if (minutesInZone(now, timeZone) < deadline) return [{ ...check, firing: null }];
  const today = getCurrentDateKey(now, timeZone);
  const { rows } = await pool.query(
    `
    SELECT a.symbol
    FROM yt.youtube_channels c
    JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE c.is_active = true
      AND a.status IN ('active', 'halted')
      AND NOT EXISTS (SELECT 1 FROM market.market_settlement_runs r WHERE r.market_date = $2::date AND r.status = 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM yt.youtube_channel_daily_stats s
        WHERE s.youtube_channel_id = c.youtube_channel_id
          AND s.time >= ($2::date)::timestamp AT TIME ZONE $1
          AND s.time < ($2::date + 1)::timestamp AT TIME ZONE $1
      )
    ORDER BY a.symbol
  `,
    [timeZone, today]
  );
  if (!rows.length) return [{ ...check, firing: false, message: `Every listed talent has stats for ${today}.` }];
  const symbols = rows.map((row) => row.symbol);
  const status = await readScraperStatus(redis, today);
  return [
    {
      ...check,
      firing: true,
      message:
        `${symbols.length} listed talent${symbols.length === 1 ? " has" : "s have"} no YouTube stats for ${today} yet (it's past ` +
        `${clock(deadline)} ${zoneName(now, timeZone)}). Settlement waits for all of them. ${scraperLine(status, timeZone)}`,
      fields: [
        { name: "Missing", value: symbols.join(", ") },
        ...(status?.last_error ? [{ name: "Scraper's last error", value: String(status.last_error).slice(0, 300) }] : []),
      ],
      state: { symbols },
    },
  ];
}

/**
 * Every scheduler heartbeat. A problem has to show on two checks in a row (`memory` carries the last
 * one) before it fires, so a rollout's restart or a Redis restart doesn't page anyone. One alert for
 * them all, sent again early only when another scheduler joins it.
 */
async function checkHeartbeats(redis, { now, memory, standby = false, logger = console }) {
  if (!redis) return [];
  const redisCheck = { key: "redis-unreachable", title: "Watchdog can't read Redis", severity: "error" };
  const check = { key: "scheduler-heartbeats", title: "Schedulers not healthy", severity: "error" };
  let rows;
  try {
    rows = await schedulerHealth.readHeartbeats(redis);
  } catch (error) {
    return [{ ...redisCheck, firing: true, message: `Reading scheduler heartbeats failed (${error?.code || error?.name || "error"}). Market events, chat and heartbeats all go through Redis.` }];
  }
  const found = [];
  schedulerHealth.SCHEDULERS.forEach((spec, index) => {
    const verdict = schedulerHealth.checkHeartbeat(spec, rows[index], now.getTime());
    if (verdict) found.push({ ...verdict, name: spec.name, label: spec.label });
  });
  const previous = memory.heartbeatProblems || new Set();
  memory.heartbeatProblems = new Set(found.map((item) => item.name));
  const confirmed = found.filter((item) => previous.has(item.name));
  const results = [{ ...redisCheck, firing: false, message: "Heartbeats are readable again." }];
  if (!found.length) return [...results, { ...check, firing: false, message: "Every scheduler is reporting clean ticks." }];
  // Seen once so far: no verdict yet, either way.
  if (!confirmed.length) return [...results, { ...check, firing: null }];
  const active = await alerts.getActive(redis, check.key, { logger });
  const names = confirmed.map((item) => item.name);
  const lines = confirmed.map((item) => `**${item.label}**: ${item.detail}`);
  const podDown = confirmed.some((item) => item.name === "watchdog" && ["gone", "missing"].includes(item.problem));
  return [
    ...results,
    {
      ...check,
      firing: true,
      title: confirmed.length === 1 ? `Scheduler not healthy: ${confirmed[0].label}` : `${confirmed.length} schedulers not healthy`,
      message: [
        ...lines,
        podDown || standby ? "\nThe scheduler pod's own watchdog has gone quiet: the api-scheduler pod is probably down (this check ran on a standby pod)." : null,
      ]
        .filter(Boolean)
        .join("\n"),
      state: { names },
      force: Boolean(active) && names.some((name) => !(active.state?.names || []).includes(name)),
    },
  ];
}

async function checkErrors(redis, { now }) {
  if (!redis) return [];
  const threshold = errorThreshold();
  const check = { key: "api-errors", title: "Burst of unhandled API errors", severity: "error" };
  const { count, sample } = await countRecentErrors(redis, now.getTime());
  if (count <= threshold) return [{ ...check, firing: false, message: `Back to ${count} in the last ${ERROR_WINDOW_MINUTES} minutes.` }];
  const latest = sample ? [sample.where, sample.code, sample.message].filter(Boolean).join(" · ") : null;
  return [
    {
      ...check,
      firing: true,
      message: `${count} unhandled errors in the last ${ERROR_WINDOW_MINUTES} minutes across the API (alerting above ${threshold}). Players are getting "internal_error".`,
      fields: latest ? [{ name: `Latest (${sample.source})`, value: latest }] : [],
    },
  ];
}

/** Runs every check once and raises or resolves its alert. Returns the checks (for tests and logs). */
async function runWatchdog(pool, redis, { now = new Date(), memory = {}, standby = false, logger = console, alertOptions = {} } = {}) {
  const checks = [];
  const failed = [];
  const runs = [
    ["market", () => checkMarket(pool, { now })],
    ["scrape", () => checkScrape(pool, { now, redis })],
    ["heartbeats", () => checkHeartbeats(redis, { now, memory, standby, logger })],
    ["errors", () => checkErrors(redis, { now })],
  ];
  for (const [name, run] of runs) {
    try {
      checks.push(...(await run()));
    } catch (error) {
      failed.push(`${name} (${error?.code || error?.message || "error"})`);
      logger.error?.(`watchdog: ${name} check failed`, error?.code || error?.message || error);
    }
  }
  checks.push({
    key: "watchdog-checks",
    title: "Watchdog checks failing",
    severity: "error",
    firing: failed.length > 0,
    message: failed.length ? `These checks couldn't run, so their alerts can't fire: ${failed.join(", ")}.` : "Every check runs again.",
  });

  memory.seenOnce = memory.seenOnce || new Set();
  for (const check of checks) {
    if (check.firing === true && check.confirm && !memory.seenOnce.has(check.key)) {
      memory.seenOnce.add(check.key);
      continue;
    }
    if (check.firing === false) memory.seenOnce.delete(check.key);
    if (check.firing === true) {
      await alerts.raise(redis, check.key, check, { logger, force: check.force, state: check.state ?? null, ...alertOptions });
    } else if (check.firing === false) {
      await alerts.resolve(redis, check.key, { title: check.title, message: check.message }, { logger, ...alertOptions });
    }
  }
  return checks;
}

/** Whether the scheduler pod's watchdog has stopped reporting (a Redis error says no: nothing to go on). */
async function primaryQuiet(redis, now = Date.now()) {
  try {
    const row = JSON.parse((await redis.get(`${schedulerHealth.KEY_PREFIX}watchdog`)) || "null");
    return !row || !(now - Date.parse(row.last_seen_at) <= schedulerHealth.GONE_AFTER_MS);
  } catch {
    return false;
  }
}

function startWatchdog(pool, logger = console, redis = null, { intervalMs = INTERVAL_MS, primary = schedulerHealth.ownsSharedSchedulers() } = {}) {
  if ((process.env.WATCHDOG_ENABLED || "true").toLowerCase() === "false" || !redis) return () => {};
  const heartbeat = primary ? schedulerHealth.startSchedulerHeartbeat(redis, "watchdog", { enabled: true, intervalMs }, logger) : null;
  const memory = {};
  let quietChecks = 0;
  let running = false;

  async function tick() {
    if (running) return;
    if (!primary) {
      // Standby: only once the scheduler pod's watchdog has been quiet for two checks in a row.
      quietChecks = (await primaryQuiet(redis)) ? quietChecks + 1 : 0;
      if (quietChecks < 2) {
        memory.heartbeatProblems = undefined;
        return;
      }
    }
    running = true;
    heartbeat?.update("running");
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) {
        heartbeat?.skip();
        return;
      }
      try {
        await runWatchdog(pool, redis, { memory, standby: !primary, logger });
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
      heartbeat?.update("idle");
    } catch (error) {
      heartbeat?.update("error", error);
      logger.error?.("watchdog failed", error?.code || error?.message || error);
    } finally {
      client?.release();
      running = false;
    }
  }

  // Give this boot's heartbeats a moment to publish first.
  const first = setTimeout(() => void tick(), 30_000);
  first.unref?.();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    heartbeat?.stop();
  };
}

module.exports = {
  LOCK_KEY,
  checkErrors,
  checkHeartbeats,
  checkMarket,
  checkScrape,
  isServerFault,
  recordError,
  runWatchdog,
  startWatchdog,
};
