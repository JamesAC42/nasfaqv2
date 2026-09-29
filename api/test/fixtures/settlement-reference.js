// Frozen pre-batching persistence from 5c6624b; reference oracle for SQL equivalence.
const DEFAULT_LIQUIDITY_DEPTH_FLOOR = 2000;
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
      -- Shares only move in fills and at the weekly evaluation, never here (a stale count from the
      -- unlocked read above would overwrite fills that landed meanwhile).
      liquidity_depth = GREATEST(${DEFAULT_LIQUIDITY_DEPTH_FLOOR}, circulating_supply * 1.0),
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
    ]
  );
}

module.exports = { persistSettledAssetState };
