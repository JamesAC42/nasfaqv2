// Frozen row-at-a-time weekly evaluation from 0adc01e (before batching); reference oracle for the
// batched evaluation's equivalence test. It is the old runWeeklyEvaluation with its database helpers
// and the old economy.convertCredit, unchanged; the maths (rank scores, rates, max shares) comes from
// the live module, since the test is about how the evaluation reads and writes, not its formulas.
const supply = require("../../src/services/marketSupply");
const economy = require("../../src/services/economy");
const notifications = require("../../src/services/notifications");
const { CONFIG, rankScores, zScores, dividendRate, maxSharesFor } = require("../../src/services/weeklyEvaluation");

const LOCK_KEY = 9_204_010;
const ROOKIE_DAYS = 28;

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round = (value, digits = 6) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));
const money = (value) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = toNumber;

async function loadAssets(client, evalDate, { lock = true } = {}) {
  const { rows } = await client.query(
    `
    WITH revealed_day AS (
      SELECT MAX(sess.market_date) AS d
      FROM market.adjustment_sessions sess
      WHERE sess.market_date < $1::date
        AND NOT EXISTS (SELECT 1 FROM market.asset_adjustment_intervals i WHERE i.session_id = sess.id AND i.status = 'scheduled')
    ),
    now_state AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, d.market_date, s.fundamental_value_smoothed AS value_now
      FROM market.asset_daily_market_state d
      JOIN market.channel_daily_snapshots s ON s.id = d.snapshot_id
      CROSS JOIN revealed_day r
      WHERE d.market_date <= r.d
      ORDER BY d.asset_id, d.market_date DESC
    ),
    before_state AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, s.fundamental_value_smoothed AS value_before
      FROM market.asset_daily_market_state d
      JOIN market.channel_daily_snapshots s ON s.id = d.snapshot_id
      JOIN now_state n ON n.asset_id = d.asset_id
      WHERE d.market_date <= n.market_date - 7
      ORDER BY d.asset_id, d.market_date DESC
    ),
    revealed AS (
      SELECT d.asset_id, AVG(d.fair_value) AS avg_base, (ARRAY_AGG(d.fair_value ORDER BY d.market_date DESC))[1] AS last_base
      FROM market.asset_daily_market_state d
      CROSS JOIN revealed_day r
      WHERE d.market_date > r.d - 7 AND d.market_date <= r.d
      GROUP BY d.asset_id
    ),
    subs AS (
      SELECT DISTINCT ON (s.youtube_channel_id) s.youtube_channel_id, s.subscriber_count
      FROM market.channel_daily_snapshots s
      WHERE s.calculation_status = 'complete' AND s.snapshot_date <= $1::date
      ORDER BY s.youtube_channel_id, s.snapshot_date DESC
    ),
    day_open AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, d.mid_open
      FROM market.asset_daily_market_state d
      ORDER BY d.asset_id, d.market_date DESC
    )
    SELECT a.id, a.symbol, a.display_name, a.max_supply, a.circulating_supply, a.treasury_supply, a.broker_buffer_pct,
           a.trading_state, a.current_mid_price, o.mid_open AS day_open,
           sb.subscriber_count, n.value_now, b.value_before, r.avg_base, r.last_base AS last_revealed_base,
           (l.listed_on IS NOT NULL AND l.listed_on > $1::date - ${ROOKIE_DAYS}) AS rookie
    FROM market.market_assets a
    LEFT JOIN market.ipo_listings l ON l.asset_id = a.id AND l.status = 'listed'
    LEFT JOIN subs sb ON sb.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN now_state n ON n.asset_id = a.id
    LEFT JOIN before_state b ON b.asset_id = a.id
    LEFT JOIN revealed r ON r.asset_id = a.id
    LEFT JOIN day_open o ON o.asset_id = a.id
    WHERE a.status = 'active'
    ORDER BY a.symbol
    ${lock ? "FOR UPDATE OF a" : ""}
  `,
    [evalDate]
  );
  return rows;
}

