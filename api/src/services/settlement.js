const { normalizeFundamentalToPrice } = require("./fundamentals");
const DEFAULT_PERSISTENT_DAILY_DECAY = 0.9;
const DEFAULT_TRANSIENT_SETTLEMENT_DECAY = 0.1;
const DEFAULT_LIQUIDITY_DEPTH_FLOOR = 2000;

const PERSISTENT_DAILY_DECAY = (() => {
  const parsed = Number(process.env.MARKET_PERSISTENT_DAILY_DECAY || DEFAULT_PERSISTENT_DAILY_DECAY);
  if (!Number.isFinite(parsed)) return DEFAULT_PERSISTENT_DAILY_DECAY;
  return Math.min(1, Math.max(0, parsed));
})();

const TRANSIENT_SETTLEMENT_DECAY = (() => {
  const parsed = Number(process.env.MARKET_TRANSIENT_SETTLEMENT_DECAY || DEFAULT_TRANSIENT_SETTLEMENT_DECAY);
  if (!Number.isFinite(parsed)) return DEFAULT_TRANSIENT_SETTLEMENT_DECAY;
  return Math.min(1, Math.max(0, parsed));
})();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMetric(value, digits = 6) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function computeOpeningState({
  previousPersistentOffset,
  previousTransientOffset,
  fairValue,
}) {
  const persistentOffset = toNumber(previousPersistentOffset, 0) * PERSISTENT_DAILY_DECAY;
  const transientOffset = toNumber(previousTransientOffset, 0) * TRANSIENT_SETTLEMENT_DECAY;
  const safeFairValue = Math.max(toNumber(fairValue, 0), 0.000001);
  const midOpen = safeFairValue * Math.exp(persistentOffset + transientOffset);

  return { persistentOffset, transientOffset, midOpen };
}

function computeMarkClose(fairValue, persistentOffset) {
  const safeFairValue = Math.max(toNumber(fairValue, 0), 0.000001);
  return safeFairValue * Math.exp(toNumber(persistentOffset, 0));
}

function computePremiumPct(midPrice, fairValue) {
  if (!(fairValue > 0)) return 0;
  return (midPrice - fairValue) / fairValue;
}

function computeDailyEmission(baseEmission, premiumPct) {
  const emissionBase = Math.max(baseEmission, 0);
  return emissionBase * (1 + 2 * Math.max(0, premiumPct));
}

