// What the admin market simulator runs on (GET /api/admin/market-sim/inputs; the engine is
// app-client/app/lib/market-sim). Real stocks, the settings in force, every holding, wallet and
// recent fill, and a behavior profile per player, so the page can replay recent trading under other
// costs and run the market forward from where it stands.
//
// - Read-only: one READ ONLY transaction with a statement timeout, and every query bounded by a
//   date window and a LIMIT. Nothing here writes or changes a setting.
// - Anonymous: players leave as an index into a shuffled list (a keyed hash of the id with a salt
//   made when the process starts, so the order holds until the API restarts and can't be reversed
//   from the page). No ids, usernames or emails are selected at all.
// - No secret base rates: fair values come only from days whose four ticks have all landed
//   (market.marks_revealed, services/marketSecrecy.js), never today's, and nothing that would give
//   today's away (current fair value, offsets, premiums) is selected. Weekly evaluations only ever
//   use revealed days, so their scores and bases are safe too.

const crypto = require("node:crypto");
const trading = require("./trading");
const settlement = require("./settlement");
const adjustments = require("./marketAdjustments");
const weekly = require("./weeklyEvaluation");
const economy = require("./economy");
const supply = require("./marketSupply");

const HISTORY_DAYS = 90;
const REPLAY_DAYS = { min: 1, max: 30, fallback: 14 };
const PROFILE_DAYS = { min: 30, max: 60, fallback: 45 };
const LIMITS = { assets: 1_000, history: 200_000, holdings: 100_000, fills: 100_000, players: 20_000, evaluations: 20_000 };
const STATEMENT_TIMEOUT_MS = 20_000;
const FAVORITES = 8;
/**
 * Ledger entries the simulator models itself (trades, the weekly evaluation) or that don't repeat
 * (a new account's starter money, IPO allocations). Everything else a player's Cash and Credit
 * gained or lost (games, check-ins, referrals, predictions, bailouts, grants) is their outside income.
 */