async function holdersOf(client, assetId, { lock = true } = {}) {
  const { rows } = await client.query(
    `SELECT user_id, quantity, avg_cost_basis FROM market.portfolio_holdings WHERE asset_id = $1 AND quantity > 0 ORDER BY user_id ${lock ? "FOR UPDATE" : ""}`,
    [assetId]
  );
  return rows.map((row) => ({ userId: Number(row.user_id), quantity: toNumber(row.quantity, 0), avgCost: toNumber(row.avg_cost_basis, 0) }));
}

async function addCash(client, userId, delta, { assetId, entryType, evaluationId }) {
  await client.query(
    `
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (user_id) DO UPDATE SET cash_balance = market.portfolio_cash_balances.cash_balance + $2, updated_at = now()
  `,
    [userId, delta]
  );
  await client.query(
    `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id) VALUES ($1,$2,$3,0,$4,'weekly_evaluation',$5)`,
    [userId, assetId, entryType, delta, evaluationId]
  );
}

async function writeMove(client, userId, { cash, credit, entryType, referenceType, referenceId, assetId = null, quantityDelta = 0 }) {
  if (cash || credit) {
    await client.query(
      `
      UPDATE market.portfolio_cash_balances
      SET cash_balance = cash_balance + $2, credit_balance = credit_balance + $3, updated_at = now()
      WHERE user_id = $1
    `,
      [userId, cash, credit]
    );
  }
  await client.query(
    `
    INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `,
    [userId, assetId, entryType, quantityDelta, cash, credit, referenceType, referenceId]
  );
}

async function convertCredit(client, { rate = economy.SETTINGS.weeklyConversionRate, minimum = economy.SETTINGS.weeklyConversionMinimum, evaluationId }) {
  const share = Math.min(Math.max(num(rate), 0), 0.5);
  const floor = Math.max(num(minimum), 0);
  if (!(share > 0) && !(floor > 0)) return { players: 0, converted: 0, rate: share, minimum: floor, moves: [] };
  const { rows } = await client.query(
    `
    SELECT user_id, LEAST(credit_balance, GREATEST(round(credit_balance * $1, 2), $2)) AS amount
    FROM market.portfolio_cash_balances
    WHERE credit_balance > 0
    FOR UPDATE
  `,
    [share, floor]
  );
  let converted = 0;
  const moves = [];
  for (const row of rows) {
    const amount = num(row.amount);
    await writeMove(client, Number(row.user_id), {
      cash: amount,
      credit: -amount,
      entryType: "credit_conversion",
      referenceType: "weekly_evaluation",
      referenceId: evaluationId,
    });
    converted += amount;
    moves.push({ userId: Number(row.user_id), amount });
  }
  return { players: rows.length, converted: Math.round(converted * 100) / 100, rate: share, minimum: floor, moves };
}

