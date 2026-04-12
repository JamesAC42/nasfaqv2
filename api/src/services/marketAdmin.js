const { getStarterCash } = require("./trading");

const DEFAULT_MAX_SUPPLY = 10_000;
const DEFAULT_INITIAL_CIRCULATING_SUPPLY = 2_000;
const DEFAULT_BASE_EMISSION = 10;
const DEFAULT_SPREAD_BPS = 400;
const DEFAULT_MARKET_DATA_TIME_ZONE = "America/New_York";

function getQueryTimeZone() {
  const candidate = String(process.env.MARKET_DATA_TIMEZONE || process.env.SCRAPE_TIMEZONE || DEFAULT_MARKET_DATA_TIME_ZONE).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_MARKET_DATA_TIME_ZONE;
  }
}

function normalizeLetters(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function deriveSymbol(nameEnglish, nameShort) {
  const candidates = [nameEnglish, nameShort];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;

    const parts = text.split(/\s+/).filter(Boolean);
    const lastWord = parts.length ? parts[parts.length - 1] : text;
    const letters = normalizeLetters(lastWord) || normalizeLetters(text);
    if (!letters) continue;

    const noVowels = letters.replace(/[AEIOU]/g, "");
    const base = noVowels.length >= 3 ? noVowels.slice(0, 4) : letters.slice(0, 4);
    if (base) return base;
  }

  return null;
}

function deriveDisplayName(channel) {
  return channel.name_english || channel.name_short || channel.youtube_channel_id;
}

function computeLiquidityDepth(circulatingSupply) {
  return Math.max(2000, circulatingSupply * 1.0);
}

async function loadBootstrapChannels(client, { activeOnly = false } = {}) {
  const { rows } = await client.query(
    `
    SELECT
      c.youtube_channel_id,
      c.name_short,
      c.name_english,
      c.symbol AS channel_symbol,
      c.is_active,
      a.id AS asset_id,
      a.symbol AS asset_symbol,
      a.display_name AS asset_display_name
    FROM yt.youtube_channels c
    LEFT JOIN market.market_assets a ON a.youtube_channel_id = c.youtube_channel_id
    WHERE ($1::boolean IS FALSE OR c.is_active = true)
    ORDER BY c.name_short ASC, c.youtube_channel_id ASC
  `,
    [activeOnly]
  );

  return rows;
}

async function loadUsedSymbols(client) {
  const { rows } = await client.query(
    `
    SELECT symbol
    FROM market.market_assets
    ORDER BY symbol ASC
  `
  );
  return new Set(rows.map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean));
}

function pickUniqueSymbol(preferred, usedSymbols) {
  const base = normalizeLetters(preferred) || "ASST";
  if (!usedSymbols.has(base)) {
    usedSymbols.add(base);
    return base;
  }

  for (let index = 2; index <= 9999; index += 1) {
    const suffix = String(index);
    const candidate = `${base.slice(0, Math.max(1, 4 - suffix.length))}${suffix}`;
    if (!usedSymbols.has(candidate)) {
      usedSymbols.add(candidate);
      return candidate;
    }
  }

  throw new Error(`unable_to_allocate_symbol_for_${base}`);
}

