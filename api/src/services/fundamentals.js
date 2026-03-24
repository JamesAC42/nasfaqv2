const { bootstrapAssetsWithClient } = require("./marketAdmin");
const FAIR_VALUE_SCALE_MULTIPLIER = Number(process.env.MARKET_PRICE_SCALE_MULTIPLIER || 100);

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
  return clamp(nextValue, previousValue * 0.9, previousValue * 1.1);
}

function toSnapshotPoint(row) {
  return {
    youtube_channel_id: row.youtube_channel_id,
    snapshot_date: row.snapshot_date,
    subscriber_count: row.subscriber_count === null ? null : Number(row.subscriber_count),
    view_count: row.view_count === null ? null : Number(row.view_count),
    video_count: row.video_count === null ? null : Number(row.video_count),
  };
}

function validateRawSnapshot(point) {
  if (point.subscriber_count === null || point.view_count === null || point.video_count === null) {
    return "missing_raw_counts";
  }
  if (point.subscriber_count < 0 || point.view_count < 0 || point.video_count < 0) {
    return "negative_raw_counts";
  }
  return null;
}

function computeDerivedSnapshot(current, historyByDate, previousDerived, version) {
  const currentDate = current.snapshot_date;
  const prev1 = historyByDate.get(shiftDateKey(currentDate, -1)) || null;
  const prev7 = historyByDate.get(shiftDateKey(currentDate, -7)) || null;
  const prev30 = historyByDate.get(shiftDateKey(currentDate, -30)) || null;
  const prev35 = historyByDate.get(shiftDateKey(currentDate, -35)) || null;

  const viewDelta1d = prev1 ? current.view_count - prev1.view_count : null;
  const viewDelta7d = prev7 ? current.view_count - prev7.view_count : null;
  const viewDelta30d = prev30 ? current.view_count - prev30.view_count : null;
  const videoDelta7d = prev7 ? current.video_count - prev7.video_count : null;
  const videoDelta30d = prev30 ? current.video_count - prev30.video_count : null;

  const estimatedSubDelta7d = prev7 ? current.subscriber_count - prev7.subscriber_count : null;
  const estimatedSubDelta30d = prev30 ? current.subscriber_count - prev30.subscriber_count : null;

  const viewRecent = viewDelta7d !== null ? viewDelta7d / 7 : 0;
  const viewBase = prev7 && prev35 ? Math.max((prev7.view_count - prev35.view_count) / 28, 100) : 100;
  const uploadRecent = videoDelta7d !== null ? videoDelta7d / 7 : 0;
  const uploadBase = prev7 && prev35 ? Math.max((prev7.video_count - prev35.video_count) / 28, 0.05) : 0.05;

  const sizeAnchorRaw =
    Math.pow(Math.max(current.subscriber_count, 1), 0.42) *
    Math.pow(Math.max(viewDelta30d ?? 1, 1), 0.08);

  const viewSignalRaw = Math.log(Math.max(viewRecent, 100) / Math.max(viewBase, 100));
  const viewSignal = clamp(viewSignalRaw, -0.4, 0.4);
  const uploadSignal = Math.log(Math.max(uploadRecent, 0.05) / Math.max(uploadBase, 0.05));
  const subSignal = null;

  const rawMomentum = 0.92 * viewSignal + 0.08 * uploadSignal;
  const momentumRaw = clamp(rawMomentum, -1.35, 1.35);
  const momentumMultiplier = Math.exp(0.35 * momentumRaw);
  const fundamentalValueRaw = sizeAnchorRaw * momentumMultiplier;
  const previousSmoothed = previousDerived?.fundamental_value_smoothed ?? null;
  const uncappedFundamentalValueSmoothed =
    previousSmoothed === null
      ? fundamentalValueRaw
      : 0.8 * previousSmoothed + 0.2 * fundamentalValueRaw;
  const fundamentalValueSmoothed = clampFairValueMove(uncappedFundamentalValueSmoothed, previousSmoothed);

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
    momentum_raw: momentumRaw,
    momentum_multiplier: momentumMultiplier,
    fundamental_value_raw: fundamentalValueRaw,
    fundamental_value_smoothed: fundamentalValueSmoothed,
    calculation_version: version,
    calculation_status: "complete",
    calculation_error: null,
  };
}

