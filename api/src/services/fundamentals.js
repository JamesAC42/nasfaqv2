const { bootstrapAssetsWithClient } = require("./marketAdmin");
const { REFERENCE_SUPPLY } = require("./marketSupply");
const FAIR_VALUE_SCALE_MULTIPLIER = Number(process.env.MARKET_PRICE_SCALE_MULTIPLIER || 100);
const DEFAULT_MARKET_DATA_TIME_ZONE = "America/New_York";
const SMOOTHING_PREVIOUS_WEIGHT = 0.4;
const SMOOTHING_RAW_WEIGHT = 0.6;
const FAIR_VALUE_MOVE_CAP_MIN = 0.75;
const FAIR_VALUE_MOVE_CAP_MAX = 1.25;

// Big streams lift that day's momentum once; smoothing then lets it fade over the next few days.
// Keys are stream events from content.wire_stream_labels (keywords, confirmed by Jev when set up).
const STREAM_EVENT_WEIGHTS = {
  three_d: 0.25,
  new_outfit: 0.2,
  original_song: 0.2,
  anniversary: 0.15,
  birthday: 0.1,
  milestone: 0.1,
  cover_song: 0.06,
};
const STREAM_EVENT_CAP = 0.3;

// Debut mode (docs/market/ipo.md), for a talent listed by an IPO until she has 45 days of our stats.
// The normal size term needs 30-day views and the growth signals need a 35-day baseline, so a young
// channel would be priced ~3x low and then jump. In debut mode her size uses the trailing week's views
// scaled to a month, the growth signals are 0 (uploads and big streams still count), and from day 35
// she blends into the normal formula over ten days.
const DEBUT_BLEND_START_DAYS = 35;
const DEBUT_BLEND_DAYS = 10;
const DEBUT_UNCAPPED_DAYS = 7; // her first week's estimate firms up daily, so the daily move cap waits

/** How much of the debut formula applies at this age in days (1 until day 35, 0 from day 45). */
function debutShare(age) {
  if (!Number.isFinite(age) || age < 0) return 0;
  if (age < DEBUT_BLEND_START_DAYS) return 1;
  return clamp(1 - (age - DEBUT_BLEND_START_DAYS) / DEBUT_BLEND_DAYS, 0, 1);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);
}

/**
 * A young channel's monthly views: the trailing week's views (fewer days early on) scaled to 30 days.
 * Once she has three days past her first tracked week, that first week (the debut spike) is left out.
 */
function estimateDebutMonthlyViews(current, historyByDate, age) {
  const startAge = age >= 10 ? Math.max(age - 7, 7) : Math.max(age - 7, 0);
  const days = age - startAge;
  if (days < 1) return null;
  const start = historyByDate.get(shiftDateKey(current.snapshot_date, -days)) || null;
  if (!start) return null;
  return Math.max(current.view_count - start.view_count, 0) * (30 / days);
}
const streamEventsEnabled = () => String(process.env.MARKET_STREAM_EVENTS || "").toLowerCase() !== "off";

