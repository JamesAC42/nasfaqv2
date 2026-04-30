const { invalidateMarketAssetsCache } = require("../marketCache");
const { publishMarketEvent } = require("./marketEvents");

const DEFAULT_TIME_ZONE = "America/New_York";
const INTERVALS = [
  { key: "open", label: "Open", hour: 9, minute: 0, dayOffset: 0 },
  { key: "lunch", label: "Lunch", hour: 15, minute: 0, dayOffset: 0 },
  { key: "late", label: "Late", hour: 21, minute: 0, dayOffset: 0 },
  { key: "overnight", label: "Overnight", hour: 3, minute: 0, dayOffset: 1 },
];
const INTERVAL_STRENGTH_TOTAL_PCT = 200;
const DEFAULT_BATCH_LIMIT = 250;
const ADJUSTMENT_SCHEDULER_LOCK_KEY = 9_204_002;
const DEFAULT_TRANSIENT_HALF_LIFE_MINUTES = 60;
const TRANSIENT_HALF_LIFE_MINUTES = Number(process.env.MARKET_TRANSIENT_HALF_LIFE_MINUTES || DEFAULT_TRANSIENT_HALF_LIFE_MINUTES);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMarketDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function roundMetric(value, digits = 6) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

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
  return candidate && isValidIanaTimeZone(candidate) ? candidate : DEFAULT_TIME_ZONE;
}