async function loadHistoricalDailyStats(client, { from = null, to = null, channelId = null, activeOnly = false } = {}) {
  const params = [];
  const where = [];

  if (from) {
    params.push(from);
    where.push(`s.time::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`s.time::date <= $${params.length}::date`);
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
      SELECT DISTINCT ON (s.youtube_channel_id, s.time::date)
        s.youtube_channel_id,
        s.time::date AS day,
        s.subscriber_count,
        s.view_count,
        s.video_count
      FROM yt.youtube_channel_daily_stats s
      JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
      ${whereSql}
      ORDER BY s.youtube_channel_id, s.time::date, s.time DESC
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
    });
  }

  return dense;
}

async function upsertCalculatedSnapshot(client, snapshot) {
  await client.query(
    `
    INSERT INTO market.channel_daily_snapshots (
      youtube_channel_id,
      snapshot_date,
      subscriber_count,
      view_count,
      video_count,
      view_delta_1d,
      view_delta_7d,
      view_delta_30d,
      video_delta_7d,
      video_delta_30d,
      estimated_sub_delta_7d,
      estimated_sub_delta_30d,
      size_anchor_raw,
      view_signal,
      upload_signal,
      sub_signal,
      momentum_raw,
      momentum_multiplier,
      fundamental_value_raw,
      fundamental_value_smoothed,
      calculation_version,
      calculation_status,
      calculation_error,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,now()
    )
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
      updated_at = now()
  `,
    [
      snapshot.youtube_channel_id,
      snapshot.snapshot_date,
      snapshot.subscriber_count,
      snapshot.view_count,
      snapshot.video_count,
      numberOrNull(snapshot.view_delta_1d),
      numberOrNull(snapshot.view_delta_7d),
      numberOrNull(snapshot.view_delta_30d),
      numberOrNull(snapshot.video_delta_7d),
      numberOrNull(snapshot.video_delta_30d),
      numberOrNull(snapshot.estimated_sub_delta_7d),
      numberOrNull(snapshot.estimated_sub_delta_30d),
      snapshot.size_anchor_raw,
      snapshot.view_signal,
      snapshot.upload_signal,
      snapshot.sub_signal,
      snapshot.momentum_raw,
      snapshot.momentum_multiplier,
      snapshot.fundamental_value_raw,
      snapshot.fundamental_value_smoothed,
      snapshot.calculation_version,
      snapshot.calculation_status,
      snapshot.calculation_error,
    ]
  );
}

async function refreshLatestAssetFairValues(client) {
  const result = await client.query(
    `
    UPDATE market.market_assets a
    SET
      latest_snapshot_date = s.snapshot_date,
      latest_snapshot_id = s.id,
      current_fair_value = (s.fundamental_value_smoothed / NULLIF(a.max_supply, 0)) * $1,
      current_fair_value_raw = (s.fundamental_value_raw / NULLIF(a.max_supply, 0)) * $1,
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
      SELECT id, market_date, status, started_at, completed_at, error_text
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

      for (const row of denseRows) {
        const derived = computeDerivedSnapshot(row, historyByDate, previousDerived, version);
        previousDerived = derived;

        const withinRequestedWindow =
          (!from || row.snapshot_date >= from) &&
          (!to || row.snapshot_date <= to);

        if (!withinRequestedWindow) {
          continue;
        }

        await upsertCalculatedSnapshot(client, derived);
        insertedOrUpdatedSnapshots += 1;
      }
    }

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
  listFundamentalsJobs,
  recalculateFundamentals,
  normalizeFundamentalToPrice,
};