function computeQuotes(midPrice, spreadBps) {
  const spreadPct = Math.max(toNumber(spreadBps, 0), 0) / 10000;
  return {
    bidPrice: midPrice * (1 - spreadPct / 2),
    askPrice: midPrice * (1 + spreadPct / 2),
  };
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getSettlementRun(client, marketDate) {
  const { rows } = await client.query(
    `
    SELECT id, market_date, source_market_date, status, started_at, completed_at, error_text
    FROM market.market_settlement_runs
    WHERE market_date = $1
    LIMIT 1
  `,
    [marketDate]
  );
  return rows[0] || null;
}

async function createSettlementRun(client, marketDate, sourceMarketDate) {
  const { rows } = await client.query(
    `
    INSERT INTO market.market_settlement_runs (market_date, source_market_date, status)
    VALUES ($1, $2, 'started')
    RETURNING id
  `,
    [marketDate, sourceMarketDate]
  );
  return rows[0].id;
}

async function markSettlementRunComplete(client, runId) {
  await client.query(
    `
    UPDATE market.market_settlement_runs
    SET status = 'completed', completed_at = now(), error_text = NULL
    WHERE id = $1
  `,
    [runId]
  );
}

async function markSettlementRunFailed(pool, runId, errorText) {
  if (!runId) return;
  await pool.query(
    `
    UPDATE market.market_settlement_runs
    SET status = 'failed', completed_at = now(), error_text = $2
    WHERE id = $1
  `,
    [runId, errorText]
  );
}

async function resetSettlementArtifacts(client, marketDate) {
  await client.query(`DELETE FROM market.daily_market_reports WHERE market_date = $1`, [marketDate]);
  await client.query(
    `
    DELETE FROM market.asset_price_events
    WHERE event_type = 'daily_reset'
      AND ts::date = $1::date
  `,
    [marketDate]
  );
  await client.query(`DELETE FROM market.asset_daily_market_state WHERE market_date = $1`, [marketDate]);
  await client.query(`DELETE FROM market.market_settlement_runs WHERE market_date = $1`, [marketDate]);
}

async function listAssetsForSettlement(client, sourceMarketDate) {
  const { rows } = await client.query(
    `
    SELECT
      a.id,
      a.youtube_channel_id,
      a.symbol,
      a.display_name,
      a.status,
      a.max_supply,
      a.circulating_supply,
      a.treasury_supply,
      a.base_emission,
      a.current_mid_price,
      a.current_bid_price,
      a.current_ask_price,
      a.current_premium_pct,
      a.current_daily_emission,
      a.current_persistent_offset,
      a.current_transient_offset,
      a.offsets_updated_at,
      a.current_fair_value,
      a.current_fair_value_raw,
      a.latest_snapshot_date,
      a.latest_snapshot_id,
      a.liquidity_depth,
      a.spread_bps,
      s.id AS snapshot_id,
      s.snapshot_date,
      s.subscriber_count,
      s.view_count,
      s.video_count,
      s.fundamental_value_raw,
      s.fundamental_value_smoothed
    FROM market.market_assets a
    LEFT JOIN market.channel_daily_snapshots s
      ON s.youtube_channel_id = a.youtube_channel_id
     AND s.snapshot_date = $1
     AND s.calculation_status = 'complete'
    WHERE a.status = 'active'
    ORDER BY a.symbol ASC
  `,
    [sourceMarketDate]
  );
  return rows;
}

async function listSettleableDates(client, { from, to }) {
  const { rows } = await client.query(
    `
    WITH active_assets AS (
      SELECT COUNT(*)::INTEGER AS asset_count
      FROM market.market_assets
      WHERE status = 'active'
    )
    SELECT s.snapshot_date
    FROM market.channel_daily_snapshots s
    JOIN market.market_assets a
      ON a.youtube_channel_id = s.youtube_channel_id
     AND a.status = 'active'
    CROSS JOIN active_assets aa
    WHERE s.calculation_status = 'complete'
      AND s.snapshot_date BETWEEN $1 AND $2
    GROUP BY s.snapshot_date, aa.asset_count
    HAVING COUNT(DISTINCT s.youtube_channel_id) = aa.asset_count
    ORDER BY s.snapshot_date ASC
  `,
    [from, to]
  );
  return rows;
}

async function getPreviousDailyState(client, assetId, marketDate) {
  const { rows } = await client.query(
    `
    SELECT market_date, mid_close, mid_close_mark, fair_value, premium_close_pct, volume_shares, volume_cash
    FROM market.asset_daily_market_state
    WHERE asset_id = $1
      AND market_date < $2
    ORDER BY market_date DESC
    LIMIT 1
  `,
    [assetId, marketDate]
  );
  return rows[0] || null;
}

function derivePreviousOffsets(previousState) {
  if (!previousState) {
    return {
      persistentOffset: 0,
      transientOffset: 0,
    };
  }

  const fairValue = Math.max(toNumber(previousState.fair_value, 0), 0.000001);
  const midCloseMark = Math.max(toNumber(previousState.mid_close_mark, fairValue), 0.000001);
  const midClose = Math.max(toNumber(previousState.mid_close, midCloseMark), 0.000001);

  return {
    persistentOffset: Math.log(midCloseMark / fairValue),
    transientOffset: Math.log(midClose / midCloseMark),
  };
}

function buildSettledAssetState(assetRow, previousState) {
  if (!assetRow.snapshot_id) {
    const error = new Error(`missing_completed_snapshot:${assetRow.symbol}`);
    error.code = "missing_completed_snapshot";
    throw error;
  }

  const dilutedSupply = toNumber(assetRow.max_supply, 0);
  const fairValue = toNumber(normalizeFundamentalToPrice(assetRow.fundamental_value_smoothed, dilutedSupply), 0);
  const fairValueRaw = toNumber(normalizeFundamentalToPrice(assetRow.fundamental_value_raw, dilutedSupply), 0);
  if (!(fairValue > 0) || !(fairValueRaw > 0)) {
    const error = new Error(`invalid_fair_value:${assetRow.symbol}`);
    error.code = "invalid_fair_value";
    throw error;
  }

  const priorMidPrice = previousState?.mid_close ?? assetRow.current_mid_price ?? assetRow.current_fair_value ?? null;
  const previousOffsets = derivePreviousOffsets(previousState);
  const opening = computeOpeningState({
    previousPersistentOffset: previousOffsets.persistentOffset,
    previousTransientOffset: previousOffsets.transientOffset,
    fairValue,
  });
  const midOpen = opening.midOpen;
  const premiumPct = computePremiumPct(midOpen, fairValue);
  const dailyEmission = computeDailyEmission(toNumber(assetRow.base_emission, 0), premiumPct);
  const emissionApplied = Math.min(dailyEmission, toNumber(assetRow.treasury_supply, 0));
  const treasurySupplyEnd = toNumber(assetRow.treasury_supply, 0) - emissionApplied;
  const circulatingSupplyEnd = toNumber(assetRow.circulating_supply, 0) + emissionApplied;
  const quotes = computeQuotes(midOpen, assetRow.spread_bps);

  return {
    assetId: assetRow.id,
    symbol: assetRow.symbol,
    displayName: assetRow.display_name,
    snapshotId: assetRow.snapshot_id,
    snapshotDate: assetRow.snapshot_date,
    fairValue,
    fairValueRaw,
    priorMidPrice: toNumber(priorMidPrice, 0) || null,
    persistentOffset: opening.persistentOffset,
    transientOffset: opening.transientOffset,
    midOpen,
    midClose: midOpen,
    midCloseMark: computeMarkClose(fairValue, opening.persistentOffset),
    midHigh: midOpen,
    midLow: midOpen,
    bidClose: quotes.bidPrice,
    askClose: quotes.askPrice,
    premiumClosePct: premiumPct,
    dailyEmission,
    treasurySupplyStart: toNumber(assetRow.treasury_supply, 0),
    treasurySupplyEnd,
    circulatingSupplyStart: toNumber(assetRow.circulating_supply, 0),
    circulatingSupplyEnd,
    volumeShares: 0,
    volumeCash: 0,
    tradeCount: 0,
  };
}

async function persistSettledAssetState(client, marketDate, state) {
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
    ) VALUES (
      $1,
      $2::date::timestamptz,
      'daily_reset',
      $3,
      $4,
      $5,
      jsonb_build_object('market_date', $2::date)
    )
  `,
    [state.assetId, marketDate, state.priorMidPrice, state.midOpen, state.fairValue]
  );

  await client.query(
    `
    INSERT INTO market.asset_daily_market_state (
      asset_id,
      market_date,
      snapshot_id,
      fair_value,
      fair_value_raw,
      mid_open,
      mid_close,
      mid_close_mark,
      mid_high,
      mid_low,
      bid_close,
      ask_close,
      premium_close_pct,
      daily_emission,
      treasury_supply_start,
      treasury_supply_end,
      circulating_supply_start,
      circulating_supply_end,
      volume_shares,
      volume_cash,
      trade_count,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now()
    )
  `,
    [
      state.assetId,
      marketDate,
      state.snapshotId,
      state.fairValue,
      state.fairValueRaw,
      state.midOpen,
      state.midClose,
      state.midCloseMark,
      state.midHigh,
      state.midLow,
      state.bidClose,
      state.askClose,
      state.premiumClosePct,
      state.dailyEmission,
      state.treasurySupplyStart,
      state.treasurySupplyEnd,
      state.circulatingSupplyStart,
      state.circulatingSupplyEnd,
      state.volumeShares,
      state.volumeCash,
      state.tradeCount,
    ]
  );

  await client.query(
    `
    UPDATE market.market_assets
    SET
      latest_snapshot_date = $2,
      latest_snapshot_id = $3,
      current_fair_value = $4,
      current_fair_value_raw = $5,
      current_mid_price = $6,
      current_bid_price = $7,
      current_ask_price = $8,
      current_premium_pct = $9,
      current_daily_emission = $10,
      current_persistent_offset = $11,
      current_transient_offset = $12,
      offsets_updated_at = $13,
      treasury_supply = $14,
      circulating_supply = $15,
      liquidity_depth = GREATEST(${DEFAULT_LIQUIDITY_DEPTH_FLOOR}, $15 * 1.0),
      updated_at = now()
    WHERE id = $1
  `,
    [
      state.assetId,
      state.snapshotDate,
      state.snapshotId,
      state.fairValue,
      state.fairValueRaw,
      state.midOpen,
      state.bidClose,
      state.askClose,
      state.premiumClosePct,
      state.dailyEmission,
      state.persistentOffset,
      state.transientOffset,
      marketDate,
      state.treasurySupplyEnd,
      state.circulatingSupplyEnd,
    ]
  );
}

function buildDailyReport(marketDate, settledStates, previousStatesByAssetId) {
  const fairValueChanges = settledStates.map((state) => {
    const prev = previousStatesByAssetId.get(state.assetId) || null;
    const prevFairValue = prev ? toNumber(prev.fair_value, 0) : null;
    const prevVolumeShares = prev ? toNumber(prev.volume_shares, 0) : null;
    const prevVolumeCash = prev ? toNumber(prev.volume_cash, 0) : null;
    return {
      asset_id: state.assetId,
      symbol: state.symbol,
      display_name: state.displayName,
      fair_value: roundMetric(state.fairValue),
      fair_value_change_pct:
        prevFairValue && prevFairValue > 0 ? roundMetric((state.fairValue - prevFairValue) / prevFairValue) : null,
      premium_pct: roundMetric(state.premiumClosePct),
      emission: roundMetric(state.dailyEmission),
      treasury_supply_end: roundMetric(state.treasurySupplyEnd),
      circulating_supply_end: roundMetric(state.circulatingSupplyEnd),
      move_pct:
        state.priorMidPrice && state.priorMidPrice > 0 ? roundMetric((state.midOpen - state.priorMidPrice) / state.priorMidPrice) : null,
      volume_change_pct:
        prevVolumeShares && prevVolumeShares > 0 ? roundMetric((state.volumeShares - prevVolumeShares) / prevVolumeShares) : null,
      volume_shares: roundMetric(state.volumeShares),
      volume_cash: roundMetric(state.volumeCash),
      volume_cash_change_pct:
        prevVolumeCash && prevVolumeCash > 0 ? roundMetric((state.volumeCash - prevVolumeCash) / prevVolumeCash) : null,
    };
  });

  const topBy = (items, metric, direction = "desc", limit = 5) =>
    [...items]
      .filter((item) => item[metric] !== null && item[metric] !== undefined)
      .sort((a, b) => {
        const av = toNumber(a[metric], 0);
        const bv = toNumber(b[metric], 0);
        return direction === "asc" ? av - bv : bv - av;
      })
      .slice(0, limit);

  return {
    market_date: marketDate,
    generated_at: new Date().toISOString(),
    asset_count: settledStates.length,
    biggest_fair_value_increases: topBy(fairValueChanges, "fair_value_change_pct", "desc"),
    biggest_fair_value_decreases: topBy(fairValueChanges, "fair_value_change_pct", "asc"),
    largest_premiums: topBy(fairValueChanges, "premium_pct", "desc"),
    largest_discounts: topBy(fairValueChanges, "premium_pct", "asc"),
    biggest_winners: topBy(fairValueChanges, "move_pct", "desc"),
    biggest_losers: topBy(fairValueChanges, "move_pct", "asc"),
    top_price_movers: topBy(fairValueChanges, "move_pct", "desc"),
    volume_winners: topBy(fairValueChanges, "volume_change_pct", "desc"),
    volume_losers: topBy(fairValueChanges, "volume_change_pct", "asc"),
    top_volume: topBy(fairValueChanges, "volume_cash", "desc"),
    notable_treasury_emissions: topBy(fairValueChanges, "emission", "desc"),
  };
}

async function persistDailyReport(client, marketDate, report) {
  await client.query(
    `
    INSERT INTO market.daily_market_reports (market_date, report_json)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (market_date)
    DO UPDATE SET report_json = EXCLUDED.report_json, created_at = now()
  `,
    [marketDate, JSON.stringify(report)]
  );
}

async function settleMarketDay(pool, { marketDate, sourceMarketDate = null, force = false } = {}) {
  const client = await pool.connect();
  let runId = null;
  const resolvedSourceMarketDate = sourceMarketDate || marketDate;

  try {
    await client.query("BEGIN");

    const existingRun = await getSettlementRun(client, marketDate);
    if (existingRun?.status === "completed" && !force) {
      const error = new Error(`settlement_already_completed:${marketDate}`);
      error.code = "settlement_already_completed";
      throw error;
    }

    if (force && existingRun) {
      await resetSettlementArtifacts(client, marketDate);
    } else if (existingRun) {
      await client.query(
        `
        UPDATE market.market_settlement_runs
        SET status = 'started', completed_at = NULL, error_text = NULL
        WHERE id = $1
      `,
        [existingRun.id]
      );
      runId = existingRun.id;
    }

    if (!runId) {
      runId = await createSettlementRun(client, marketDate, resolvedSourceMarketDate);
    }

    const assets = await listAssetsForSettlement(client, resolvedSourceMarketDate);
    const settledStates = [];
    const previousStatesByAssetId = new Map();

    for (const asset of assets) {
      const previousState = await getPreviousDailyState(client, asset.id, marketDate);
      previousStatesByAssetId.set(asset.id, previousState);
      const state = buildSettledAssetState(asset, previousState);
      await persistSettledAssetState(client, marketDate, state);
      settledStates.push(state);
    }

    const report = buildDailyReport(marketDate, settledStates, previousStatesByAssetId);
    await persistDailyReport(client, marketDate, report);
    await markSettlementRunComplete(client, runId);

    await client.query("COMMIT");

    return {
      ok: true,
      market_date: marketDate,
      source_market_date: resolvedSourceMarketDate,
      run_id: runId,
      asset_count: settledStates.length,
      report,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await markSettlementRunFailed(pool, runId, String(error?.message || error));
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  settleMarketDay,
  async settleMarketRange(pool, { from, to, force = false, marketDateOffsetDays = 0 } = {}) {
    const client = await pool.connect();
    let datesResult;
    try {
      datesResult = await listSettleableDates(client, { from, to });
    } finally {
      client.release();
    }

    const settled = [];
    const skipped = [];
    for (const row of datesResult) {
      const sourceMarketDate = row.snapshot_date instanceof Date
        ? row.snapshot_date.toISOString().slice(0, 10)
        : String(row.snapshot_date);
      const marketDate = shiftDateKey(sourceMarketDate, marketDateOffsetDays);
      try {
        const result = await settleMarketDay(pool, { marketDate, sourceMarketDate, force });
        settled.push({
          market_date: result.market_date,
          source_market_date: result.source_market_date,
          run_id: result.run_id,
          asset_count: result.asset_count,
        });
      } catch (error) {
        skipped.push({
          market_date: marketDate,
          source_market_date: sourceMarketDate,
          error: String(error?.code || error?.message || error),
        });
      }
    }

    return {
      from,
      to,
      settled_dates: settled,
      settled_count: settled.length,
      skipped_dates: skipped,
    };
  },
};