function getTimeZone() {
  return normalizeTimeZone(process.env.MARKET_ADJUSTMENT_TIMEZONE || process.env.MARKET_SETTLEMENT_TIMEZONE || DEFAULT_TIME_ZONE);
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

function addDays(dateKey, days) {
  const value = new Date(`${dateKey}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function zonedDateTimeToUtc(parts, timeZone) {
  let guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0));

  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(guess, timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    const diff = desiredUtc - actualUtc;
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function getIntervalSchedule(marketDate, timeZone = getTimeZone()) {
  return INTERVALS.map((interval) => {
    const dateParts = addDays(marketDate, interval.dayOffset);
    return {
      ...interval,
      scheduledAt: zonedDateTimeToUtc(
        {
          ...dateParts,
          hour: interval.hour,
          minute: interval.minute,
          second: 0,
        },
        timeZone
      ),
      timeZone,
    };
  });
}

function randomIntInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function generateStrengths({ total = INTERVAL_STRENGTH_TOTAL_PCT, count = INTERVALS.length, minPct = 0, maxPct = total } = {}) {
  const min = Math.max(1, Math.ceil(toNumber(minPct, 0)));
  const max = Math.max(min, Math.floor(toNumber(maxPct, total)));
  if (min * count > total || max * count < total) {
    const error = new Error("invalid_adjustment_strength_bounds");
    error.code = "invalid_adjustment_strength_bounds";
    throw error;
  }

  const span = max - min;
  let remaining = total - min * count;
  const values = Array.from({ length: count }, () => min);

  for (let index = 0; index < count; index += 1) {
    const remainingSlots = count - index - 1;
    const lowerExtra = Math.max(0, remaining - remainingSlots * span);
    const upperExtra = Math.min(span, remaining);
    const extra = index === count - 1 ? remaining : randomIntInclusive(lowerExtra, upperExtra);
    values[index] += extra;
    remaining -= extra;
  }

  return shuffle(values);
}

function computeQuotes(midPrice, spreadBps) {
  const spreadPct = Math.max(toNumber(spreadBps, 0), 0) / 10000;
  return {
    bidPrice: midPrice * (1 - spreadPct / 2),
    askPrice: midPrice * (1 + spreadPct / 2),
  };
}

function decayTransientOffset(transientOffset, lastUpdatedAt, now = new Date()) {
  const raw = Number(transientOffset || 0);
  if (!Number.isFinite(raw) || raw === 0 || !lastUpdatedAt) return 0;

  const last = new Date(lastUpdatedAt);
  if (Number.isNaN(last.getTime())) return 0;

  const dtMinutes = Math.max(0, (now.getTime() - last.getTime()) / 60000);
  const decayFactor = Math.pow(0.5, dtMinutes / Math.max(TRANSIENT_HALF_LIFE_MINUTES, 1));
  return raw * decayFactor;
}

function computeLiveMidPrice(baseRate, persistentOffset, transientOffset) {
  return Math.max(baseRate, 0.000001) * Math.exp(persistentOffset + transientOffset);
}

function computeAdjustedPrice(currentMid, baseRate, strengthPct) {
  return currentMid + ((baseRate - currentMid) * (strengthPct / 100));
}

function toPublicAdjustment(adjustment) {
  if (!adjustment) return adjustment;
  return {
    id: adjustment.id,
    session_id: adjustment.session_id,
    market_date: adjustment.market_date,
    interval_key: adjustment.interval_key,
    asset_id: adjustment.asset_id,
    symbol: adjustment.symbol,
    display_name: adjustment.display_name,
    price_before: adjustment.price_before,
    price_after: adjustment.price_after,
    premium_discount_pct: adjustment.premium_discount_pct,
    quote: adjustment.quote,
  };
}

async function listAssetsForSession(client) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      symbol,
      display_name,
      current_fair_value,
      current_mid_price,
      adjustment_min_pct,
      adjustment_max_pct,
      adjustment_enabled
    FROM market.market_assets
    WHERE status = 'active'
      AND adjustment_enabled = true
      AND current_fair_value IS NOT NULL
      AND current_fair_value > 0
      AND current_mid_price IS NOT NULL
      AND current_mid_price > 0
    ORDER BY symbol ASC
  `
  );
  return rows;
}

async function ensureAdjustmentSession(pool, { marketDate, force = false } = {}) {
  const client = await pool.connect();
  const timeZone = getTimeZone();

  try {
    await client.query("BEGIN");

    if (force) {
      await client.query(
        `
        DELETE FROM market.adjustment_sessions
        WHERE market_date = $1
      `,
        [marketDate]
      );
    }

    const sessionResult = await client.query(
      `
      INSERT INTO market.adjustment_sessions (market_date, status, generated_at, opened_at, updated_at)
      VALUES ($1, 'active', now(), now(), now())
      ON CONFLICT (market_date)
      DO UPDATE SET
        status = CASE
          WHEN market.adjustment_sessions.status = 'cancelled' THEN market.adjustment_sessions.status
          ELSE market.adjustment_sessions.status
        END,
        updated_at = now()
      RETURNING id, market_date, status, generated_at, opened_at, completed_at
    `,
      [marketDate]
    );
    const session = sessionResult.rows[0];

    const existingCountResult = await client.query(
      `
      SELECT COUNT(*)::INTEGER AS interval_count
      FROM market.asset_adjustment_intervals
      WHERE session_id = $1
    `,
      [session.id]
    );
    const existingCount = Number(existingCountResult.rows[0]?.interval_count || 0);
    if (existingCount > 0 && !force) {
      await client.query("COMMIT");
      return {
        session,
        created: false,
        interval_count: existingCount,
        skipped_assets: [],
      };
    }

    const assets = await listAssetsForSession(client);
    const schedule = getIntervalSchedule(marketDate, timeZone);
    const skippedAssets = [];
    let intervalCount = 0;

    for (const asset of assets) {
      let strengths;
      try {
        strengths = generateStrengths({
          minPct: asset.adjustment_min_pct,
          maxPct: asset.adjustment_max_pct,
        });
      } catch (error) {
        skippedAssets.push({
          asset_id: asset.id,
          symbol: asset.symbol,
          error: error.code || "invalid_adjustment_strength_bounds",
        });
        continue;
      }

      for (const [index, interval] of schedule.entries()) {
        await client.query(
          `
          INSERT INTO market.asset_adjustment_intervals (
            session_id,
            asset_id,
            interval_key,
            scheduled_at,
            strength_pct,
            base_rate,
            status,
            metadata_json
          ) VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7::jsonb)
          ON CONFLICT (session_id, asset_id, interval_key)
          DO NOTHING
        `,
          [
            session.id,
            asset.id,
            interval.key,
            interval.scheduledAt.toISOString(),
            strengths[index],
            asset.current_fair_value,
            JSON.stringify({
              label: interval.label,
              timezone: interval.timeZone,
              generated_market_price: roundMetric(asset.current_mid_price),
            }),
          ]
        );
        intervalCount += 1;
      }
    }

    await client.query("COMMIT");
    return {
      session,
      created: true,
      interval_count: intervalCount,
      skipped_assets: skippedAssets,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDueIntervals(client, { now = new Date(), limit = DEFAULT_BATCH_LIMIT } = {}) {
  const { rows } = await client.query(
    `
    SELECT
      i.id,
      i.session_id,
      i.asset_id,
      i.interval_key,
      i.scheduled_at,
      i.strength_pct,
      i.base_rate,
      s.market_date
    FROM market.asset_adjustment_intervals i
    JOIN market.adjustment_sessions s ON s.id = i.session_id
    WHERE i.status = 'scheduled'
      AND s.status IN ('scheduled', 'active')
      AND i.scheduled_at <= $1
    ORDER BY i.scheduled_at ASC, i.id ASC
    LIMIT $2
    FOR UPDATE OF i SKIP LOCKED
  `,
    [now, limit]
  );
  return rows;
}

async function applyInterval(client, interval, now = new Date()) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      symbol,
      display_name,
      status,
      current_fair_value,
      current_mid_price,
      current_persistent_offset,
      current_transient_offset,
      offsets_updated_at,
      latest_snapshot_id,
      spread_bps
    FROM market.market_assets
    WHERE id = $1
    FOR UPDATE
  `,
    [interval.asset_id]
  );
  const asset = rows[0] || null;

  if (!asset || asset.status !== "active" || !(toNumber(asset.current_fair_value, 0) > 0) || !(toNumber(asset.current_mid_price, 0) > 0)) {
    await client.query(
      `
      UPDATE market.asset_adjustment_intervals
      SET status = 'skipped',
        applied_at = $2,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb,
        updated_at = now()
      WHERE id = $1
    `,
      [
        interval.id,
        now,
        JSON.stringify({
          skip_reason: !asset ? "asset_not_found" : "asset_not_adjustable",
        }),
      ]
    );
    return null;
  }

  const baseRate = toNumber(interval.base_rate, toNumber(asset.current_fair_value, 0));
  const currentMarketPrice = toNumber(asset.current_mid_price, 0);
  const persistentOffset = toNumber(asset.current_persistent_offset, 0);
  const decayedTransientOffset = decayTransientOffset(asset.current_transient_offset, asset.offsets_updated_at, now);
  const decayedOffsetPrice = computeLiveMidPrice(baseRate, persistentOffset, decayedTransientOffset);
  const priceBefore = currentMarketPrice > 0 ? currentMarketPrice : decayedOffsetPrice;
  const strengthPct = toNumber(interval.strength_pct, 0);
  const priceAfter = Math.max(0.000001, computeAdjustedPrice(priceBefore, baseRate, strengthPct));
  const nextPremium = baseRate > 0 ? (priceAfter - baseRate) / baseRate : 0;
  const quotes = computeQuotes(priceAfter, asset.spread_bps);
  const nextCombinedOffset = Math.log(priceAfter / Math.max(baseRate, 0.000001));
  const nextTransientOffset = nextCombinedOffset - persistentOffset;

  await client.query(
    `
    UPDATE market.market_assets
    SET
      current_mid_price = $2,
      current_bid_price = $3,
      current_ask_price = $4,
      current_premium_pct = $5,
      current_transient_offset = $6,
      offsets_updated_at = $7,
      updated_at = now()
    WHERE id = $1
  `,
    [asset.id, priceAfter, quotes.bidPrice, quotes.askPrice, nextPremium, nextTransientOffset, now]
  );

  await client.query(
    `
    UPDATE market.asset_adjustment_intervals
    SET
      price_before = $2,
      price_after = $3,
      status = 'applied',
      applied_at = $4,
      updated_at = now()
    WHERE id = $1
  `,
    [interval.id, priceBefore, priceAfter, now]
  );

  await client.query(
    `
    INSERT INTO market.asset_price_events (
      asset_id,
      ts,
      event_type,
      old_mid_price,
      new_mid_price,
      fair_value_at_event,
      metadata_json
    ) VALUES ($1,$2,'interval_adjustment',$3,$4,$5,$6::jsonb)
  `,
    [
      asset.id,
      now,
      priceBefore,
      priceAfter,
      baseRate,
      JSON.stringify({
        market_date: interval.market_date,
        interval_key: interval.interval_key,
        strength_pct: strengthPct,
        session_id: interval.session_id,
        adjustment_interval_id: interval.id,
      }),
    ]
  );

  if (asset.latest_snapshot_id && interval.market_date) {
    await client.query(
      `
      UPDATE market.asset_daily_market_state
      SET
        mid_close = $3,
        mid_high = GREATEST(COALESCE(mid_high, mid_open), $3),
        mid_low = LEAST(COALESCE(mid_low, mid_open), $3),
        bid_close = $4,
        ask_close = $5,
        premium_close_pct = $6,
        updated_at = now()
      WHERE asset_id = $1
        AND market_date = $2
    `,
      [asset.id, interval.market_date, priceAfter, quotes.bidPrice, quotes.askPrice, nextPremium]
    );
  }

  return {
    id: interval.id,
    session_id: interval.session_id,
    market_date: interval.market_date,
    interval_key: interval.interval_key,
    asset_id: asset.id,
    symbol: asset.symbol,
    display_name: asset.display_name,
    strength_pct: strengthPct,
    base_rate: baseRate,
    price_before: priceBefore,
    price_after: priceAfter,
    premium_discount_pct: nextPremium,
    quote: {
      asset_id: asset.id,
      symbol: asset.symbol,
      display_name: asset.display_name,
      mid_price: priceAfter,
      bid_price: quotes.bidPrice,
      ask_price: quotes.askPrice,
      premium_pct: nextPremium,
      updated_at: now.toISOString(),
    },
  };
}

async function refreshCompletedSessions(client) {
  await client.query(
    `
    UPDATE market.adjustment_sessions s
    SET status = 'completed',
      completed_at = now(),
      updated_at = now()
    WHERE s.status IN ('scheduled', 'active')
      AND NOT EXISTS (
        SELECT 1
        FROM market.asset_adjustment_intervals i
        WHERE i.session_id = s.id
          AND i.status = 'scheduled'
      )
  `
  );
}

async function applyDueAdjustments(pool, { now = new Date(), limit = DEFAULT_BATCH_LIMIT, redis = null } = {}) {
  const client = await pool.connect();
  const applied = [];
  let skippedCount = 0;

  try {
    await client.query("BEGIN");
    const intervals = await getDueIntervals(client, { now, limit });

    for (const interval of intervals) {
      const result = await applyInterval(client, interval, now);
      if (result) {
        applied.push(result);
      } else {
        skippedCount += 1;
      }
    }

    await refreshCompletedSessions(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (applied.length > 0) {
    await invalidateMarketAssetsCache(redis);
    void publishMarketEvent(redis, {
      type: "market.adjustments_applied",
      applied_count: applied.length,
      skipped_count: skippedCount,
      adjustments: applied.map(toPublicAdjustment),
      quotes: applied.map((item) => item.quote),
      at: now.toISOString(),
    });
  }

  return {
    ok: true,
    applied_count: applied.length,
    skipped_count: skippedCount,
    adjustments: applied,
  };
}

async function forceNextAdjustment(pool, { marketDate, now = new Date(), redis = null } = {}) {
  const normalizedMarketDate = normalizeMarketDate(marketDate);
  if (!normalizedMarketDate) {
    const error = new Error("invalid_market_date");
    error.code = "invalid_market_date";
    throw error;
  }

  const sessionResult = await ensureAdjustmentSession(pool, { marketDate: normalizedMarketDate });
  const client = await pool.connect();
  const applied = [];
  let skippedCount = 0;
  let skippedPriorCount = 0;
  let target = null;

  try {
    await client.query("BEGIN");

    const targetResult = await client.query(
      `
      WITH candidate AS (
        SELECT i.interval_key, MIN(i.scheduled_at) AS scheduled_at
        FROM market.asset_adjustment_intervals i
        JOIN market.adjustment_sessions s ON s.id = i.session_id
        WHERE s.market_date = $1
          AND s.status IN ('scheduled', 'active')
          AND i.status = 'scheduled'
          AND i.scheduled_at > $2
        GROUP BY i.interval_key
        ORDER BY MIN(i.scheduled_at) ASC
        LIMIT 1
      ),
      fallback AS (
        SELECT i.interval_key, MIN(i.scheduled_at) AS scheduled_at
        FROM market.asset_adjustment_intervals i
        JOIN market.adjustment_sessions s ON s.id = i.session_id
        WHERE s.market_date = $1
          AND s.status IN ('scheduled', 'active')
          AND i.status = 'scheduled'
          AND NOT EXISTS (SELECT 1 FROM candidate)
        GROUP BY i.interval_key
        ORDER BY MIN(i.scheduled_at) ASC
        LIMIT 1
      )
      SELECT interval_key, scheduled_at FROM candidate
      UNION ALL
      SELECT interval_key, scheduled_at FROM fallback
      LIMIT 1
    `,
      [normalizedMarketDate, now]
    );
    target = targetResult.rows[0] || null;
    if (!target) {
      await client.query("COMMIT");
      return {
        ok: true,
        market_date: normalizedMarketDate,
        session: sessionResult.session,
        created: sessionResult.created,
        applied_count: 0,
        skipped_count: 0,
        skipped_prior_count: 0,
        adjustments: [],
        target: null,
      };
    }

    const skippedPriorResult = await client.query(
      `
      UPDATE market.asset_adjustment_intervals i
      SET status = 'skipped',
        applied_at = $3,
        metadata_json = COALESCE(i.metadata_json, '{}'::jsonb) || $4::jsonb,
        updated_at = now()
      FROM market.adjustment_sessions s
      WHERE s.id = i.session_id
        AND s.market_date = $1
        AND i.status = 'scheduled'
        AND i.scheduled_at < $2
    `,
      [
        normalizedMarketDate,
        target.scheduled_at,
        now,
        JSON.stringify({
          skip_reason: "missed_before_force_adjustment",
          forced_target_interval_key: target.interval_key,
          forced_at: now.toISOString(),
        }),
      ]
    );
    skippedPriorCount = skippedPriorResult.rowCount || 0;

    const intervalsResult = await client.query(
      `
      SELECT
        i.id,
        i.session_id,
        i.asset_id,
        i.interval_key,
        i.scheduled_at,
        i.strength_pct,
        i.base_rate,
        s.market_date
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE s.market_date = $1
        AND i.status = 'scheduled'
        AND i.interval_key = $2
        AND i.scheduled_at = $3
      ORDER BY i.id ASC
      FOR UPDATE OF i SKIP LOCKED
    `,
      [normalizedMarketDate, target.interval_key, target.scheduled_at]
    );

    for (const interval of intervalsResult.rows) {
      const result = await applyInterval(client, interval, now);
      if (result) {
        applied.push(result);
      } else {
        skippedCount += 1;
      }
    }

    await refreshCompletedSessions(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (applied.length > 0 || skippedPriorCount > 0) {
    await invalidateMarketAssetsCache(redis);
  }

  if (applied.length > 0) {
    void publishMarketEvent(redis, {
      type: "market.adjustments_applied",
      forced: true,
      market_date: normalizedMarketDate,
      interval_key: target.interval_key,
      scheduled_at: target.scheduled_at,
      applied_count: applied.length,
      skipped_count: skippedCount + skippedPriorCount,
      skipped_prior_count: skippedPriorCount,
      adjustments: applied.map(toPublicAdjustment),
      quotes: applied.map((item) => item.quote),
      at: now.toISOString(),
    });
  }

  return {
    ok: true,
    market_date: normalizedMarketDate,
    session: sessionResult.session,
    created: sessionResult.created,
    target: {
      interval_key: target.interval_key,
      scheduled_at: target.scheduled_at,
      applied_at: now.toISOString(),
    },
    applied_count: applied.length,
    skipped_count: skippedCount + skippedPriorCount,
    skipped_prior_count: skippedPriorCount,
    adjustments: applied,
  };
}

async function acquireAdjustmentSchedulerLock(client) {
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [ADJUSTMENT_SCHEDULER_LOCK_KEY]);
  return Boolean(rows[0]?.locked);
}

async function releaseAdjustmentSchedulerLock(client) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [ADJUSTMENT_SCHEDULER_LOCK_KEY]);
  } catch {}
}

function startAdjustmentScheduler(pool, logger = console, redis = null) {
  const enabled = (process.env.MARKET_ADJUSTMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
  const intervalMs = Math.max(10_000, Number(process.env.MARKET_ADJUSTMENT_SCHEDULER_INTERVAL_MS || 60_000));
  let running = false;

  async function tick() {
    if (!enabled || running) return;
    running = true;
    const lockClient = await pool.connect();
    try {
      const locked = await acquireAdjustmentSchedulerLock(lockClient);
      if (!locked) return;
      await applyDueAdjustments(pool, { redis });
    } catch (error) {
      logger.error?.("market adjustment scheduler failed", error);
    } finally {
      await releaseAdjustmentSchedulerLock(lockClient);
      lockClient.release();
      running = false;
    }
  }

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => clearInterval(timer);
}

async function getAdjustmentSummary(pool, { recentLimit = 20 } = {}) {
  const [sessionsResult, nextResult, lastResult, recapResult, moversResult, compressionResult, feedResult, healthResult] = await Promise.all([
    pool.query(
      `
      SELECT
        s.id,
        s.market_date,
        s.status,
        s.generated_at,
        s.opened_at,
        s.completed_at,
        COUNT(i.id)::INTEGER AS interval_count,
        COUNT(*) FILTER (WHERE i.status = 'scheduled')::INTEGER AS scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'applied')::INTEGER AS applied_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped')::INTEGER AS skipped_count,
        COUNT(*) FILTER (WHERE i.status = 'cancelled')::INTEGER AS cancelled_count
      FROM market.adjustment_sessions s
      LEFT JOIN market.asset_adjustment_intervals i ON i.session_id = s.id
      GROUP BY s.id
      ORDER BY s.market_date DESC
      LIMIT 10
    `
    ),
    pool.query(
      `
      SELECT
        s.id AS session_id,
        s.market_date,
        i.interval_key,
        MIN(i.scheduled_at) AS scheduled_at,
        COUNT(*)::INTEGER AS asset_count
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.status = 'scheduled'
      GROUP BY s.id, s.market_date, i.interval_key
      ORDER BY MIN(i.scheduled_at) ASC
      LIMIT 1
    `
    ),
    pool.query(
      `
      SELECT
        s.id AS session_id,
        s.market_date,
        i.interval_key,
        MIN(i.scheduled_at) AS scheduled_at,
        MAX(i.applied_at) AS applied_at,
        COUNT(*) FILTER (WHERE i.status = 'applied')::INTEGER AS applied_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped')::INTEGER AS skipped_count,
        AVG(ABS((i.price_after - i.price_before) / NULLIF(i.price_before, 0))) FILTER (WHERE i.status = 'applied') AS avg_abs_move_pct
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.status IN ('applied', 'skipped')
        AND i.applied_at IS NOT NULL
      GROUP BY s.id, s.market_date, i.interval_key
      ORDER BY MAX(i.applied_at) DESC
      LIMIT 1
    `
    ),
    pool.query(
      `
      SELECT
        s.id AS session_id,
        s.market_date,
        i.interval_key,
        MIN(i.scheduled_at) AS scheduled_at,
        MAX(i.applied_at) AS applied_at,
        COUNT(*) FILTER (WHERE i.status = 'applied')::INTEGER AS applied_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped')::INTEGER AS skipped_count,
        AVG(ABS((i.price_after - i.price_before) / NULLIF(i.price_before, 0))) FILTER (WHERE i.status = 'applied') AS avg_abs_move_pct,
        NULL::numeric AS avg_gap_compression_pct
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.status IN ('applied', 'skipped')
        AND i.applied_at IS NOT NULL
      GROUP BY s.id, s.market_date, i.interval_key
      ORDER BY MAX(i.applied_at) DESC
      LIMIT 6
    `
    ),
    pool.query(
      `
      WITH applied_moves AS (
        SELECT
          a.symbol,
          a.display_name,
          c.icon,
          c.color,
          i.interval_key,
          i.applied_at,
          i.price_before,
          i.price_after,
          CASE
            WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
            ELSE (i.price_after - i.price_before) / i.price_before
          END AS move_pct,
          NULL::numeric AS gap_compression_pct
        FROM market.asset_adjustment_intervals i
        JOIN market.market_assets a ON a.id = i.asset_id
        JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
        WHERE i.status = 'applied'
          AND i.applied_at >= now() - interval '7 days'
      ),
      positive_moves AS (
        SELECT *
        FROM applied_moves
        WHERE move_pct > 0
        ORDER BY move_pct DESC, applied_at DESC
        LIMIT 5
      ),
      negative_moves AS (
        SELECT *
        FROM applied_moves
        WHERE move_pct < 0
        ORDER BY move_pct ASC, applied_at DESC
        LIMIT 5
      )
      SELECT *
      FROM positive_moves
      UNION ALL
      SELECT *
      FROM negative_moves
    `
    ),
    pool.query(
      `
      SELECT
        a.symbol,
        a.display_name,
        c.icon,
        c.color,
        i.interval_key,
        i.applied_at,
        i.price_before,
        i.price_after,
        CASE
          WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
          ELSE (i.price_after - i.price_before) / i.price_before
        END AS move_pct,
        NULL::numeric AS gap_compression_pct
      FROM market.asset_adjustment_intervals i
      JOIN market.market_assets a ON a.id = i.asset_id
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      WHERE i.status = 'applied'
        AND i.applied_at >= now() - interval '7 days'
      ORDER BY (
        CASE
          WHEN i.price_before IS NULL OR i.base_rate IS NULL OR ABS(i.price_before - i.base_rate) = 0 THEN NULL
          ELSE (ABS(i.price_before - i.base_rate) - ABS(i.price_after - i.base_rate)) / ABS(i.price_before - i.base_rate)
        END
      ) DESC NULLS LAST, i.applied_at DESC
      LIMIT 8
    `
    ),
    pool.query(
      `
      SELECT
        i.id,
        s.market_date,
        a.symbol,
        a.display_name,
        c.icon,
        c.color,
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.status,
        i.price_before,
        i.price_after,
        i.metadata_json->>'skip_reason' AS skip_reason,
        CASE
          WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
          ELSE (i.price_after - i.price_before) / i.price_before
        END AS move_pct
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      JOIN market.market_assets a ON a.id = i.asset_id
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      WHERE i.status IN ('applied', 'skipped')
      ORDER BY COALESCE(i.applied_at, i.updated_at, i.scheduled_at) DESC, i.id DESC
      LIMIT $1
    `,
      [Math.max(1, Math.min(100, Number(recentLimit) || 20))]
    ),
    pool.query(
      `
      SELECT
        MIN(i.scheduled_at) FILTER (WHERE i.status = 'scheduled') AS next_scheduled_at,
        MAX(i.applied_at) FILTER (WHERE i.status = 'applied') AS last_applied_at,
        COUNT(*) FILTER (WHERE i.status = 'scheduled' AND i.scheduled_at < now() - interval '10 minutes')::INTEGER AS overdue_scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'scheduled')::INTEGER AS scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped' AND i.applied_at >= now() - interval '24 hours')::INTEGER AS skipped_24h_count,
        COUNT(*) FILTER (WHERE i.status = 'applied' AND i.applied_at >= now() - interval '24 hours')::INTEGER AS applied_24h_count
      FROM market.asset_adjustment_intervals i
    `
    ),
  ]);

  return {
    generated_at: new Date().toISOString(),
    timezone: getTimeZone(),
    sessions: sessionsResult.rows,
    next_tick: nextResult.rows[0] || null,
    last_tick: lastResult.rows[0] || null,
    recaps: recapResult.rows,
    leaderboards: {
      movers: moversResult.rows,
      gap_compression: compressionResult.rows,
    },
    feed: feedResult.rows,
    health: healthResult.rows[0] || null,
  };
}

async function getAssetAdjustmentHistory(pool, symbol, { limit = 20, recentLimit = null, upcomingLimit = null } = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const boundedRecentLimit = recentLimit === null
    ? boundedLimit
    : Math.max(1, Math.min(20, Number(recentLimit) || 5));
  const boundedUpcomingLimit = upcomingLimit === null
    ? 0
    : Math.max(0, Math.min(10, Number(upcomingLimit) || 0));
  const { rows } = await pool.query(
    `
    WITH asset AS (
      SELECT id
      FROM market.market_assets
      WHERE symbol = $1
      LIMIT 1
    ),
    upcoming AS (
      SELECT
        i.id,
        s.market_date,
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.status,
        i.price_before,
        i.price_after,
        i.metadata_json->>'skip_reason' AS skip_reason,
        CASE
          WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
          ELSE (i.price_after - i.price_before) / i.price_before
        END AS move_pct,
        NULL::numeric AS gap_compression_pct,
        0 AS section_order,
        ROW_NUMBER() OVER (ORDER BY i.scheduled_at ASC, i.id ASC) AS row_order
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      JOIN asset a ON a.id = i.asset_id
      WHERE i.status = 'scheduled'
      ORDER BY i.scheduled_at ASC, i.id ASC
      LIMIT $2
    ),
    recent AS (
      SELECT
        i.id,
        s.market_date,
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.status,
        i.price_before,
        i.price_after,
        i.metadata_json->>'skip_reason' AS skip_reason,
        CASE
          WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
          ELSE (i.price_after - i.price_before) / i.price_before
        END AS move_pct,
        NULL::numeric AS gap_compression_pct,
        1 AS section_order,
        ROW_NUMBER() OVER (ORDER BY i.scheduled_at DESC, i.id DESC) AS row_order
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      JOIN asset a ON a.id = i.asset_id
      WHERE i.status <> 'scheduled'
      ORDER BY i.scheduled_at DESC, i.id DESC
      LIMIT $3
    )
    SELECT
      id,
      market_date,
      interval_key,
      scheduled_at,
      applied_at,
      status,
      price_before,
      price_after,
      skip_reason,
      move_pct,
      gap_compression_pct
    FROM (
      SELECT * FROM upcoming
      UNION ALL
      SELECT * FROM recent
    ) combined
    ORDER BY section_order ASC, row_order ASC
  `,
    [normalizedSymbol, boundedUpcomingLimit, boundedRecentLimit]
  );

  return { symbol: normalizedSymbol, items: rows };
}

async function listAdminAdjustmentSessions(pool, { limit = 30 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
      s.id,
      s.market_date,
      s.status,
      s.generated_at,
      s.opened_at,
      s.completed_at,
      COUNT(i.id)::INTEGER AS interval_count,
      COUNT(DISTINCT i.asset_id)::INTEGER AS asset_count,
      COUNT(*) FILTER (WHERE i.status = 'scheduled')::INTEGER AS scheduled_count,
      COUNT(*) FILTER (WHERE i.status = 'applied')::INTEGER AS applied_count,
      COUNT(*) FILTER (WHERE i.status = 'skipped')::INTEGER AS skipped_count,
      COUNT(*) FILTER (WHERE i.status = 'cancelled')::INTEGER AS cancelled_count,
      MIN(i.scheduled_at) AS first_scheduled_at,
      MAX(i.scheduled_at) AS last_scheduled_at,
      MAX(i.applied_at) AS last_applied_at,
      ROUND(
        100 * COUNT(*) FILTER (WHERE i.status IN ('applied', 'skipped', 'cancelled'))::numeric / NULLIF(COUNT(i.id), 0),
        2
      ) AS completion_pct
    FROM market.adjustment_sessions s
    LEFT JOIN market.asset_adjustment_intervals i ON i.session_id = s.id
    GROUP BY s.id
    ORDER BY s.market_date DESC, s.id DESC
    LIMIT $1
  `,
    [Math.max(1, Math.min(100, Number(limit) || 30))]
  );

  return { sessions: rows };
}

