const fundamentals = require("./fundamentals");
const settlement = require("./settlement");
const marketState = require("./marketState");
const marketAdjustments = require("./marketAdjustments");
const alerts = require("./alerts");
const schedulerHealth = require("./schedulerHealth");
const { publishMarketStatusEvent } = require("./marketEvents");
const { invalidateMarketAssetsCache } = require("../marketCache");

const SCHEDULER_LOCK_KEY = 9_204_001;
const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;
const LOOP_INTERVAL_MS = 60_000;
// After a failed cycle the next one waits. The first retries come on the next minutes (most
// failures are a blip); from the third failure on, the wait doubles up to 30 minutes and the team
// gets an alert. Retrying every minute used to close and reopen trading every minute.
const BACKOFF_AFTER_FAILURES = 2;
const MAX_RETRY_DELAY_MS = 30 * 60_000;
const BACKOFF_ALERT_KEY = "settlement-backoff";
const BACKOFF_ALERT_TITLE = "Daily settlement keeps failing";

function isValidIanaTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(value) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return DEFAULT_TIME_ZONE;
  }
  if (isValidIanaTimeZone(candidate)) {
    return candidate;
  }

  const normalizedOffset = candidate
    .toUpperCase()
    .replace(/^UTC/, "GMT")
    .match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (normalizedOffset) {
    const [, sign, hourText, minuteText = "00"] = normalizedOffset;
    const hours = Number(hourText);
    const minutes = Number(minuteText);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && minutes === 0) {
      const etcSign = sign === "+" ? "-" : "+";
      const etcZone = `Etc/GMT${etcSign}${hours}`;
      if (isValidIanaTimeZone(etcZone)) {
        return etcZone;
      }
    }
  }

  return DEFAULT_TIME_ZONE;
}

function getQueryTimeZone() {
  return normalizeTimeZone(process.env.MARKET_DATA_TIMEZONE || process.env.SCRAPE_TIMEZONE || DEFAULT_TIME_ZONE);
}

function getTimeZoneFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function getZonedParts(date, timeZone) {
  const formatter = getTimeZoneFormatter(timeZone);
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatDateKey(parts) {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const isoPrefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) {
    return isoPrefix[1];
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return parsed.toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(parts, timeZone) {
  let guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0));

  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(guess, timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    const diff = desiredUtc - actualUtc;
    if (diff === 0) {
      return guess;
    }
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function addDays(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  value.setUTCDate(value.getUTCDate() + days);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function computeNextScheduledAt(now, { timeZone, hour, minute }) {
  const zoned = getZonedParts(now, timeZone);
  const isPastToday = zoned.hour > hour || (zoned.hour === hour && zoned.minute >= minute);
  const targetDate = isPastToday ? addDays(zoned, 1) : zoned;
  return zonedDateTimeToUtc(
    {
      year: targetDate.year,
      month: targetDate.month,
      day: targetDate.day,
      hour,
      minute,
      second: 0,
    },
    timeZone
  );
}

function shouldRunScheduledCycle(now, { timeZone, hour, minute }) {
  const zoned = getZonedParts(now, timeZone);
  return zoned.hour > hour || (zoned.hour === hour && zoned.minute >= minute);
}

function getCurrentDateKey(now, timeZone) {
  return formatDateKey(getZonedParts(now, timeZone));
}

async function listReadyRawSnapshotDates(client, { after = null, through = null } = {}) {
  const params = [getQueryTimeZone()];
  const where = [];
  const dayExpr = `timezone($1, s.time)::date`;

  if (after) {
    params.push(after);
    where.push(`${dayExpr} > $${params.length}::date`);
  }
  if (through) {
    params.push(through);
    where.push(`${dayExpr} <= $${params.length}::date`);
  }

  const { rows } = await client.query(
    `
    -- Only listed stocks hold a day up: a talent still coming to market (prelaunch, or not bootstrapped
    -- yet) is tracked, but a missing stats row for her never blocks settlement.
    WITH listed_channels AS (
      SELECT c.youtube_channel_id
      FROM yt.youtube_channels c
      JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
      WHERE c.is_active = true
        AND a.status IN ('active', 'halted')
    ),
    active_channels AS (
      SELECT COUNT(*)::INTEGER AS active_count FROM listed_channels
    )
    SELECT ${dayExpr} AS snapshot_date
    FROM yt.youtube_channel_daily_stats s
    JOIN listed_channels c
      ON c.youtube_channel_id = s.youtube_channel_id
    CROSS JOIN active_channels ac
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY ${dayExpr}, ac.active_count
    HAVING COUNT(DISTINCT s.youtube_channel_id) = ac.active_count
    ORDER BY ${dayExpr} ASC
  `,
    params
  );

  return rows.map((row) => (row.snapshot_date instanceof Date ? row.snapshot_date.toISOString().slice(0, 10) : String(row.snapshot_date)));
}

async function getLatestCompletedSettlementDate(client) {
  const { rows } = await client.query(
    `
    SELECT market_date
    FROM market.market_settlement_runs
    WHERE status = 'completed'
    ORDER BY market_date DESC
    LIMIT 1
  `
  );

  return rows[0]?.market_date ? normalizeDateOnly(rows[0].market_date) : null;
}

async function acquireSchedulerLock(client) {
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [SCHEDULER_LOCK_KEY]);
  return Boolean(rows[0]?.locked);
}

async function releaseSchedulerLock(client) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
  } catch {}
}

