const PRIMARY_STATE_KEY = "primary";

async function ensureMarketRuntimeState(client) {
  await client.query(
    `
    INSERT INTO market.market_runtime_state (state_key)
    VALUES ($1)
    ON CONFLICT (state_key) DO NOTHING
  `,
    [PRIMARY_STATE_KEY]
  );
}

function mapRuntimeState(row) {
  if (!row) return null;
  return {
    state_key: row.state_key,
    trading_status: row.trading_status,
    is_trading_open: row.trading_status === "open",
    active_phase: row.active_phase,
    trading_message: row.trading_message,
    current_market_date: row.current_market_date,
    current_cycle_started_at: row.current_cycle_started_at,
    current_cycle_updated_at: row.current_cycle_updated_at,
    last_settlement_market_date: row.last_settlement_market_date,
    last_settlement_completed_at: row.last_settlement_completed_at,
    next_scheduled_settlement_at: row.next_scheduled_settlement_at,
    last_cycle_error: row.last_cycle_error,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

async function getMarketStatusWithClient(client) {
  await ensureMarketRuntimeState(client);
  const { rows } = await client.query(
    `
    SELECT
      state_key,
      trading_status,
      active_phase,
      trading_message,
      current_market_date,
      current_cycle_started_at,
      current_cycle_updated_at,
      last_settlement_market_date,
      last_settlement_completed_at,
      next_scheduled_settlement_at,
      last_cycle_error,
      updated_at,
      created_at
    FROM market.market_runtime_state
    WHERE state_key = $1
    LIMIT 1
  `,
    [PRIMARY_STATE_KEY]
  );

  return mapRuntimeState(rows[0] || null);
}

async function getMarketStatus(pool) {
  const client = await pool.connect();
  try {
    return await getMarketStatusWithClient(client);
  } finally {
    client.release();
  }
}

async function updateMarketRuntimeState(client, changes) {
  await ensureMarketRuntimeState(client);

  const fields = [];
  const values = [PRIMARY_STATE_KEY];
  for (const [key, value] of Object.entries(changes)) {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }
  values.push(new Date());
  fields.push(`updated_at = $${values.length}`);

  await client.query(
    `
    UPDATE market.market_runtime_state
    SET ${fields.join(", ")}
    WHERE state_key = $1
  `,
    values
  );

  return getMarketStatusWithClient(client);
}

async function setMarketOpen(client, { message = null, nextScheduledSettlementAt = null, lastSettlementMarketDate, clearError = false, lastCycleError } = {}) {
  const changes = {
    trading_status: "open",
    active_phase: "idle",
    trading_message: message,
    current_market_date: null,
    current_cycle_started_at: null,
    current_cycle_updated_at: null,
    next_scheduled_settlement_at: nextScheduledSettlementAt,
  };

  if (lastSettlementMarketDate !== undefined) {
    changes.last_settlement_market_date = lastSettlementMarketDate;
    changes.last_settlement_completed_at = lastSettlementMarketDate ? new Date() : null;
  }
  if (clearError) {
    changes.last_cycle_error = null;
  } else if (lastCycleError !== undefined) {
    changes.last_cycle_error = lastCycleError;
  }

  return updateMarketRuntimeState(client, changes);
}

async function setMarketSettling(client, { marketDate, phase, message, nextScheduledSettlementAt = null } = {}) {
  return updateMarketRuntimeState(client, {
    trading_status: "settling",
    active_phase: phase || "settlement",
    trading_message: message || null,
    current_market_date: marketDate || null,
    current_cycle_started_at: new Date(),
    current_cycle_updated_at: new Date(),
    next_scheduled_settlement_at: nextScheduledSettlementAt,
    last_cycle_error: null,
  });
}

async function updateSettlementPhase(client, { marketDate, phase, message } = {}) {
  return updateMarketRuntimeState(client, {
    trading_status: "settling",
    active_phase: phase || "settlement",
    trading_message: message || null,
    current_market_date: marketDate || null,
    current_cycle_updated_at: new Date(),
  });
}

async function setMarketManualClosed(client, { message = null, nextScheduledSettlementAt = null, lastSettlementMarketDate } = {}) {
  const changes = {
    trading_status: "manual_closed",
    active_phase: "idle",
    trading_message: message || "Market manually closed.",
    current_market_date: null,
    current_cycle_started_at: null,
    current_cycle_updated_at: null,
    next_scheduled_settlement_at: nextScheduledSettlementAt,
  };
  if (lastSettlementMarketDate !== undefined) {
    changes.last_settlement_market_date = lastSettlementMarketDate;
    changes.last_settlement_completed_at = lastSettlementMarketDate ? new Date() : null;
  }
  return updateMarketRuntimeState(client, changes);
}

/**
 * Puts the last settled day's fair values back on every trading stock. The daily cycle's fundamentals
 * step commits the new day's fair values before settlement runs; if the cycle stops there, reopening
 * as it is would price fills off fair values that are meant to stay hidden until the Open, and the
 * jump would show which way each one moved. A no-op when nothing moved.
 */
async function restoreSettledFairValues(client) {
  const result = await client.query(`
    UPDATE market.market_assets a
    SET
      current_fair_value = d.fair_value,
      current_fair_value_raw = COALESCE(d.fair_value_raw, a.current_fair_value_raw),
      latest_snapshot_id = d.snapshot_id,
      latest_snapshot_date = s.snapshot_date,
      updated_at = now()
    FROM market.asset_daily_market_state d
    JOIN market.channel_daily_snapshots s ON s.id = d.snapshot_id
    WHERE d.asset_id = a.id
      AND d.market_date = (SELECT max(market_date) FROM market.market_settlement_runs WHERE status = 'completed')
      AND a.status = 'active'
      AND (a.current_fair_value IS DISTINCT FROM d.fair_value OR a.latest_snapshot_id IS DISTINCT FROM d.snapshot_id)
  `);
  return result.rowCount || 0;
}

/** After a failed daily cycle: reopens on the previous market state, its fair values included, in one transaction. */
async function setMarketCycleError(client, errorText, { nextScheduledSettlementAt = null } = {}) {
  await client.query("BEGIN");
  try {
    await restoreSettledFairValues(client);
    const status = await updateMarketRuntimeState(client, {
      trading_status: "open",
      active_phase: "idle",
      trading_message: "Daily settlement failed. Trading reopened on the previous market state.",
      current_market_date: null,
      current_cycle_started_at: null,
      current_cycle_updated_at: null,
      next_scheduled_settlement_at: nextScheduledSettlementAt,
      last_cycle_error: errorText || null,
    });
    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function setNextScheduledSettlementAt(client, nextScheduledSettlementAt) {
  return updateMarketRuntimeState(client, {
    next_scheduled_settlement_at: nextScheduledSettlementAt,
  });
}

async function clearMarketCycleError(client) {
  return updateMarketRuntimeState(client, {
    last_cycle_error: null,
  });
}

module.exports = {
  clearMarketCycleError,
  ensureMarketRuntimeState,
  getMarketStatus,
  getMarketStatusWithClient,
  restoreSettledFairValues,
  setMarketOpen,
  setMarketSettling,
  updateSettlementPhase,
  setMarketManualClosed,
  setMarketCycleError,
  setNextScheduledSettlementAt,
};
