const settlementBatch = require("./settlementBatch");
const { performance } = require("node:perf_hooks");
const { normalizeFundamentalToPrice } = require("./fundamentals");
const supply = require("./marketSupply");
const netWorth = require("./netWorth");
const { publishMarketEvent } = require("./marketEvents");
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
  carriedMarketPrice = null,
}) {
  const persistentOffset = toNumber(previousPersistentOffset, 0) * PERSISTENT_DAILY_DECAY;
  const safeFairValue = Math.max(toNumber(fairValue, 0), 0.000001);

  if (carriedMarketPrice !== null && carriedMarketPrice !== undefined && toNumber(carriedMarketPrice, 0) > 0) {
    const midOpen = Math.max(toNumber(carriedMarketPrice, 0), 0.000001);
    const transientOffset = Math.log(midOpen / safeFairValue) - persistentOffset;
    return { persistentOffset, transientOffset, midOpen };
  }

  const transientOffset = toNumber(previousTransientOffset, 0) * TRANSIENT_SETTLEMENT_DECAY;
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

function normalizeDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text || null;
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
    SET status = 'completed', completed_at = clock_timestamp(), error_text = NULL
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
    SET status = 'failed', completed_at = clock_timestamp(), error_text = $2
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
      s.fundamental_value_smoothed,
      s.event_kinds,
      l.ipo_price AS listing_price
    FROM market.market_assets a
    LEFT JOIN market.channel_daily_snapshots s
      ON s.youtube_channel_id = a.youtube_channel_id
     AND s.snapshot_date = $1
     AND s.calculation_status = 'complete'
    LEFT JOIN market.ipo_listings l ON l.asset_id = a.id AND l.status = 'listed'
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

async function getPreviousCompletedSettlementDate(client, marketDate) {
  const { rows } = await client.query(
    `
    SELECT market_date
    FROM market.market_settlement_runs
    WHERE status = 'completed'
      AND market_date < $1
    ORDER BY market_date DESC
    LIMIT 1
  `,
    [marketDate]
  );

  return normalizeDateKey(rows[0]?.market_date);
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

  // Priced against a fixed reference supply, so the weekly max-share reset never reprices a stock.
  const fairValue = toNumber(normalizeFundamentalToPrice(assetRow.fundamental_value_smoothed, supply.REFERENCE_SUPPLY), 0);
  const fairValueRaw = toNumber(normalizeFundamentalToPrice(assetRow.fundamental_value_raw, supply.REFERENCE_SUPPLY), 0);
  if (!(fairValue > 0) || !(fairValueRaw > 0)) {
    const error = new Error(`invalid_fair_value:${assetRow.symbol}`);
    error.code = "invalid_fair_value";
    throw error;
  }

  // A first day opens at the IPO price for a talent listed by an IPO (the ticks then pull it toward
  // fair value), otherwise at that day's fair value (the start of a historical rebuild). The asset's
  // current price/fair value can't be used: a rebuild has already set them to today's.
  const listingPrice = toNumber(assetRow.listing_price, 0);
  const priorMidPrice = previousState?.mid_close ?? (listingPrice > 0 ? listingPrice : fairValue);
  const previousOffsets = derivePreviousOffsets(previousState);
  const opening = computeOpeningState({
    previousPersistentOffset: previousOffsets.persistentOffset,
    previousTransientOffset: previousOffsets.transientOffset,
    fairValue,
    carriedMarketPrice: priorMidPrice,
  });
  const midOpen = opening.midOpen;
  const premiumPct = computePremiumPct(midOpen, fairValue);
  // No daily print any more: shares only change hands in trades and at the weekly evaluation.
  const dailyEmission = 0;
  const circulatingSupplyEnd = toNumber(assetRow.circulating_supply, 0);
  const treasurySupplyEnd = toNumber(assetRow.treasury_supply, 0);

  const quotes = computeQuotes(midOpen, assetRow.spread_bps);

  return {
    assetId: assetRow.id,
    symbol: assetRow.symbol,
    displayName: assetRow.display_name,
    snapshotId: assetRow.snapshot_id,
    snapshotDate: assetRow.snapshot_date,
    eventKinds: Array.isArray(assetRow.event_kinds) && assetRow.event_kinds.length ? assetRow.event_kinds : null,
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


function buildDailyReport(marketDate, settledStates, previousStatesByAssetId, priorStatesByAssetId) {
  const fairValueChanges = settledStates.map((state) => {
    const prev = previousStatesByAssetId.get(state.assetId) || null;
    const prevForVolume = priorStatesByAssetId.get(state.assetId) || null;
    const prevFairValue = prev ? toNumber(prev.fair_value, 0) : null;
    // Settlement creates the next trading day's row with zero volume, so report flow
    // should describe the most recently completed trading day instead.
    const reportVolumeShares = prev ? toNumber(prev.volume_shares, 0) : toNumber(state.volumeShares, 0);
    const reportVolumeCash = prev ? toNumber(prev.volume_cash, 0) : toNumber(state.volumeCash, 0);
    const prevVolumeShares = prevForVolume ? toNumber(prevForVolume.volume_shares, 0) : null;
    const prevVolumeCash = prevForVolume ? toNumber(prevForVolume.volume_cash, 0) : null;
    return {
      asset_id: state.assetId,
      symbol: state.symbol,
      display_name: state.displayName,
      base_rate: roundMetric(state.fairValue),
      fair_value: roundMetric(state.fairValue),
      base_rate_change_pct:
        prevFairValue && prevFairValue > 0 ? roundMetric((state.fairValue - prevFairValue) / prevFairValue) : null,
      fair_value_change_pct:
        prevFairValue && prevFairValue > 0 ? roundMetric((state.fairValue - prevFairValue) / prevFairValue) : null,
      market_price: roundMetric(state.midOpen),
      // Big streams that lifted this fair value (a 3D live, a new outfit...), for the report to name.
      events: state.eventKinds ?? undefined,
      premium_discount_pct: roundMetric(state.premiumClosePct),
      premium_pct: roundMetric(state.premiumClosePct),
      emission: roundMetric(state.dailyEmission),
      treasury_supply_end: roundMetric(state.treasurySupplyEnd),
      circulating_supply_end: roundMetric(state.circulatingSupplyEnd),
      move_pct:
        state.priorMidPrice && state.priorMidPrice > 0 ? roundMetric((state.midOpen - state.priorMidPrice) / state.priorMidPrice) : null,
      volume_change_pct:
        prevVolumeShares && prevVolumeShares > 0 ? roundMetric((reportVolumeShares - prevVolumeShares) / prevVolumeShares) : null,
      volume_shares: roundMetric(reportVolumeShares),
      volume_cash: roundMetric(reportVolumeCash),
      volume_cash_change_pct:
        prevVolumeCash && prevVolumeCash > 0 ? roundMetric((reportVolumeCash - prevVolumeCash) / prevVolumeCash) : null,
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
    biggest_base_rate_increases: topBy(fairValueChanges, "base_rate_change_pct", "desc"),
    biggest_base_rate_decreases: topBy(fairValueChanges, "base_rate_change_pct", "asc"),
    biggest_fair_value_increases: topBy(fairValueChanges, "fair_value_change_pct", "desc"),
    biggest_fair_value_decreases: topBy(fairValueChanges, "fair_value_change_pct", "asc"),
    largest_market_premiums: topBy(fairValueChanges, "premium_discount_pct", "desc"),
    largest_market_discounts: topBy(fairValueChanges, "premium_discount_pct", "asc"),
    largest_premiums: topBy(fairValueChanges, "premium_pct", "desc"),
    largest_discounts: topBy(fairValueChanges, "premium_pct", "asc"),
    biggest_winners: topBy(fairValueChanges, "move_pct", "desc"),
    biggest_losers: topBy(fairValueChanges, "move_pct", "asc"),
    top_price_movers: topBy(fairValueChanges, "move_pct", "desc"),
    volume_winners: topBy(fairValueChanges, "volume_change_pct", "desc"),
    volume_losers: topBy(fairValueChanges, "volume_change_pct", "asc"),
    top_volume: topBy(fairValueChanges, "volume_shares", "desc"),
    notable_treasury_emissions: topBy(fairValueChanges, "emission", "desc"),
  };
}

function buildSettlementAssetPayload(state) {
  return {
    id: state.assetId,
    asset_id: state.assetId,
    symbol: state.symbol,
    display_name: state.displayName,
    base_rate: state.fairValue,
    current_fair_value: state.fairValue,
    current_fair_value_raw: state.fairValueRaw,
    market_price: state.midOpen,
    current_mid_price: state.midOpen,
    current_bid_price: state.bidClose,
    current_ask_price: state.askClose,
    premium_discount_pct: state.premiumClosePct,
    current_premium_pct: state.premiumClosePct,
    current_daily_emission: state.dailyEmission,
    treasury_supply: state.treasurySupplyEnd,
    circulating_supply: state.circulatingSupplyEnd,
    latest_snapshot_date: state.snapshotDate,
    previous_settlement_mid_price: state.midOpen,
    pre_settlement_mid_price: state.priorMidPrice,
    market_date: state.snapshotDate,
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

async function settleMarketDay(pool, { marketDate, sourceMarketDate = null, force = false, redis = null } = {}) {
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

    const previousCompletedMarketDate = await getPreviousCompletedSettlementDate(client, marketDate);
    if (previousCompletedMarketDate) {
      await netWorth.recordDailyNetWorthSnapshot(client, previousCompletedMarketDate);
    }

    const assets = await listAssetsForSettlement(client, resolvedSourceMarketDate);
    const settledStates = [];
    const previousStatesByAssetId = new Map();
    const priorStatesByAssetId = new Map();

    const assetIoStarted = performance.now();
    const histories = await settlementBatch.loadPreviousStates(client, assets.map(a => a.id), marketDate);
    for (const asset of assets) {
      const previousStates = histories.get(Number(asset.id)) || [];
      const previousState = previousStates[0] || null;
      const priorState = previousStates[1] || null;
      previousStatesByAssetId.set(asset.id, previousState);
      priorStatesByAssetId.set(asset.id, priorState);
      const state = buildSettledAssetState(asset, previousState);
      settledStates.push(state);
    }
    await settlementBatch.persistStates(client, marketDate, settledStates, DEFAULT_LIQUIDITY_DEPTH_FLOOR);
    const assetIoMs = performance.now() - assetIoStarted;

    // A buyback whose stock is back under its max shares ends at this Open (BBB: "cancelled at the
    // next Open"); the stock unfreezes.
    // Stock rows first, then their buybacks: the same lock order as a fill.
    const { rows: backUnder } = await client.query(`
      SELECT a.id FROM market.market_assets a
      WHERE a.trading_state = 'buyback' AND a.circulating_supply <= a.max_supply
      FOR UPDATE OF a
    `);
    const { rows: endedBuybacks } = backUnder.length
      ? await client.query(
          `
      WITH ended AS (
        UPDATE market.asset_buybacks b
        SET status = 'met', ended_at = now()
        WHERE b.status = 'active' AND b.asset_id = ANY($1::bigint[])
        RETURNING b.asset_id, b.shares_bought, b.cash_paid
      )
      UPDATE market.market_assets a
      SET trading_state = 'open', updated_at = now()
      FROM ended
      WHERE a.id = ended.asset_id
      RETURNING a.symbol, a.display_name, ended.shares_bought, ended.cash_paid
    `,
          [backUnder.map((row) => row.id)]
        )
      : { rows: [] };
    const supplyRows = await listSupplyWatch(client);

    const report = buildDailyReport(marketDate, settledStates, previousStatesByAssetId, priorStatesByAssetId);
    report.supply_watch = supplyRows;
    report.buybacks_ended = endedBuybacks.map((row) => ({
      symbol: row.symbol,
      display_name: row.display_name,
      shares_bought: roundMetric(row.shares_bought),
      cash_paid: roundMetric(row.cash_paid),
    }));
    await persistDailyReport(client, marketDate, report);
    await netWorth.refreshCurrentLeaderboardWithClient(client);
    const userRows = await client.query(`SELECT id FROM market.users`);
    await netWorth.refreshCurrentOshiboardsForUsersWithClient(
      client,
      userRows.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)
    );
    await markSettlementRunComplete(client, runId);

    await client.query("COMMIT");

    void publishMarketEvent(redis, {
      type: "market.settlement_completed",
      market_date: marketDate,
      source_market_date: resolvedSourceMarketDate,
      run_id: runId,
      asset_count: settledStates.length,
      timings_ms: { asset_io: Math.round(assetIoMs) },
      assets: settledStates.map(buildSettlementAssetPayload),
      report,
      at: new Date().toISOString(),
    });

    return {
      ok: true,
      market_date: marketDate,
      source_market_date: resolvedSourceMarketDate,
      run_id: runId,
      asset_count: settledStates.length,
      timings_ms: { asset_io: Math.round(assetIoMs) },
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

/** Stocks worth watching for supply: buybacks, sold out, and the ones with the least left for sale. */
async function listSupplyWatch(client) {
  const { rows } = await client.query(`
    SELECT a.symbol, a.display_name, a.max_supply, a.circulating_supply, a.treasury_supply, a.broker_buffer_pct, a.trading_state
    FROM market.market_assets a
    WHERE a.status = 'active'
  `);
  return rows
    .map((row) => {
      const forSale = supply.sharesForSale(row);
      const max = toNumber(row.max_supply, 0);
      return {
        symbol: row.symbol,
        display_name: row.display_name,
        max_supply: roundMetric(max),
        held: roundMetric(toNumber(row.circulating_supply, 0)),
        shares_for_sale: roundMetric(forSale),
        for_sale_pct: max > 0 ? roundMetric(forSale / max) : null,
        trading_state: row.trading_state,
      };
    })
    .sort((a, b) => (a.trading_state === "buyback" ? -1 : 0) - (b.trading_state === "buyback" ? -1 : 0) || (a.for_sale_pct ?? 1) - (b.for_sale_pct ?? 1))
    .slice(0, 8);
}

function computeSettlementSupplies({ maxSupply, circulatingSupply, treasurySupply, emissionApplied }) {
  const circulatingSupplyEnd = Math.min(circulatingSupply + emissionApplied, maxSupply);
  const treasurySupplyEnd = maxSupply - circulatingSupplyEnd;
  return { circulatingSupplyEnd, treasurySupplyEnd };
}

module.exports = {
  settleMarketDay,
  computeSettlementSupplies,
  // `afterDay(result)` runs after each settled day, before the next one settles (the historical
  // rebuild replays that day's adjustments there, which the next day's open carries forward).
  async settleMarketRange(pool, { from, to, force = false, marketDateOffsetDays = 0, redis = null, afterDay = null } = {}) {
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
      let result;
      try {
        const dayStarted = performance.now();
        result = await settleMarketDay(pool, { marketDate, sourceMarketDate, force, redis });
        result.timings_ms = { ...result.timings_ms, settlement: Math.round(performance.now() - dayStarted) };
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
        continue;
      }
      if (afterDay) await afterDay(result);
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