async function runWeeklyEvaluation(pool, { evalDate, dryRun = false, onDemand = false, redis = null, logger = console } = {}) {
  const client = await pool.connect();
  const toPublish = [];
  let report = null;
  try {
    await client.query("BEGIN");
    if (!dryRun) {
      const { rows: lock } = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [LOCK_KEY]);
      if (!lock[0]?.ok) {
        await client.query("ROLLBACK");
        return { ok: false, skipped: "locked" };
      }
    }
    // An evaluation runs once. (Its row only exists once it has committed; a failed run leaves none.)
    // Re-running would pay dividends twice and force buybacks that just started, so it is refused.
    const { rows: existing } = await client.query(`SELECT id, status FROM market.weekly_evaluations WHERE eval_date = $1`, [evalDate]);
    if (existing[0]) {
      await client.query("ROLLBACK");
      return { ok: true, skipped: "already_completed", eval_date: evalDate };
    }
    const { rows: previous } = await client.query(`SELECT COUNT(*)::int AS n FROM market.weekly_evaluations WHERE status = 'completed' AND eval_date < $1`, [evalDate]);
    const firstEvaluation = previous[0].n === 0;
    const { rows: created } = await client.query(`INSERT INTO market.weekly_evaluations (eval_date) VALUES ($1) RETURNING id`, [evalDate]);
    const evaluationId = Number(created[0].id);

    const lock = !dryRun; // a preview reads without row locks so it never holds up live fills
    const assets = await loadAssets(client, evalDate, { lock });
    const byUser = new Map(); // userId → { dividends, fees, forced: [...], buybacks: [...] }
    const userEntry = (userId) => {
      if (!byUser.has(userId)) byUser.set(userId, { dividends: 0, fees: 0, lines: [], forced: [], buybacks: [] });
      return byUser.get(userId);
    };
    // Keyed by the id as text (node-pg returns BIGINT ids as strings).
    const results = new Map(assets.map((asset) => [String(asset.id), { asset, held: toNumber(asset.circulating_supply, 0), buybackAction: null }]));

    // 1. Close buybacks.
    const buybacksClosed = [];
    const { rows: activeBuybacks } = await client.query(`SELECT * FROM market.asset_buybacks WHERE status = 'active' ORDER BY asset_id ${lock ? "FOR UPDATE" : ""}`);
    for (const buyback of activeBuybacks) {
      const result = results.get(String(buyback.asset_id));
      if (!result) continue;
      const { asset } = result;
      const holders = await holdersOf(client, asset.id, { lock });
      const held = holders.reduce((sum, holder) => sum + holder.quantity, 0);
      const excess = held - toNumber(asset.max_supply, 0);
      // The base rate of the last day whose ticks have landed (never today's secret one).
      const price = toNumber(asset.last_revealed_base, toNumber(buyback.frozen_price, 0));
      let forcedShares = 0;
      if (excess > 0 && held > 0) {
        for (const holder of holders) {
          // Rounded up to the micro-share so the stock ends at or just under its max.
          const take = Math.min(holder.quantity, Math.ceil(((holder.quantity * excess) / held) * 1e6) / 1e6);
          if (!(take > 0)) continue;
          forcedShares += take;
          const cash = take * price;
          await client.query(`UPDATE market.portfolio_holdings SET quantity = GREATEST(quantity - $3, 0), updated_at = now() WHERE user_id = $1 AND asset_id = $2`, [holder.userId, asset.id, take]);
          await client.query(
            `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id) VALUES ($1,$2,'forced_buyback',$3,0,'weekly_evaluation',$4)`,
            [holder.userId, asset.id, -take, evaluationId]
          );
          await addCash(client, holder.userId, cash, { assetId: asset.id, entryType: "forced_buyback_cash", evaluationId });
          userEntry(holder.userId).forced.push({ symbol: asset.symbol, shares: take, cash });
        }
      }
      await client.query(
        `UPDATE market.asset_buybacks SET status = $2, ended_at = now(), closed_evaluation_id = $3, forced_shares = $4, forced_price = $5 WHERE id = $1`,
        [buyback.id, forcedShares > 0 ? "forced" : "met", evaluationId, forcedShares, forcedShares > 0 ? price : null]
      );
      await client.query(`UPDATE market.market_assets SET trading_state = 'open', updated_at = now() WHERE id = $1`, [asset.id]);
      asset.trading_state = "open";
      result.held = held - forcedShares;
      await supply.setHeld(client, asset.id, result.held);
      result.buybackAction = forcedShares > 0 ? "forced" : "met";
      buybacksClosed.push({ symbol: asset.symbol, display_name: asset.display_name, status: result.buybackAction, forced_shares: round(forcedShares), forced_price: forcedShares > 0 ? round(price) : null, shares_bought: round(toNumber(buyback.shares_bought, 0)) });
    }

    // 2. Dividends and share fees.
    const shifts = assets.map((asset) => {
      const now = toNumber(asset.value_now, 0);
      const before = toNumber(asset.value_before, 0);
      return now > 0 && before > 0 && !asset.rookie ? Math.log(now / before) : NaN;
    });
    const shiftZ = rankScores(shifts);
    let dividendsTotal = 0;
    let feesTotal = 0;
    for (const [index, asset] of assets.entries()) {
      const result = results.get(String(asset.id));
      const z = shiftZ[index];
      const rate = dividendRate(z);
      const basis = toNumber(asset.avg_base, 0); // revealed base rates only; none known means no payout
      const perShare = rate * basis;
      Object.assign(result, { shift: Number.isFinite(shifts[index]) ? shifts[index] : null, z, rate, basis, perShare, paid: 0 });
      if (!perShare) continue;
      const holders = await holdersOf(client, asset.id, { lock });
      for (const holder of holders) {
        const amount = Math.round(holder.quantity * perShare * 100) / 100;
        if (!amount) continue;
        // Dividends pay Credit; share fees come out of Credit first, then Cash (which can go below zero).
        const ledger = { referenceType: "weekly_evaluation", referenceId: evaluationId, assetId: asset.id };
        if (amount > 0) await economy.pay(client, holder.userId, amount, { to: "credit", entryType: "dividend", ...ledger });
        else await economy.charge(client, holder.userId, -amount, { from: "credit_then_cash", shortfall: "cash", entryType: "share_fee", ...ledger });
        await client.query(
          `INSERT INTO market.dividend_payouts (evaluation_id, user_id, asset_id, quantity, per_share, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
          [evaluationId, holder.userId, asset.id, holder.quantity, perShare, amount]
        );
        const entry = userEntry(holder.userId);
        if (amount > 0) entry.dividends += amount;
        else entry.fees += amount;
        entry.lines.push({ symbol: asset.symbol, amount });
        result.paid += amount;
        if (amount > 0) dividendsTotal += amount;
        else feesTotal += amount;
      }
    }

    // 2b. Part of every player's Credit turns into Cash (economy.SETTINGS.weeklyConversionRate).
    const conversion = await convertCredit(client, { evaluationId });
    for (const move of conversion.moves) if (byUser.has(move.userId)) byUser.get(move.userId).converted = move.amount;

    // 3. Max shares from subscribers; buybacks for stocks now over their max.
    const subsZ = zScores(assets.map((asset) => (toNumber(asset.subscriber_count, 0) > 0 ? Math.log(toNumber(asset.subscriber_count, 0)) : NaN)));
    const buybacksStarted = [];
    for (const [index, asset] of assets.entries()) {
      const result = results.get(String(asset.id));
      const before = toNumber(asset.max_supply, 0);
      const bufferPct = Math.max(0, toNumber(asset.broker_buffer_pct, 0.02));
      let after = subsZ[index] === null ? before : maxSharesFor(subsZ[index]);
      if (firstEvaluation || asset.rookie) after = Math.max(after, Math.ceil(result.held / Math.max(1 - bufferPct, 0.5) / CONFIG.maxSharesStep) * CONFIG.maxSharesStep);
      result.maxBefore = before;
      result.maxAfter = after;
      await client.query(
        `UPDATE market.market_assets SET max_supply = $2, treasury_supply = GREATEST($2 - circulating_supply, 0), updated_at = now() WHERE id = $1`,
        [asset.id, after]
      );
      if (result.held > after + 0.001 && asset.trading_state !== "buyback") {
        // Frozen at the lower of now and today's open, so a late pump can't raise the broker's bid.
        const mid = toNumber(asset.current_mid_price, 0);
        const open = toNumber(asset.day_open, 0);
        const frozenPrice = open > 0 ? Math.min(mid, open) : mid;
        await client.query(
          `INSERT INTO market.asset_buybacks (asset_id, started_evaluation_id, frozen_price, target_max_supply, held_at_start) VALUES ($1,$2,$3,$4,$5)`,
          [asset.id, evaluationId, frozenPrice, after, result.held]
        );
        await client.query(`UPDATE market.market_assets SET trading_state = 'buyback', updated_at = now() WHERE id = $1`, [asset.id]);
        result.buybackAction = result.buybackAction ? `${result.buybackAction}+started` : "started";
        buybacksStarted.push({ symbol: asset.symbol, display_name: asset.display_name, held: round(result.held), max_supply: after, over: round(result.held - after), frozen_price: round(frozenPrice), offer: round(frozenPrice * supply.BUYBACK_START) });
        for (const holder of await holdersOf(client, asset.id, { lock })) userEntry(holder.userId).buybacks.push({ symbol: asset.symbol, offer: frozenPrice * supply.BUYBACK_START });
      }
      await client.query(
        `
        INSERT INTO market.weekly_asset_evaluations (evaluation_id, asset_id, value_now, value_before, shift, z_score, dividend_rate, value_basis, per_share, held, subscribers, max_supply_before, max_supply_after, buyback_action)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
        [evaluationId, asset.id, asset.value_now, asset.value_before, round(result.shift), round(result.z), round(result.rate), round(result.basis), round(result.perShare), round(result.held), asset.subscriber_count, before, after, result.buybackAction]
      );
    }

    // 4. The Dividend Review.
    const rows = assets.map((asset) => {
      const result = results.get(String(asset.id));
      return {
        symbol: asset.symbol,
        display_name: asset.display_name,
        rate: round(result.rate),
        per_share: round(result.perShare),
        paid: round(result.paid, 2),
        held: round(result.held),
        max_supply_before: result.maxBefore,
        max_supply_after: result.maxAfter,
        buyback: result.buybackAction,
      };
    });
    const payers = rows.filter((row) => row.rate > 0).sort((a, b) => b.rate - a.rate);
    const chargers = rows.filter((row) => row.rate < 0).sort((a, b) => a.rate - b.rate);
    const users = [...byUser.values()];
    report = {
      eval_date: evalDate,
      generated_at: new Date().toISOString(),
      first_evaluation: firstEvaluation,
      on_demand: onDemand,
      asset_count: rows.length,
      dividends_total: round(dividendsTotal, 2),
      fees_total: round(feesTotal, 2),
      credit_conversion_rate: conversion.rate ?? 0,
      credit_conversion_minimum: conversion.minimum ?? 0,
      credit_converted: conversion.converted,
      players_converted: conversion.players,
      holders_paid: users.filter((entry) => entry.dividends > 0).length,
      holders_charged: users.filter((entry) => entry.fees < 0).length,
      paying_count: payers.length,
      charging_count: chargers.length,
      flat_count: rows.length - payers.length - chargers.length,
      top_dividends: payers.slice(0, 5),
      top_fees: chargers.slice(0, 5),
      max_shares_raised: rows.filter((row) => row.max_supply_after > row.max_supply_before).sort((a, b) => b.max_supply_after - b.max_supply_before - (a.max_supply_after - a.max_supply_before)).slice(0, 5),
      max_shares_lowered: rows.filter((row) => row.max_supply_after < row.max_supply_before).sort((a, b) => a.max_supply_after - a.max_supply_before - (b.max_supply_after - b.max_supply_before)).slice(0, 5),
      buybacks_started: buybacksStarted,
      buybacks_closed: buybacksClosed,
      assets: rows,
      config: { ...CONFIG, buyback_start: supply.BUYBACK_START, buyback_daily_step: supply.BUYBACK_DAILY_STEP, buyback_floor: supply.BUYBACK_FLOOR },
    };
    await client.query(`UPDATE market.weekly_evaluations SET status = 'completed', completed_at = now(), report_json = $2::jsonb WHERE id = $1`, [evaluationId, JSON.stringify(report)]);

    if (!dryRun) {
      for (const [userId, entry] of byUser) {
        const net = entry.dividends + entry.fees + entry.forced.reduce((sum, item) => sum + item.cash, 0);
        const parts = [];
        if (entry.dividends) parts.push(`${money(entry.dividends)} in dividends, as Credit`);
        if (entry.fees) parts.push(`${money(entry.fees)} in share fees`);
        if (entry.converted) parts.push(`${money(entry.converted)} of your Credit turned into Cash`);
        for (const item of entry.forced) parts.push(`the broker bought back ${round(item.shares, 2)} ${item.symbol} for ${money(item.cash)}`);
        for (const item of entry.buybacks) parts.push(`${item.symbol} is frozen for a buyback at ${money(item.offer)} a share`);
        if (!parts.length) continue;
        const title = entry.dividends && !entry.fees ? `DIVS: ${money(entry.dividends)}` : entry.fees && !entry.dividends ? `Share fees: ${money(entry.fees)}` : `Weekly evaluation: ${money(net)}`;
        const row = await notifications.notify(
          client,
          userId,
          { kind: entry.buybacks.length || entry.forced.length ? "buyback" : "dividend", title, body: `${parts.join("; ")}.`, href: "/market/dividends", data: { eval_date: evalDate, net: round(net, 2) } },
          { publish: false }
        );
        if (row) toPublish.push(row);
      }
    }

    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error?.("weekly evaluation failed:", String(error?.message || error));
    throw error;
  } finally {
    client.release();
  }

  if (!dryRun) {
    notifications.publish(toPublish);
  }
  return { ok: true, dry_run: dryRun, eval_date: evalDate, report };
}

module.exports = { runWeeklyEvaluation };
