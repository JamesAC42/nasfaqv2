// Keep settlement calculations in settlement.js; only batch their database I/O here.
async function loadPreviousStates(client, assetIds, marketDate) {
  if (!assetIds.length) return new Map();
  const { rows } = await client.query(`
    SELECT a.asset_id, s.* FROM unnest($1::bigint[]) a(asset_id)
    CROSS JOIN LATERAL (
      SELECT market_date, mid_close, mid_close_mark, fair_value, premium_close_pct, volume_shares, volume_cash
      FROM market.asset_daily_market_state
      WHERE asset_id = a.asset_id AND market_date < $2
      ORDER BY market_date DESC LIMIT 2
    ) s ORDER BY a.asset_id, s.market_date DESC
  `, [assetIds, marketDate]);
  const result = new Map();
  for (const row of rows) {
    const key = Number(row.asset_id);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

async function persistStates(client, marketDate, states, liquidityFloor) {
  if (!states.length) return;
  // Match trading's asset-first lock order and avoid inconsistent multi-asset lock ordering.
  await client.query(`SELECT id FROM market.market_assets WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [states.map(s => s.assetId)]);
  const payload = JSON.stringify(states);
  await client.query(`
    INSERT INTO market.asset_price_events
      (asset_id, ts, event_type, old_mid_price, new_mid_price, fair_value_at_event, metadata_json)
    SELECT s."assetId", $1::date::timestamptz, 'daily_reset', s."priorMidPrice", s."midOpen", s."fairValue",
      jsonb_build_object('market_date', $1::date)
    FROM jsonb_to_recordset($2::jsonb) AS s("assetId" bigint, "priorMidPrice" numeric, "midOpen" numeric, "fairValue" numeric)
  `, [marketDate, payload]);
  await client.query(`
    INSERT INTO market.asset_daily_market_state
      (asset_id, market_date, snapshot_id, fair_value, fair_value_raw, mid_open, mid_close, mid_close_mark,
       mid_high, mid_low, bid_close, ask_close, premium_close_pct, daily_emission, treasury_supply_start,
       treasury_supply_end, circulating_supply_start, circulating_supply_end, volume_shares, volume_cash, trade_count, updated_at)
    SELECT s."assetId", $1::date, s."snapshotId", s."fairValue", s."fairValueRaw", s."midOpen", s."midClose", s."midCloseMark",
      s."midHigh", s."midLow", s."bidClose", s."askClose", s."premiumClosePct", s."dailyEmission", s."treasurySupplyStart",
      s."treasurySupplyEnd", s."circulatingSupplyStart", s."circulatingSupplyEnd", s."volumeShares", s."volumeCash", s."tradeCount", now()
    FROM jsonb_to_recordset($2::jsonb) AS s("assetId" bigint, "snapshotId" bigint, "fairValue" numeric, "fairValueRaw" numeric,
      "midOpen" numeric, "midClose" numeric, "midCloseMark" numeric, "midHigh" numeric, "midLow" numeric,
      "bidClose" numeric, "askClose" numeric, "premiumClosePct" numeric, "dailyEmission" numeric,
      "treasurySupplyStart" numeric, "treasurySupplyEnd" numeric, "circulatingSupplyStart" numeric,
      "circulatingSupplyEnd" numeric, "volumeShares" numeric, "volumeCash" numeric, "tradeCount" bigint)
  `, [marketDate, payload]);
  await client.query(`
    UPDATE market.market_assets a SET latest_snapshot_date = s."snapshotDate", latest_snapshot_id = s."snapshotId",
      current_fair_value = s."fairValue", current_fair_value_raw = s."fairValueRaw", current_mid_price = s."midOpen",
      current_bid_price = s."bidClose", current_ask_price = s."askClose", current_premium_pct = s."premiumClosePct",
      current_daily_emission = s."dailyEmission", current_persistent_offset = s."persistentOffset",
      current_transient_offset = s."transientOffset", offsets_updated_at = $1::timestamptz,
      liquidity_depth = GREATEST($3::numeric, a.circulating_supply * 1.0), updated_at = now()
    FROM jsonb_to_recordset($2::jsonb) AS s("assetId" bigint, "snapshotDate" date, "snapshotId" bigint,
      "fairValue" numeric, "fairValueRaw" numeric, "midOpen" numeric, "bidClose" numeric, "askClose" numeric,
      "premiumClosePct" numeric, "dailyEmission" numeric, "persistentOffset" numeric, "transientOffset" numeric)
    WHERE a.id = s."assetId"
  `, [marketDate, payload, liquidityFloor]);
}
module.exports = { loadPreviousStates, persistStates };