async function getAdminAdjustmentSession(pool, sessionId) {
  const numericSessionId = Number(sessionId);
  const [sessionResult, intervalsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        s.id,
        s.market_date,
        s.status,
        s.generated_at,
        s.opened_at,
        s.completed_at,
        COUNT(i.id)::INTEGER AS interval_count,
        COUNT(DISTINCT i.asset_id)::INTEGER AS asset_count,
        COUNT(*) FILTER (WHERE i.status = 'scheduled')::INTEGER AS scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'applied')::INTEGER AS applied_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped')::INTEGER AS skipped_count,
        COUNT(*) FILTER (WHERE i.status = 'cancelled')::INTEGER AS cancelled_count,
        ROUND(
          100 * COUNT(*) FILTER (WHERE i.status IN ('applied', 'skipped', 'cancelled'))::numeric / NULLIF(COUNT(i.id), 0),
          2
        ) AS completion_pct
      FROM market.adjustment_sessions s
      LEFT JOIN market.asset_adjustment_intervals i ON i.session_id = s.id
      WHERE s.id = $1
      GROUP BY s.id
    `,
      [numericSessionId]
    ),
    pool.query(
      `
      SELECT
        i.id,
        i.session_id,
        i.asset_id,
        a.symbol,
        a.display_name,
        c.icon,
        c.color,
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.status,
        i.strength_pct,
        i.base_rate,
        i.price_before,
        i.price_after,
        i.metadata_json,
        i.metadata_json->>'skip_reason' AS skip_reason,
        e.id AS price_event_id,
        e.ts AS price_event_at,
        CASE
          WHEN i.price_before IS NULL OR i.price_before = 0 THEN NULL
          ELSE (i.price_after - i.price_before) / i.price_before
        END AS move_pct,
        CASE
          WHEN i.price_before IS NULL OR i.base_rate IS NULL OR ABS(i.price_before - i.base_rate) = 0 THEN NULL
          ELSE (ABS(i.price_before - i.base_rate) - ABS(i.price_after - i.base_rate)) / ABS(i.price_before - i.base_rate)
        END AS gap_compression_pct
      FROM market.asset_adjustment_intervals i
      JOIN market.market_assets a ON a.id = i.asset_id
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      LEFT JOIN market.asset_price_events e
        ON e.asset_id = i.asset_id
       AND e.event_type = 'interval_adjustment'
       AND e.metadata_json->>'adjustment_interval_id' = i.id::text
      WHERE i.session_id = $1
      ORDER BY a.symbol ASC,
        CASE i.interval_key
          WHEN 'open' THEN 1
          WHEN 'lunch' THEN 2
          WHEN 'late' THEN 3
          WHEN 'overnight' THEN 4
          ELSE 9
        END ASC
    `,
      [numericSessionId]
    ),
  ]);

  return {
    session: sessionResult.rows[0] || null,
    intervals: intervalsResult.rows,
  };
}

async function getAdminAdjustmentHealth(pool) {
  const [healthResult, lockResult] = await Promise.all([
    pool.query(
      `
      SELECT
        MIN(i.scheduled_at) FILTER (WHERE i.status = 'scheduled') AS next_scheduled_at,
        MAX(i.applied_at) FILTER (WHERE i.status = 'applied') AS last_applied_at,
        COUNT(*) FILTER (WHERE i.status = 'scheduled')::INTEGER AS scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'scheduled' AND i.scheduled_at < now() - interval '10 minutes')::INTEGER AS overdue_scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'scheduled' AND i.scheduled_at < now() - interval '1 hour')::INTEGER AS stuck_scheduled_count,
        COUNT(*) FILTER (WHERE i.status = 'applied' AND i.applied_at >= now() - interval '24 hours')::INTEGER AS applied_24h_count,
        COUNT(*) FILTER (WHERE i.status = 'skipped' AND i.applied_at >= now() - interval '24 hours')::INTEGER AS skipped_24h_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('scheduled', 'active'))::INTEGER AS open_session_count
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
    `
    ),
    pool.query(
      `
      SELECT COUNT(*)::INTEGER AS lock_count
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND objid = $1
    `,
      [ADJUSTMENT_SCHEDULER_LOCK_KEY]
    ),
  ]);

  return {
    ...(healthResult.rows[0] || {}),
    scheduler_lock_held: Number(lockResult.rows[0]?.lock_count || 0) > 0,
    scheduler_interval_ms: Math.max(10_000, Number(process.env.MARKET_ADJUSTMENT_SCHEDULER_INTERVAL_MS || 60_000)),
    scheduler_enabled: (process.env.MARKET_ADJUSTMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
  };
}

module.exports = {
  INTERVALS,
  INTERVAL_STRENGTH_TOTAL_PCT,
  applyDueAdjustments,
  ensureAdjustmentSession,
  forceNextAdjustment,
  getAdminAdjustmentHealth,
  getAdminAdjustmentSession,
  listAdminAdjustmentSessions,
  getAdjustmentSummary,
  getAssetAdjustmentHistory,
  generateStrengths,
  getIntervalSchedule,
  startAdjustmentScheduler,
};