async function bootstrapAssetsWithClient(client, { activeOnly = true, syncExisting = true } = {}) {
  const channels = await loadBootstrapChannels(client, { activeOnly });
  const usedSymbols = await loadUsedSymbols(client);
  const created = [];
  const updated = [];

  for (const channel of channels) {
    const preferredSymbol = channel.asset_symbol || channel.channel_symbol || deriveSymbol(channel.name_english, channel.name_short);
    const displayName = deriveDisplayName(channel);

    if (!channel.asset_id) {
      const symbol = pickUniqueSymbol(preferredSymbol, usedSymbols);
      const circulatingSupply = DEFAULT_INITIAL_CIRCULATING_SUPPLY;
      const treasurySupply = DEFAULT_MAX_SUPPLY - circulatingSupply;
      const liquidityDepth = computeLiquidityDepth(circulatingSupply);

      const { rows } = await client.query(
        `
        INSERT INTO market.market_assets (
          youtube_channel_id,
          symbol,
          display_name,
          status,
          max_supply,
          circulating_supply,
          treasury_supply,
          base_emission,
          liquidity_depth,
          spread_bps,
          updated_at
        ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,now())
        RETURNING id, youtube_channel_id, symbol, display_name
      `,
        [
          channel.youtube_channel_id,
          symbol,
          displayName,
          DEFAULT_MAX_SUPPLY,
          circulatingSupply,
          treasurySupply,
          DEFAULT_BASE_EMISSION,
          liquidityDepth,
          DEFAULT_SPREAD_BPS,
        ]
      );

      created.push(rows[0]);
      continue;
    }

    if (!syncExisting) {
      continue;
    }

    const nextDisplayName = displayName;
    const nextSymbol = channel.asset_symbol || channel.channel_symbol || deriveSymbol(channel.name_english, channel.name_short);
    const symbolChanged = !channel.asset_symbol && nextSymbol;
    const displayChanged = nextDisplayName && nextDisplayName !== channel.asset_display_name;

    if (!symbolChanged && !displayChanged) {
      continue;
    }

    const resolvedSymbol = symbolChanged ? pickUniqueSymbol(nextSymbol, usedSymbols) : channel.asset_symbol;
    const { rows } = await client.query(
      `
      UPDATE market.market_assets
      SET
        symbol = $2,
        display_name = $3,
        updated_at = now()
      WHERE youtube_channel_id = $1
      RETURNING id, youtube_channel_id, symbol, display_name
    `,
      [channel.youtube_channel_id, resolvedSymbol, nextDisplayName]
    );

    updated.push(rows[0]);
  }

  return {
    active_only: activeOnly,
    sync_existing: syncExisting,
    created_count: created.length,
    updated_count: updated.length,
    created,
    updated,
  };
}