function buildCycleMessage({ from, to, phase }) {
  if (phase === "fundamentals") {
    return from === to
      ? `Market closed for daily settlement. Recomputing fundamentals for ${from}.`
      : `Market closed for daily settlement. Recomputing fundamentals for ${from} through ${to}.`;
  }

  return from === to
    ? `Market closed for daily settlement. Applying settlement for ${from}.`
    : `Market closed for daily settlement. Applying settlement for ${from} through ${to}.`;
}

async function runScheduledCycle(pool, schedulerConfig, logger = console, redis = null) {
  const lockClient = await pool.connect();
  try {
    const locked = await acquireSchedulerLock(lockClient);
    if (!locked) {
      return { ok: true, skipped: "already_running" };
    }

    const runtimeState = await marketState.getMarketStatusWithClient(lockClient);
    if (runtimeState?.trading_status === "manual_closed") {
      return { ok: true, skipped: "manual_closed" };
    }

    const now = new Date();
    const nextScheduledAt = computeNextScheduledAt(now, schedulerConfig);
    const currentDateKey = getCurrentDateKey(now, schedulerConfig.timeZone);
    const lastCompletedDate = await getLatestCompletedSettlementDate(lockClient);
    const readyDates = await listReadyRawSnapshotDates(lockClient, {
      after: lastCompletedDate,
      through: currentDateKey,
    });

    if (readyDates.length === 0) {
      await marketState.setMarketOpen(lockClient, {
        nextScheduledSettlementAt: nextScheduledAt.toISOString(),
      });
      return {
        ok: true,
        skipped: "nothing_ready",
        next_scheduled_settlement_at: nextScheduledAt.toISOString(),
      };
    }

    const from = readyDates[0];
    const to = readyDates[readyDates.length - 1];

    const settlingStatus = await marketState.setMarketSettling(lockClient, {
      marketDate: to,
      phase: "fundamentals",
      message: buildCycleMessage({ from, to, phase: "fundamentals" }),
      nextScheduledSettlementAt: nextScheduledAt.toISOString(),
    });
    void publishMarketStatusEvent(redis, settlingStatus);

    // Big streams count toward fair value: make sure yesterday's are labeled before pricing.
    await require("./wire/streams")
      .labelRecentStreams(pool, { hours: 96 })
      .catch((error) => console.warn("stream labels before settlement failed", String(error?.message || error)));

    const fundamentalsResult = await fundamentals.recalculateFundamentals(pool, {
      from,
      to,
      version: 1,
      activeOnly: true,
      fillMissingDates: true,
    });

    // IPOs whose listing day is the first day being settled turn active now, so that settlement
    // opens them at their IPO price (services/ipo.js).
    await require("./ipo")
      .listDueEvents(pool, { marketDate: from, redis, logger })
      .catch((error) => logger.error?.("ipo listing before settlement failed", error));

    const settlementStatus = await marketState.updateSettlementPhase(lockClient, {
      marketDate: to,
      phase: "settlement",
      message: buildCycleMessage({ from, to, phase: "settlement" }),
    });
    void publishMarketStatusEvent(redis, settlementStatus);

    const settlementResult = await settlement.settleMarketRange(pool, {
      from,
      to,
      force: false,
      redis,
    });
    if ((settlementResult.skipped_dates || []).length > 0 || settlementResult.settled_count !== readyDates.length) {
      const error = new Error(`scheduled_settlement_incomplete:${JSON.stringify(settlementResult.skipped_dates || [])}`);
      error.code = "scheduled_settlement_incomplete";
      throw error;
    }

    const latestSettled = settlementResult.settled_dates[settlementResult.settled_dates.length - 1]?.market_date || to;
    const adjustmentSession = await marketAdjustments.ensureAdjustmentSession(pool, {
      marketDate: latestSettled,
    });
    await invalidateMarketAssetsCache(redis);
    const openStatus = await marketState.setMarketOpen(lockClient, {
      message: `Daily settlement completed for ${latestSettled}. Trading is open.`,
      nextScheduledSettlementAt: nextScheduledAt.toISOString(),
      lastSettlementMarketDate: latestSettled,
      clearError: true,
    });
    void publishMarketStatusEvent(redis, openStatus);

    return {
      ok: true,
      from,
      to,
      fundamentals: fundamentalsResult,
      settlement: settlementResult,
      adjustment_session: adjustmentSession,
      next_scheduled_settlement_at: nextScheduledAt.toISOString(),
    };
  } catch (error) {
    const nextScheduledAt = computeNextScheduledAt(new Date(), schedulerConfig);
    const errorStatus = await marketState.setMarketCycleError(lockClient, String(error?.message || error), {
      nextScheduledSettlementAt: nextScheduledAt.toISOString(),
    });
    void publishMarketStatusEvent(redis, errorStatus);
    logger.error?.("market scheduler cycle failed", error);
    throw error;
  } finally {
    await releaseSchedulerLock(lockClient);
    lockClient.release();
  }
}