function getQueryTimeZone() {
  const candidate = String(process.env.MARKET_DATA_TIMEZONE || process.env.SCRAPE_TIMEZONE || DEFAULT_MARKET_DATA_TIME_ZONE).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_MARKET_DATA_TIME_ZONE;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftInputDate(dateKey, days) {
  if (!dateKey) return null;
  return shiftDateKey(dateKey, days);
}

function compareDateKeys(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dateRange(startDateKey, endDateKey) {
  const out = [];
  let current = startDateKey;
  while (compareDateKeys(current, endDateKey) <= 0) {
    out.push(current);
    current = shiftDateKey(current, 1);
  }
  return out;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFundamentalToPrice(fundamentalValue, maxSupply) {
  const supply = Math.max(numberOrNull(maxSupply) || 0, 1);
  const raw = numberOrNull(fundamentalValue);
  if (raw === null) return null;
  return (raw / supply) * FAIR_VALUE_SCALE_MULTIPLIER;
}

function clampFairValueMove(nextValue, previousValue) {
  if (!(previousValue > 0) || !(nextValue > 0)) return nextValue;
  return clamp(nextValue, previousValue * FAIR_VALUE_MOVE_CAP_MIN, previousValue * FAIR_VALUE_MOVE_CAP_MAX);
}

function toSnapshotPoint(row) {
  return {
    youtube_channel_id: row.youtube_channel_id,
    snapshot_date: row.snapshot_date,
    subscriber_count: row.subscriber_count === null ? null : Number(row.subscriber_count),
    view_count: row.view_count === null ? null : Number(row.view_count),
    video_count: row.video_count === null ? null : Number(row.video_count),
    has_video_count_data: row.video_count !== null && row.video_count !== undefined,
  };
}

function validateRawSnapshot(point) {
  if (point.subscriber_count === null || point.view_count === null) {
    return "missing_raw_counts";
  }
  if (
    point.subscriber_count < 0 ||
    point.view_count < 0 ||
    (point.video_count !== null && point.video_count !== undefined && point.video_count < 0)
  ) {
    return "negative_raw_counts";
  }
  return null;
}

function computeSubscriberSignal(current, prev7, prev30) {
  if (!current || !prev7) return 0;
  const delta7d = current.subscriber_count - prev7.subscriber_count;
  const baseSubscribers = Math.max(prev7.subscriber_count, 10_000);
  const recentRate = delta7d / baseSubscribers;

  if (!prev30) {
    return clamp(recentRate * 36, -0.5, 0.5);
  }

  const priorDelta = prev7.subscriber_count - prev30.subscriber_count;
  const priorBaseSubscribers = Math.max(prev30.subscriber_count, 10_000);
  const priorRate = priorDelta / priorBaseSubscribers;
  return clamp((recentRate * 34) + ((recentRate - priorRate) * 14), -0.5, 0.5);
}

function computeStagnationSignal(current, prev7, prev30) {
  if (!current || !prev7 || !prev30) return 0;

  const subDelta30d = current.subscriber_count - prev30.subscriber_count;
  const viewDelta30d = current.view_count - prev30.view_count;
  const subBase = Math.max(prev30.subscriber_count, 10_000);
  const viewBase = Math.max(prev30.view_count, 100_000);

  const subTrend = subDelta30d / subBase;
  const viewTrend = viewDelta30d / viewBase;

  if (subTrend > 0.002 || viewTrend > 0.015) {
    return 0;
  }

  return -clamp((Math.abs(subTrend) * 20) + (Math.max(0, 0.01 - viewTrend) * 2.5) + 0.06, 0, 0.32);
}

function computeUploadSignal(currentDate, historyByDate) {
  const current = historyByDate.get(currentDate) || null;
  const prev1 = historyByDate.get(shiftDateKey(currentDate, -1)) || null;
  if (!current?.has_video_count_data || !prev1?.has_video_count_data) {
    return {
      videoDelta7d: null,
      videoDelta30d: null,
      uploadSignal: 0,
    };
  }

  const videoDelta1d = current.video_count - prev1.video_count;
  const prev7 = historyByDate.get(shiftDateKey(currentDate, -7)) || null;
  const prev30 = historyByDate.get(shiftDateKey(currentDate, -30)) || null;
  const videoDelta7d =
    prev7?.has_video_count_data ? current.video_count - prev7.video_count : null;
  const videoDelta30d =
    prev30?.has_video_count_data ? current.video_count - prev30.video_count : null;

  if (videoDelta1d < 0) {
    return {
      videoDelta7d,
      videoDelta30d,
      uploadSignal: 0,
    };
  }

  let streakDays = 0;
  let inactiveDays = 0;

  if (videoDelta1d > 0) {
    streakDays = 1;
    let cursor = currentDate;
    while (streakDays < 7) {
      const day = historyByDate.get(cursor) || null;
      const prevDayDate = shiftDateKey(cursor, -1);
      const prevDay = historyByDate.get(prevDayDate) || null;
      if (!day?.has_video_count_data || !prevDay?.has_video_count_data) break;
      const delta = day.video_count - prevDay.video_count;
      if (delta <= 0) break;
      if (cursor !== currentDate) {
        streakDays += 1;
      }
      cursor = prevDayDate;
    }
    return {
      videoDelta7d,
      videoDelta30d,
      uploadSignal: clamp((streakDays / 4) * 0.18, 0, 0.18),
    };
  }

  inactiveDays = 1;
  let cursor = currentDate;
  while (inactiveDays < 14) {
    const day = historyByDate.get(cursor) || null;
    const prevDayDate = shiftDateKey(cursor, -1);
    const prevDay = historyByDate.get(prevDayDate) || null;
    if (!day?.has_video_count_data || !prevDay?.has_video_count_data) break;
    const delta = day.video_count - prevDay.video_count;
    if (delta !== 0) break;
    if (cursor !== currentDate) {
      inactiveDays += 1;
    }
    cursor = prevDayDate;
  }

  return {
    videoDelta7d,
    videoDelta30d,
    uploadSignal: -clamp(((inactiveDays - 1) / 8) * 0.28, 0, 0.28),
  };
}

/** One day's event lift from the kinds of big stream that started that day. */
function streamEventSignal(kinds) {
  const unique = [...new Set(kinds ?? [])].filter((kind) => STREAM_EVENT_WEIGHTS[kind]);
  const signal = Math.min(STREAM_EVENT_CAP, unique.reduce((sum, kind) => sum + STREAM_EVENT_WEIGHTS[kind], 0));
  return { signal, kinds: unique.sort((a, b) => STREAM_EVENT_WEIGHTS[b] - STREAM_EVENT_WEIGHTS[a]) };
}

/**
 * channel → date (market time zone) → event kinds, for streams that actually started in the
 * window. Empty when the Wire hasn't labeled anything (or MARKET_STREAM_EVENTS=off).
 */
async function loadStreamEvents(client, { from = null, to = null, channelId = null } = {}) {
  const out = new Map();
  if (!streamEventsEnabled()) return out;
  // Before the Wire's tables exist there's simply nothing to add (and a failed query would abort
  // the caller's transaction, so check first).
  const exists = await client.query(`SELECT to_regclass('content.wire_stream_labels') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return out;
  const { rows } = await client.query(
    `
    SELECT s.youtube_channel_id, to_char((s.actual_start_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, array_agg(DISTINCT l.event) AS kinds
    FROM yt.livestream_sessions s
    JOIN content.wire_stream_labels l ON l.video_id = s.video_id
    WHERE s.actual_start_at IS NOT NULL
      AND l.event = ANY($2::text[])
      AND ($3::date IS NULL OR (s.actual_start_at AT TIME ZONE $1)::date >= $3::date)
      AND ($4::date IS NULL OR (s.actual_start_at AT TIME ZONE $1)::date <= $4::date)
      AND ($5::text IS NULL OR s.youtube_channel_id = $5)
    GROUP BY 1, 2
  `,
    [getQueryTimeZone(), Object.keys(STREAM_EVENT_WEIGHTS), from, to, channelId]
  );
  for (const row of rows) {
    if (!out.has(row.youtube_channel_id)) out.set(row.youtube_channel_id, new Map());
    out.get(row.youtube_channel_id).set(row.day, row.kinds);
  }
  return out;
}

function computeDerivedSnapshot(current, historyByDate, previousDerived, version, eventKinds = null, debut = null) {
  const currentDate = current.snapshot_date;
  const debutAge = debut?.trackedSince ? daysBetween(debut.trackedSince, currentDate) : null;
  const debutWeight = debutAge === null ? 0 : debutShare(debutAge);
  const prev1 = historyByDate.get(shiftDateKey(currentDate, -1)) || null;
  const prev7 = historyByDate.get(shiftDateKey(currentDate, -7)) || null;
  const prev30 = historyByDate.get(shiftDateKey(currentDate, -30)) || null;
  const prev35 = historyByDate.get(shiftDateKey(currentDate, -35)) || null;

  const viewDelta1d = prev1 ? current.view_count - prev1.view_count : null;
  const viewDelta7d = prev7 ? current.view_count - prev7.view_count : null;
  const viewDelta30d = prev30 ? current.view_count - prev30.view_count : null;
  const { videoDelta7d, videoDelta30d, uploadSignal } = computeUploadSignal(currentDate, historyByDate);

  const estimatedSubDelta7d = prev7 ? current.subscriber_count - prev7.subscriber_count : null;
  const estimatedSubDelta30d = prev30 ? current.subscriber_count - prev30.subscriber_count : null;

  const viewRecent = viewDelta7d !== null ? viewDelta7d / 7 : 0;
  const viewBase = prev7 && prev35 ? Math.max((prev7.view_count - prev35.view_count) / 28, 100) : 100;

  const normalSizeAnchor =
    Math.pow(Math.max(current.subscriber_count, 1), 0.42) *
    Math.pow(Math.max(viewDelta30d ?? 1, 1), 0.08);
  const debutMonthlyViews = debutWeight > 0 ? estimateDebutMonthlyViews(current, historyByDate, debutAge) : null;
  const debutSizeAnchor =
    Math.pow(Math.max(current.subscriber_count, 1), 0.42) *
    Math.pow(Math.max(debutMonthlyViews ?? 1, 1), 0.08);
  const sizeAnchorRaw = debutWeight * debutSizeAnchor + (1 - debutWeight) * normalSizeAnchor;

  const viewSignalRaw = Math.log(Math.max(viewRecent, 100) / Math.max(viewBase, 100));
  const viewSignal = clamp(viewSignalRaw, -0.4, 0.4) * (1 - debutWeight);
  const subSignal = computeSubscriberSignal(current, prev7, prev30) * (1 - debutWeight);
  const stagnationSignal = computeStagnationSignal(current, prev7, prev30) * (1 - debutWeight);

  const event = streamEventSignal(eventKinds);
  const rawMomentum = 0.58 * viewSignal + 0.3 * subSignal + 0.12 * uploadSignal + stagnationSignal + event.signal;
  const momentumRaw = clamp(rawMomentum, -1.35, 1.35);
  const momentumMultiplier = Math.exp(0.35 * momentumRaw);
  const fundamentalValueRaw = sizeAnchorRaw * momentumMultiplier;
  const previousSmoothed = previousDerived?.fundamental_value_smoothed ?? null;
  const uncappedFundamentalValueSmoothed =
    previousSmoothed === null
      ? fundamentalValueRaw
      : (SMOOTHING_PREVIOUS_WEIGHT * previousSmoothed) + (SMOOTHING_RAW_WEIGHT * fundamentalValueRaw);
  const fundamentalValueSmoothed =
    debutWeight > 0 && debutAge < DEBUT_UNCAPPED_DAYS
      ? uncappedFundamentalValueSmoothed
      : clampFairValueMove(uncappedFundamentalValueSmoothed, previousSmoothed);

  return {
    ...current,
    view_delta_1d: viewDelta1d,
    view_delta_7d: viewDelta7d,
    view_delta_30d: viewDelta30d,
    video_delta_7d: videoDelta7d,
    video_delta_30d: videoDelta30d,
    estimated_sub_delta_7d: estimatedSubDelta7d,
    estimated_sub_delta_30d: estimatedSubDelta30d,
    size_anchor_raw: sizeAnchorRaw,
    view_signal: viewSignal,
    upload_signal: uploadSignal,
    sub_signal: subSignal,
    event_signal: event.signal,
    event_kinds: event.kinds.length ? event.kinds : null,
    momentum_raw: momentumRaw,
    momentum_multiplier: momentumMultiplier,
    fundamental_value_raw: fundamentalValueRaw,
    fundamental_value_smoothed: fundamentalValueSmoothed,
    calculation_version: version,
    calculation_status: "complete",
    calculation_error: null,
  };
}

/** Talents listed by an IPO, with the first day we have stats for (debut mode counts from there). */
async function loadDebutChannels(client) {
  const { rows } = await client.query(
    `
    SELECT a.youtube_channel_id, MIN(timezone($1, s.time)::date)::text AS tracked_since
    FROM market.ipo_listings l
    JOIN market.market_assets a ON a.id = l.asset_id
    JOIN yt.youtube_channel_daily_stats s ON s.youtube_channel_id = a.youtube_channel_id
    WHERE l.status <> 'cancelled'
    GROUP BY a.youtube_channel_id
  `,
    [getQueryTimeZone()]
  );
  return new Map(rows.map((row) => [row.youtube_channel_id, { trackedSince: row.tracked_since }]));
}

async function loadHistoricalDailyStats(client, { from = null, to = null, channelId = null, activeOnly = false } = {}) {
  const params = [getQueryTimeZone()];
  const where = [];
  const dayExpr = `timezone($1, s.time)::date`;

  if (from) {
    params.push(from);
    where.push(`${dayExpr} >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`${dayExpr} <= $${params.length}::date`);
  }
  if (channelId) {
    params.push(channelId);
    where.push(`s.youtube_channel_id = $${params.length}`);
  }
  if (activeOnly) {
    where.push(`c.is_active = true`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await client.query(
    `
    WITH ranked AS (
      SELECT DISTINCT ON (s.youtube_channel_id, ${dayExpr})
        s.youtube_channel_id,
        ${dayExpr} AS day,
        s.subscriber_count,
        s.view_count,
        s.video_count
      FROM yt.youtube_channel_daily_stats s
      JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
      ${whereSql}
      ORDER BY s.youtube_channel_id, ${dayExpr}, s.time DESC
    )
    SELECT
      youtube_channel_id,
      day::text AS snapshot_date,
      subscriber_count,
      view_count,
      video_count
    FROM ranked
    ORDER BY youtube_channel_id ASC, day ASC
  `,
    params
  );

  return rows.map(toSnapshotPoint);
}

function densifyDailyStats(rows, { from = null, to = null, fillMissingDates = true } = {}) {
  if (!fillMissingDates || rows.length === 0) return rows;

  const firstDate = rows[0].snapshot_date;
  const lastDate = rows[rows.length - 1].snapshot_date;
  const startDate = from && compareDateKeys(from, firstDate) > 0 ? from : firstDate;
  const endDate = to && compareDateKeys(to, lastDate) < 0 ? to : lastDate;
  const rowByDate = new Map(rows.map((row) => [row.snapshot_date, row]));
  const dense = [];
  let lastKnown = null;

  for (const dateKey of dateRange(startDate, endDate)) {
    const existing = rowByDate.get(dateKey) || null;
    if (existing) {
      lastKnown = existing;
      dense.push(existing);
      continue;
    }

    if (!lastKnown) {
      continue;
    }

    dense.push({
      ...lastKnown,
      snapshot_date: dateKey,
      video_count: null,
      has_video_count_data: false,
    });
  }

  return dense;
}

// Snapshots per statement: a full recalculation writes ~20k (every talent, every day), and one
// round trip each took minutes against the hosted database.
const SNAPSHOT_BATCH = 1000;

const SNAPSHOT_COLUMNS = [
  "youtube_channel_id",
  "snapshot_date",
  "subscriber_count",
  "view_count",
  "video_count",
  "view_delta_1d",
  "view_delta_7d",
  "view_delta_30d",
  "video_delta_7d",
  "video_delta_30d",
  "estimated_sub_delta_7d",
  "estimated_sub_delta_30d",
  "size_anchor_raw",
  "view_signal",
  "upload_signal",
  "sub_signal",
  "momentum_raw",
  "momentum_multiplier",
  "fundamental_value_raw",
  "fundamental_value_smoothed",
  "calculation_version",
  "calculation_status",
  "calculation_error",
  "event_signal",
  "event_kinds",
];

function snapshotRow(snapshot) {
  return {
    youtube_channel_id: snapshot.youtube_channel_id,
    snapshot_date: snapshot.snapshot_date,
    subscriber_count: snapshot.subscriber_count,
    view_count: snapshot.view_count,
    video_count: snapshot.video_count,
    view_delta_1d: numberOrNull(snapshot.view_delta_1d),
    view_delta_7d: numberOrNull(snapshot.view_delta_7d),
    view_delta_30d: numberOrNull(snapshot.view_delta_30d),
    video_delta_7d: numberOrNull(snapshot.video_delta_7d),
    video_delta_30d: numberOrNull(snapshot.video_delta_30d),
    estimated_sub_delta_7d: numberOrNull(snapshot.estimated_sub_delta_7d),
    estimated_sub_delta_30d: numberOrNull(snapshot.estimated_sub_delta_30d),
    size_anchor_raw: snapshot.size_anchor_raw,
    view_signal: snapshot.view_signal,
    upload_signal: snapshot.upload_signal,
    sub_signal: snapshot.sub_signal,
    momentum_raw: snapshot.momentum_raw,
    momentum_multiplier: snapshot.momentum_multiplier,
    fundamental_value_raw: snapshot.fundamental_value_raw,
    fundamental_value_smoothed: snapshot.fundamental_value_smoothed,
    calculation_version: snapshot.calculation_version,
    calculation_status: snapshot.calculation_status,
    calculation_error: snapshot.calculation_error,
    event_signal: snapshot.event_signal ?? 0,
    event_kinds: snapshot.event_kinds ?? null,
  };
}

// JSON has no NaN or Infinity; as strings they reach the numeric columns the way a query parameter would.
const keepNonFinite = (_key, value) => (typeof value === "number" && !Number.isFinite(value) ? String(value) : value);

/**
 * Writes calculated snapshots (insert, or update the channel's row for that day), SNAPSHOT_BATCH per
 * statement. A (channel, day) that appears twice keeps the later one, as writing them in order would.
 */
async function upsertCalculatedSnapshots(client, snapshots) {
  const latest = new Map();
  for (const snapshot of snapshots) latest.set(`${snapshot.youtube_channel_id}|${snapshot.snapshot_date}`, snapshot);
  const rows = [...latest.values()].map(snapshotRow);
  const columns = SNAPSHOT_COLUMNS.join(", ");
  for (let start = 0; start < rows.length; start += SNAPSHOT_BATCH) {
    await client.query(
      `
      INSERT INTO market.channel_daily_snapshots (${columns}, updated_at)
      SELECT ${columns}, now()
      FROM jsonb_populate_recordset(NULL::market.channel_daily_snapshots, $1::jsonb)
      ON CONFLICT (youtube_channel_id, snapshot_date)
    DO UPDATE SET
      subscriber_count = EXCLUDED.subscriber_count,
      view_count = EXCLUDED.view_count,
      video_count = EXCLUDED.video_count,
      view_delta_1d = EXCLUDED.view_delta_1d,
      view_delta_7d = EXCLUDED.view_delta_7d,
      view_delta_30d = EXCLUDED.view_delta_30d,
      video_delta_7d = EXCLUDED.video_delta_7d,
      video_delta_30d = EXCLUDED.video_delta_30d,
      estimated_sub_delta_7d = EXCLUDED.estimated_sub_delta_7d,
      estimated_sub_delta_30d = EXCLUDED.estimated_sub_delta_30d,
      size_anchor_raw = EXCLUDED.size_anchor_raw,
      view_signal = EXCLUDED.view_signal,
      upload_signal = EXCLUDED.upload_signal,
      sub_signal = EXCLUDED.sub_signal,
      momentum_raw = EXCLUDED.momentum_raw,
      momentum_multiplier = EXCLUDED.momentum_multiplier,
      fundamental_value_raw = EXCLUDED.fundamental_value_raw,
      fundamental_value_smoothed = EXCLUDED.fundamental_value_smoothed,
      calculation_version = EXCLUDED.calculation_version,
      calculation_status = EXCLUDED.calculation_status,
      calculation_error = EXCLUDED.calculation_error,
      event_signal = EXCLUDED.event_signal,
      event_kinds = EXCLUDED.event_kinds,
      updated_at = now()
    `,
      [JSON.stringify(rows.slice(start, start + SNAPSHOT_BATCH), keepNonFinite)]
    );
  }
  return rows.length;
}

async function refreshLatestAssetFairValues(client) {
  const result = await client.query(
    `
    UPDATE market.market_assets a
    SET
      latest_snapshot_date = s.snapshot_date,
      latest_snapshot_id = s.id,
      current_fair_value = (s.fundamental_value_smoothed / ${REFERENCE_SUPPLY}) * $1,
      current_fair_value_raw = (s.fundamental_value_raw / ${REFERENCE_SUPPLY}) * $1,
      updated_at = now()
    FROM (
      SELECT DISTINCT ON (youtube_channel_id)
        id,
        youtube_channel_id,
        snapshot_date,
        fundamental_value_raw,
        fundamental_value_smoothed
      FROM market.channel_daily_snapshots
      WHERE calculation_status = 'complete'
      ORDER BY youtube_channel_id, snapshot_date DESC
    ) s
    WHERE a.youtube_channel_id = s.youtube_channel_id
  `,
    [FAIR_VALUE_SCALE_MULTIPLIER]
  );

  return result.rowCount || 0;
}

async function createCalculationRun(client, { from, to, version, channelId, activeOnly }) {
  const { rows } = await client.query(
    `
    INSERT INTO market.fundamental_calculation_runs (
      requested_from,
      requested_to,
      version,
      youtube_channel_id,
      active_only,
      status
    ) VALUES ($1,$2,$3,$4,$5,'started')
    RETURNING id
  `,
    [from, to, version, channelId, activeOnly]
  );

  return rows[0].id;
}

async function completeCalculationRun(client, runId, payload) {
  await client.query(
    `
    UPDATE market.fundamental_calculation_runs
    SET
      status = 'completed',
      channels_processed = $2,
      snapshots_processed = $3,
      failed_snapshots = $4,
      assets_updated = $5,
      error_text = $6,
      completed_at = now()
    WHERE id = $1
  `,
    [runId, payload.channelsProcessed, payload.snapshotsProcessed, payload.failedSnapshots, payload.assetsUpdated, payload.errorText]
  );
}

async function failCalculationRun(pool, runId, errorText) {
  if (!runId) return;
  await pool.query(
    `
    UPDATE market.fundamental_calculation_runs
    SET
      status = 'failed',
      error_text = $2,
      completed_at = now()
    WHERE id = $1
  `,
    [runId, errorText]
  );
}

async function listFundamentalsJobs(pool) {
  const [formulaVersionsResult, snapshotStatusResult, calculationRunsResult, settlementRunsResult] = await Promise.all([
    pool.query(
      `
      SELECT version, name, description, parameters_json, created_at
      FROM market.fundamental_formula_versions
      ORDER BY version DESC
    `
    ),
    pool.query(
      `
      SELECT
        calculation_status,
        calculation_version,
        COUNT(*)::BIGINT AS row_count,
        MAX(snapshot_date) AS latest_snapshot_date
      FROM market.channel_daily_snapshots
      GROUP BY calculation_status, calculation_version
      ORDER BY calculation_status ASC, calculation_version DESC NULLS LAST
    `
    ),
    pool.query(
      `
      SELECT
        id,
        requested_from,
        requested_to,
        version,
        youtube_channel_id,
        active_only,
        status,
        channels_processed,
        snapshots_processed,
        failed_snapshots,
        assets_updated,
        error_text,
        created_at,
        completed_at
      FROM market.fundamental_calculation_runs
      ORDER BY id DESC
      LIMIT 20
    `
    ),
    pool.query(
      `
      SELECT id, market_date, source_market_date, status, started_at, completed_at, error_text
      FROM market.market_settlement_runs
      ORDER BY market_date DESC
      LIMIT 20
    `
    ),
  ]);

  return {
    formula_versions: formulaVersionsResult.rows,
    snapshot_status: snapshotStatusResult.rows,
    calculation_runs: calculationRunsResult.rows,
    settlement_runs: settlementRunsResult.rows,
  };
}

async function recalculateFundamentals(pool, { from = null, to = null, version = 1, channelId = null, activeOnly = false, fillMissingDates = true } = {}) {
  const client = await pool.connect();
  let runId = null;

  try {
    await client.query("BEGIN");
    runId = await createCalculationRun(client, { from, to, version, channelId, activeOnly });
    const bootstrapResult = await bootstrapAssetsWithClient(client, { activeOnly: true, syncExisting: true });

    const bufferedFrom = shiftInputDate(from, -35);
    const statsRows = await loadHistoricalDailyStats(client, { from: bufferedFrom, to, channelId, activeOnly });
    const streamEvents = await loadStreamEvents(client, { from: bufferedFrom, to, channelId });
    const debutChannels = await loadDebutChannels(client);
    const grouped = new Map();

    for (const row of statsRows) {
      if (!grouped.has(row.youtube_channel_id)) {
        grouped.set(row.youtube_channel_id, []);
      }
      grouped.get(row.youtube_channel_id).push(row);
    }

    let insertedOrUpdatedSnapshots = 0;
    let failedSnapshots = 0;
    const errors = [];
    const pending = []; // calculated snapshots not yet written

    for (const [currentChannelId, channelRows] of grouped.entries()) {
      const validRows = [];
      for (const row of channelRows) {
        const validationError = validateRawSnapshot(row);
        if (!validationError) {
          validRows.push(row);
          continue;
        }

        const withinRequestedWindow =
          (!from || row.snapshot_date >= from) &&
          (!to || row.snapshot_date <= to);

        if (withinRequestedWindow) {
          failedSnapshots += 1;
          errors.push(`${currentChannelId}:${row.snapshot_date}:${validationError}`);
        }
      }

      const denseRows = densifyDailyStats(validRows, { from: bufferedFrom, to, fillMissingDates });
      const historyByDate = new Map(denseRows.map((row) => [toDateKey(row.snapshot_date), row]));
      let previousDerived = null;

      const channelEvents = streamEvents.get(currentChannelId) ?? null;
      const debut = debutChannels.get(currentChannelId) ?? null;
      for (const row of denseRows) {
        const derived = computeDerivedSnapshot(row, historyByDate, previousDerived, version, channelEvents?.get(toDateKey(row.snapshot_date)) ?? null, debut);
        previousDerived = derived;

        const withinRequestedWindow =
          (!from || row.snapshot_date >= from) &&
          (!to || row.snapshot_date <= to);

        if (!withinRequestedWindow) {
          continue;
        }

        pending.push(derived);
        insertedOrUpdatedSnapshots += 1;
        if (pending.length >= SNAPSHOT_BATCH) await upsertCalculatedSnapshots(client, pending.splice(0));
      }
    }
    await upsertCalculatedSnapshots(client, pending.splice(0));

    const updatedAssets = await refreshLatestAssetFairValues(client);
    await completeCalculationRun(client, runId, {
      channelsProcessed: grouped.size,
      snapshotsProcessed: insertedOrUpdatedSnapshots,
      failedSnapshots,
      assetsUpdated: updatedAssets,
      errorText: errors.length ? errors.slice(0, 100).join("\n") : null,
    });

    await client.query("COMMIT");

    return {
      version,
      from,
      to,
      channel_id: channelId,
      active_only: activeOnly,
      fill_missing_dates: fillMissingDates,
      bootstrap: {
        created_count: bootstrapResult.created_count,
        updated_count: bootstrapResult.updated_count,
      },
      channels_processed: grouped.size,
      snapshots_processed: insertedOrUpdatedSnapshots,
      failed_snapshots: failedSnapshots,
      assets_updated: updatedAssets,
      run_id: runId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await failCalculationRun(pool, runId, String(error?.message || error));
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  STREAM_EVENT_WEIGHTS,
  computeDerivedSnapshot,
  debutShare,
  streamEventSignal,
  listFundamentalsJobs,
  recalculateFundamentals,
  upsertCalculatedSnapshots,
  normalizeFundamentalToPrice,
};