async function bootstrapAssets(pool, { activeOnly = true, syncExisting = true } = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await bootstrapAssetsWithClient(client, { activeOnly, syncExisting });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function checkInvariants(pool) {
  const client = await pool.connect();

  try {
    const [snapshotIssues, assetIssues, duplicateSymbols, settlementGaps] = await Promise.all([
      client.query(
        `
        SELECT
          'snapshot_complete_missing_fields' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.channel_daily_snapshots
        WHERE calculation_status = 'complete'
          AND (
            calculation_version IS NULL
            OR size_anchor_raw IS NULL
            OR view_signal IS NULL
            OR upload_signal IS NULL
            OR momentum_raw IS NULL
            OR momentum_multiplier IS NULL
            OR fundamental_value_raw IS NULL
            OR fundamental_value_smoothed IS NULL
          )
        UNION ALL
        SELECT
          'snapshot_negative_counts' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.channel_daily_snapshots
        WHERE subscriber_count < 0 OR view_count < 0 OR video_count < 0
      `
      ),
      client.query(
        `
        SELECT
          'asset_snapshot_pointer_mismatch' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.market_assets a
        LEFT JOIN market.channel_daily_snapshots s ON s.id = a.latest_snapshot_id
        WHERE a.latest_snapshot_id IS NOT NULL
          AND (
            s.id IS NULL
            OR s.youtube_channel_id <> a.youtube_channel_id
            OR s.snapshot_date <> a.latest_snapshot_date
            OR a.current_fair_value IS DISTINCT FROM s.fundamental_value_smoothed
            OR a.current_fair_value_raw IS DISTINCT FROM s.fundamental_value_raw
          )
        UNION ALL
        SELECT
          'asset_supply_invalid' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.market_assets
        WHERE treasury_supply < 0
          OR circulating_supply < 0
          OR circulating_supply + treasury_supply > max_supply
        UNION ALL
        SELECT
          'asset_quote_invalid' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.market_assets
        WHERE (current_bid_price IS NOT NULL AND current_ask_price IS NOT NULL AND current_bid_price > current_ask_price)
           OR current_mid_price < 0
           OR current_fair_value < 0
        UNION ALL
        SELECT
          'negative_cash_balance' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.portfolio_cash_balances
        WHERE cash_balance < 0
        UNION ALL
        SELECT
          'negative_holding_quantity' AS issue_type,
          COUNT(*)::BIGINT AS issue_count
        FROM market.portfolio_holdings
        WHERE quantity < 0 OR avg_cost_basis < 0
      `
      ),
      client.query(
        `
        SELECT symbol, COUNT(*)::BIGINT AS symbol_count
        FROM market.market_assets
        GROUP BY symbol
        HAVING COUNT(*) > 1
        ORDER BY symbol ASC
      `
      ),
      client.query(
        `
        SELECT
          r.market_date,
          COUNT(a.id)::BIGINT AS active_assets,
          COUNT(d.asset_id)::BIGINT AS settled_assets
        FROM market.market_settlement_runs r
        CROSS JOIN LATERAL (
          SELECT id
          FROM market.market_assets
          WHERE status = 'active'
        ) a
        LEFT JOIN market.asset_daily_market_state d
          ON d.asset_id = a.id
         AND d.market_date = r.market_date
        WHERE r.status = 'completed'
        GROUP BY r.market_date
        HAVING COUNT(d.asset_id) <> COUNT(a.id)
        ORDER BY r.market_date DESC
        LIMIT 20
      `
      ),
    ]);

    const issues = [...snapshotIssues.rows, ...assetIssues.rows]
      .map((row) => ({
        issue_type: row.issue_type,
        issue_count: Number(row.issue_count || 0),
      }))
      .filter((row) => row.issue_count > 0);

    return {
      ok: issues.length === 0 && duplicateSymbols.rows.length === 0 && settlementGaps.rows.length === 0,
      issues,
      duplicate_symbols: duplicateSymbols.rows,
      settlement_gaps: settlementGaps.rows,
    };
  } finally {
    client.release();
  }
}

async function getHistoricalMarketDateRange(pool, { activeOnly = true } = {}) {
  const queryTimeZone = getQueryTimeZone();
  const { rows } = await pool.query(
    `
    SELECT
      MIN(timezone($2, s.time)::date)::text AS min_date,
      MAX(timezone($2, s.time)::date)::text AS max_date
    FROM yt.youtube_channel_daily_stats s
    JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    WHERE ($1::boolean IS FALSE OR c.is_active = true)
  `,
    [activeOnly, queryTimeZone]
  );

  return {
    from: rows[0]?.min_date || null,
    to: rows[0]?.max_date || null,
  };
}

async function resetMarketState(pool) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM market.trade_fills`);
    await client.query(`DELETE FROM market.trade_orders`);
    await client.query(`DELETE FROM market.ledger_entries`);
    await client.query(`DELETE FROM market.portfolio_holdings`);
    await client.query(`DELETE FROM market.user_daily_net_worth`);
    await client.query(`DELETE FROM market.user_networth_history`);
    await client.query(`DELETE FROM market.user_leaderboard_current`);
    await client.query(`DELETE FROM market.asset_price_events`);
    await client.query(`DELETE FROM market.asset_daily_market_state`);
    await client.query(`DELETE FROM market.daily_market_reports`);
    await client.query(`DELETE FROM market.market_settlement_runs`);
    await client.query(`DELETE FROM market.fundamental_calculation_runs`);
    await client.query(`DELETE FROM market.market_assets`);
    await client.query(`DELETE FROM market.channel_daily_snapshots`);
    await client.query(
      `
      UPDATE market.market_runtime_state
      SET
        trading_status = 'open',
        active_phase = 'idle',
        trading_message = NULL,
        current_market_date = NULL,
        current_cycle_started_at = NULL,
        current_cycle_updated_at = NULL,
        last_settlement_market_date = NULL,
        last_settlement_completed_at = NULL,
        last_cycle_error = NULL,
        updated_at = now()
    `
    );

    const starterCash = getStarterCash();
    await client.query(`DELETE FROM market.portfolio_cash_balances`);
    await client.query(
      `
      INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, updated_at)
      SELECT id, $1, now()
      FROM market.users
    `,
      [starterCash]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      starter_cash: starterCash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  bootstrapAssets,
  bootstrapAssetsWithClient,
  checkInvariants,
  getHistoricalMarketDateRange,
  resetMarketState,
};