function loadSchedulerConfig() {
  return {
    enabled: (process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
    timeZone: normalizeTimeZone(process.env.MARKET_SETTLEMENT_TIMEZONE || DEFAULT_TIME_ZONE),
    hour: Number.parseInt(String(process.env.MARKET_SETTLEMENT_HOUR ?? DEFAULT_HOUR), 10) || DEFAULT_HOUR,
    minute: Number.parseInt(String(process.env.MARKET_SETTLEMENT_MINUTE ?? DEFAULT_MINUTE), 10) || DEFAULT_MINUTE,
  };
}

/** How long to wait after the `failures`-th failed cycle in a row before trying again (0: next tick). */
function settlementRetryDelayMs(failures) {
  if (failures <= BACKOFF_AFTER_FAILURES) return 0;
  return Math.min(MAX_RETRY_DELAY_MS, LOOP_INTERVAL_MS * 2 ** (failures - BACKOFF_AFTER_FAILURES));
}

function backoffAlert({ failures, retryAt, error, timeZone }) {
  const next = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(retryAt));
  return {
    title: BACKOFF_ALERT_TITLE,
    message:
      `${failures} settlement cycles in a row have failed. Trading stays open on the last settled day, and the scheduler now waits ` +
      `longer between tries (up to 30 minutes) instead of closing and reopening the market every minute. Next try: ${next}.`,
    fields: [{ name: "Last error", value: String(error?.message || error) }],
  };
}

/** One tick of the settlement loop, with its failure count and backoff (startMarketScheduler runs it every minute). */
function createSettlementTick(pool, { config, runCycle = runScheduledCycle, heartbeat, redis = null, logger = console, alertOptions = {}, now = Date.now }) {
  let running = false;
  let failures = 0;
  let retryAt = 0;

  return async function tick() {
    if (!config.enabled || running) {
      return;
    }
    if (!shouldRunScheduledCycle(new Date(now()), config)) {
      heartbeat.update("idle");
      return;
    }
    // Waiting out failures: the heartbeat keeps the error until a retry goes through.
    if (now() < retryAt) {
      return;
    }

    running = true;
    heartbeat.update("running");
    try {
      await runCycle(pool, config, logger, redis);
      failures = 0;
      retryAt = 0;
      heartbeat.update("idle", null, { consecutive_failures: 0, retry_at: null });
      await alerts.resolve(redis, BACKOFF_ALERT_KEY, { title: BACKOFF_ALERT_TITLE, message: "A settlement cycle went through." }, { logger, ...alertOptions }).catch(() => {});
    } catch (error) {
      // runScheduledCycle has recorded and logged it.
      failures += 1;
      const delayMs = settlementRetryDelayMs(failures);
      retryAt = now() + delayMs;
      heartbeat.update("error", error, { consecutive_failures: failures, retry_at: delayMs ? new Date(retryAt).toISOString() : null });
      if (delayMs) {
        await alerts.raise(redis, BACKOFF_ALERT_KEY, backoffAlert({ failures, retryAt, error, timeZone: config.timeZone }), { logger, ...alertOptions }).catch(() => {});
      }
    } finally {
      running = false;
    }
  };
}

function startMarketScheduler(pool, logger = console, redis = null) {
  const schedulerConfig = loadSchedulerConfig();
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "settlement", { enabled: schedulerConfig.enabled, intervalMs: LOOP_INTERVAL_MS }, logger);
  const tick = createSettlementTick(pool, { config: schedulerConfig, heartbeat, redis, logger });

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, LOOP_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    heartbeat.stop();
  };
}

module.exports = {
  acquireSchedulerLock,
  computeNextScheduledAt,
  createSettlementTick,
  getCurrentDateKey,
  getQueryTimeZone,
  loadSchedulerConfig,
  releaseSchedulerLock,
  runScheduledCycle,
  settlementRetryDelayMs,
  shiftDateKey,
  startMarketScheduler,
};