const MODELED_ENTRIES = [
  "buy_asset_credit",
  "buy_cash_debit",
  "sell_asset_debit",
  "sell_cash_credit",
  "sell_credit",
  "trade_fee",
  "order_cash_hold",
  "order_cash_release",
  "dividend",
  "share_fee",
  "credit_conversion",
  "forced_buyback",
  "forced_buyback_cash",
  "starter_cash_grant",
  "ipo_allocation",
  "ipo_cash_release",
  "ipo_reversal",
];
const PLAYER_SALT = crypto.randomBytes(16);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, { min, max, fallback }) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shiftDate(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const round = (value, digits = 6) => Number(toNumber(value).toFixed(digits));
const nyDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** The mechanics in force, read from the services that apply them (their env vars included). */
function simSettings() {
  return {
    fee_rate: trading.getTradingFeeRate(),
    sell_credit_rate: economy.SETTINGS.sellCreditRate,
    slippage_weight: trading.IMPACT_SETTINGS.slippageWeight,
    transient_weight: trading.IMPACT_SETTINGS.transientWeight,
    persistent_weight: trading.IMPACT_SETTINGS.persistentWeight,
    transient_half_life_minutes: trading.IMPACT_SETTINGS.transientHalfLifeMinutes,
    live_order_share_limit: trading.IMPACT_SETTINGS.liveOrderShareLimitPerInterval,
    persistent_daily_decay: settlement.PERSISTENT_DAILY_DECAY,
    transient_settlement_decay: settlement.TRANSIENT_SETTLEMENT_DECAY,
    strength_total_pct: adjustments.INTERVAL_STRENGTH_TOTAL_PCT,
    intervals: adjustments.INTERVALS.map((interval) => ({ key: interval.key, label: interval.label, hour: interval.hour, day_offset: interval.dayOffset })),
    dividend: { rate_per_sigma: weekly.CONFIG.ratePerSigma, deadzone_sigma: weekly.CONFIG.deadzoneSigma, cap: weekly.CONFIG.cap },
    credit_conversion: { rate: economy.SETTINGS.weeklyConversionRate, minimum: economy.SETTINGS.weeklyConversionMinimum },
    reference_supply: supply.REFERENCE_SUPPLY,
  };
}

/** Players in a shuffled order that can't be traced back to their ids: userId → index. */
function anonymousIndex(userIds) {
  const keyed = [...new Set(userIds.map(String))].map((id) => ({ id, key: crypto.createHmac("sha256", PLAYER_SALT).update(id).digest("hex") }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return new Map(keyed.map((entry, index) => [entry.id, index]));
}

/**
 * How each player has traded lately, from their fills (oldest first) over `profileDays`:
 *   active_day_rate       share of days with at least one fill
 *   fills_per_active_day  fills on a day they trade
 *   size_log_mean/_sd     the spread of fill sizes (ln shares)
 *   buy_share             share of fills that are buys
 *   after_rise_share      share of buys made after the stock rose over the three days before
 *                         (above one half chases risers, below buys dips; null under 3 buys)
 *   hold_hours_median     time from the last buy of a stock to a sell of it
 *   take_profit/stop_loss the typical gain (loss) at which they sold, after the fee, on shares
 *                         bought inside the window (null under 2 such sells)
 *   sell_all_share        share of those sells that emptied the position
 *   favorites             the stocks they buy most, [asset, share of their buy cash]
 *   favorite_share        the share of their buy cash those favorites take
 * (getInputs adds outside_cash_per_day and outside_credit_per_day, from the ledger.)
 * `closeOf(assetIndex, dateKey)` gives a stock's close on a day (null when unknown).
 */
function buildProfiles(fills, { profileDays, closeOf }) {
  const byPlayer = new Map();
  for (const fill of fills) {
    if (!byPlayer.has(fill.player)) byPlayer.set(fill.player, []);
    byPlayer.get(fill.player).push(fill);
  }
  const profiles = new Map();
  for (const [player, list] of byPlayer) {
    const days = new Set(list.map((fill) => fill.date));
    const logs = list.map((fill) => Math.log(Math.max(fill.quantity, 1e-6)));
    const logMean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    const logSd = logs.length > 1 ? Math.sqrt(logs.reduce((sum, value) => sum + (value - logMean) ** 2, 0) / (logs.length - 1)) : null;
    const buys = list.filter((fill) => fill.side === "buy");

    let rises = 0;
    let counted = 0;
    for (const buy of buys) {
      const before = closeOf(buy.asset, shiftDate(buy.date, -1));
      const earlier = closeOf(buy.asset, shiftDate(buy.date, -4));
      if (!(before > 0) || !(earlier > 0)) continue;
      counted += 1;
      if (before > earlier) rises += 1;
    }

    const lastBuyAt = new Map();
    const positions = new Map(); // asset → { quantity, cost } bought inside the window
    const holds = [];
    const gains = [];
    let sellsKnown = 0;
    let sellsAll = 0;
    const buyCash = new Map();
    for (const fill of list) {
      const position = positions.get(fill.asset) || { quantity: 0, cost: 0 };
      if (fill.side === "buy") {
        lastBuyAt.set(fill.asset, fill.at);
        position.quantity += fill.quantity;
        position.cost += fill.gross + fill.fee;
        buyCash.set(fill.asset, (buyCash.get(fill.asset) || 0) + fill.gross);
      } else {
        if (lastBuyAt.has(fill.asset)) holds.push((fill.at - lastBuyAt.get(fill.asset)) / 3_600_000);
        if (position.quantity >= fill.quantity - 1e-9 && position.quantity > 0) {
          const basis = position.cost / position.quantity;
          gains.push((fill.gross - fill.fee) / (fill.quantity * basis) - 1);
          position.cost -= basis * fill.quantity;
          position.quantity -= fill.quantity;
          sellsKnown += 1;
          if (position.quantity <= 1e-6) {
            sellsAll += 1;
            position.quantity = 0;
            position.cost = 0;
          }
        } else {
          // Shares bought before the window: their cost isn't known here.
          position.quantity = 0;
          position.cost = 0;
        }
      }
      positions.set(fill.asset, position);
    }
    const ups = gains.filter((gain) => gain > 0);
    const downs = gains.filter((gain) => gain < 0);
    const totalBuyCash = [...buyCash.values()].reduce((sum, value) => sum + value, 0);
    const favorites = [...buyCash.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, FAVORITES)
      .map(([asset, cash]) => [asset, round(totalBuyCash > 0 ? cash / totalBuyCash : 0, 4)]);
    profiles.set(player, {
      active_day_rate: round(Math.min(1, days.size / profileDays), 4),
      fills_per_active_day: round(list.length / days.size, 3),
      size_log_mean: round(logMean, 4),
      size_log_sd: logSd === null ? null : round(logSd, 4),
      buy_share: round(buys.length / list.length, 4),
      after_rise_share: counted >= 3 ? round(rises / counted, 4) : null,
      hold_hours_median: holds.length ? round(median(holds), 2) : null,
      take_profit: ups.length >= 2 ? round(median(ups), 4) : null,
      stop_loss: downs.length >= 2 ? round(median(downs), 4) : null,
      sell_all_share: sellsKnown ? round(sellsAll / sellsKnown, 4) : null,
      favorites,
      favorite_share: round(favorites.reduce((sum, [, share]) => sum + share, 0), 4),
    });
  }
  return profiles;
}

const DORMANT_PROFILE = Object.freeze({
  active_day_rate: 0,
  fills_per_active_day: 0,
  size_log_mean: null,
  size_log_sd: null,
  buy_share: null,
  after_rise_share: null,
  hold_hours_median: null,
  take_profit: null,
  stop_loss: null,
  sell_all_share: null,
  favorites: [],
  favorite_share: 0,
});

async function readInputs(client, { replayDays, profileDays }) {
  const { rows: clock } = await client.query(`SELECT now() AS now, (now() AT TIME ZONE 'America/New_York')::date::text AS today`);
  const now = new Date(clock[0].now);
  const today = clock[0].today;

  const { rows: assetRows } = await client.query(
    `SELECT id, symbol, liquidity_depth, spread_bps, current_mid_price, circulating_supply, max_supply,
            adjustment_min_pct, adjustment_max_pct, adjustment_enabled, trading_state
       FROM market.market_assets
      WHERE status = 'active' AND current_mid_price > 0
      ORDER BY symbol
      LIMIT $1`,
    [LIMITS.assets]
  );
  const assetIndex = new Map(assetRows.map((row, index) => [String(row.id), index]));
  const assetIds = assetRows.map((row) => row.id);

  // Closes for every day; fair values only for days whose ticks have all landed.
  const { rows: historyRows } = await client.query(
    `WITH days AS (
       SELECT d, market.marks_revealed(d) AS revealed
         FROM (SELECT DISTINCT market_date AS d FROM market.asset_daily_market_state
                WHERE market_date > $2::date - $3::int AND market_date <= $2::date) x
     )
     SELECT s.asset_id, s.market_date::text AS market_date, s.mid_close, s.mid_open,
            CASE WHEN days.revealed THEN s.fair_value END AS fair_value
       FROM market.asset_daily_market_state s
       JOIN days ON days.d = s.market_date
      WHERE s.asset_id = ANY($1::bigint[])
      ORDER BY s.market_date, s.asset_id
      LIMIT $4`,
    [assetIds, today, HISTORY_DAYS, LIMITS.history]
  );

  const { rows: holdingRows } = await client.query(
    `SELECT user_id, asset_id, quantity, avg_cost_basis
       FROM market.portfolio_holdings
      WHERE quantity > 0 AND asset_id = ANY($1::bigint[])
      ORDER BY user_id, asset_id
      LIMIT $2`,
    [assetIds, LIMITS.holdings]
  );

  const { rows: fillRows } = await client.query(
    `SELECT user_id, asset_id, ts, (ts AT TIME ZONE 'America/New_York')::date::text AS ny_date,
            side, price, quantity, gross_cash, fee_cash
       FROM market.trade_fills
      WHERE ts > $2::timestamptz - make_interval(days => $3::int) AND asset_id = ANY($1::bigint[])
      ORDER BY ts, id
      LIMIT $4`,
    [assetIds, now, profileDays, LIMITS.fills]
  );

  const userIds = [...new Set([...holdingRows.map((row) => String(row.user_id)), ...fillRows.map((row) => String(row.user_id))])].slice(0, LIMITS.players);
  const { rows: walletRows } = await client.query(
    `SELECT user_id, cash_balance, held_cash, credit_balance
       FROM market.portfolio_cash_balances
      WHERE user_id = ANY($1::bigint[])
      LIMIT $2`,
    [userIds, LIMITS.players]
  );

  const { rows: incomeRows } = await client.query(
    `SELECT user_id, sum(cash_delta) AS cash, sum(credit_delta) AS credit
       FROM market.ledger_entries
      WHERE created_at > $1::timestamptz - make_interval(days => $2::int)
        AND user_id = ANY($3::bigint[])
        AND entry_type <> ALL($4::text[])
      GROUP BY user_id
      LIMIT $5`,
    [now, profileDays, userIds, MODELED_ENTRIES, LIMITS.players]
  );

  const replayFrom = new Date(now.getTime() - replayDays * 86_400_000);
  const { rows: evaluationRows } = await client.query(
    `SELECT e.eval_date::text AS eval_date, e.started_at, a.asset_id, a.z_score, a.value_basis
       FROM market.weekly_evaluations e
       JOIN market.weekly_asset_evaluations a ON a.evaluation_id = e.id
      WHERE e.status = 'completed' AND e.started_at > $1::timestamptz AND a.asset_id = ANY($2::bigint[])
      ORDER BY e.started_at, a.asset_id
      LIMIT $3`,
    [replayFrom, assetIds, LIMITS.evaluations]
  );

  return { now, today, assetRows, assetIndex, historyRows, holdingRows, fillRows, walletRows, incomeRows, evaluationRows, userIds, replayFrom };
}

function shapeInputs(raw, { replayDays, profileDays }) {
  const { now, today, assetRows, assetIndex, historyRows, holdingRows, fillRows, walletRows, incomeRows, evaluationRows, userIds, replayFrom } = raw;
  const playerIndex = anonymousIndex(userIds);
  const playerOf = (userId) => playerIndex.get(String(userId));

  const dates = [];
  for (let day = HISTORY_DAYS - 1; day >= 0; day -= 1) dates.push(shiftDate(today, -day));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const assets = assetRows.map((row) => ({
    symbol: row.symbol,
    depth: toNumber(row.liquidity_depth, 2000),
    spread_bps: toNumber(row.spread_bps, 0),
    mid: toNumber(row.current_mid_price),
    held: toNumber(row.circulating_supply),
    max_shares: toNumber(row.max_supply),
    strength_min_pct: toNumber(row.adjustment_min_pct, 0),
    strength_max_pct: toNumber(row.adjustment_max_pct, adjustments.INTERVAL_STRENGTH_TOTAL_PCT),
    ticks_enabled: row.adjustment_enabled !== false,
    frozen: row.trading_state === "buyback",
    close: dates.map(() => null),
    fair: dates.map(() => null),
  }));
  for (const row of historyRows) {
    const asset = assets[assetIndex.get(String(row.asset_id))];
    const day = dateIndex.get(row.market_date);
    if (!asset || day === undefined) continue;
    const close = toNumber(row.mid_close, toNumber(row.mid_open, 0));
    asset.close[day] = close > 0 ? close : null;
    const fair = row.fair_value === null ? 0 : toNumber(row.fair_value, 0);
    asset.fair[day] = fair > 0 ? fair : null;
  }
  const closeOf = (asset, dateKey) => {
    const day = dateIndex.get(dateKey);
    return day === undefined ? null : assets[asset]?.close[day] ?? null;
  };

  const fills = [];
  for (const row of fillRows) {
    const asset = assetIndex.get(String(row.asset_id));
    const player = playerOf(row.user_id);
    if (asset === undefined || player === undefined) continue;
    fills.push({
      at: new Date(row.ts).getTime(),
      date: row.ny_date,
      player,
      asset,
      side: row.side === "sell" ? "sell" : "buy",
      quantity: toNumber(row.quantity),
      price: toNumber(row.price),
      gross: toNumber(row.gross_cash),
      fee: toNumber(row.fee_cash),
    });
  }
  const profiles = buildProfiles(fills, { profileDays, closeOf });

  const income = new Map(incomeRows.map((row) => [playerOf(row.user_id), { cash: toNumber(row.cash), credit: toNumber(row.credit) }]));
  const players = Array.from({ length: playerIndex.size }, (_, index) => ({
    cash: 0,
    credit: 0,
    holdings: [],
    profile: {
      ...(profiles.get(index) || DORMANT_PROFILE),
      // Net Cash and Credit a day from outside the market (see MODELED_ENTRIES).
      outside_cash_per_day: round((income.get(index)?.cash ?? 0) / profileDays, 2),
      outside_credit_per_day: round((income.get(index)?.credit ?? 0) / profileDays, 2),
    },
  }));
  for (const row of walletRows) {
    const player = players[playerOf(row.user_id)];
    if (!player) continue;
    // Cash a queued buy has set aside is still the player's.
    player.cash = round(toNumber(row.cash_balance) + toNumber(row.held_cash), 2);
    player.credit = round(toNumber(row.credit_balance), 2);
  }
  for (const row of holdingRows) {
    const player = players[playerOf(row.user_id)];
    const asset = assetIndex.get(String(row.asset_id));
    if (!player || asset === undefined) continue;
    player.holdings.push([asset, toNumber(row.quantity), toNumber(row.avg_cost_basis)]);
  }

  const evaluations = [];
  for (const row of evaluationRows) {
    const asset = assetIndex.get(String(row.asset_id));
    if (asset === undefined) continue;
    let evaluation = evaluations[evaluations.length - 1];
    if (!evaluation || evaluation.eval_date !== row.eval_date) {
      evaluation = { eval_date: row.eval_date, at: new Date(row.started_at).getTime(), assets: [] };
      evaluations.push(evaluation);
    }
    const z = row.z_score === null ? null : toNumber(row.z_score, NaN);
    evaluation.assets.push([asset, Number.isFinite(z) ? z : null, toNumber(row.value_basis, 0)]);
  }

  const replayStart = replayFrom.getTime();
  const replayFills = fills
    .filter((fill) => fill.at > replayStart)
    .map(({ at, date, player, asset, side, quantity, price, fee }) => ({ at, date, player, asset, side, quantity, price, fee }));

  return {
    generated_at: now.toISOString(),
    today,
    window: {
      replay_days: replayDays,
      replay_from: replayFrom.toISOString(),
      replay_from_date: nyDateFormatter.format(replayFrom),
      profile_days: profileDays,
      history_days: HISTORY_DAYS,
      fills_truncated: fillRows.length >= LIMITS.fills,
    },
    settings: simSettings(),
    dates,
    assets,
    players,
    fills: replayFills,
    evaluations,
  };
}

/** Everything the simulator needs, read in one bounded, read-only transaction. */
async function getInputs(pool, { replayDays, profileDays } = {}) {
  const options = { replayDays: clampInt(replayDays, REPLAY_DAYS), profileDays: clampInt(profileDays, PROFILE_DAYS) };
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const raw = await readInputs(client, options);
    await client.query("COMMIT");
    return shapeInputs(raw, options);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getInputs, simSettings, buildProfiles, anonymousIndex, HISTORY_DAYS, REPLAY_DAYS, PROFILE_DAYS };
