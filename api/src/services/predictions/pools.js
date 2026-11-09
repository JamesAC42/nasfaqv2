// Prediction pools (docs/design/predictions-pools.md): v1's betting pools, plus quality of life and
// margin. A pool is a row in market.prediction_markets with pricing = 'pool'. Players stake Credit
// (then Cash) on options. The bookie picks the winner with a source, and the winners split the whole
// pool in proportion to stake, with no rake (poolMath.js). The house never takes a side, so it can't
// lose.
//
// - Bookies (market.users.is_bookie; admins count) open pools without approval and resolve their
//   own. They can't bet in their own pools, and nobody resolves a pool they have money in.
// - Staff can correct or void a result for 7 days after it first resolves. Payouts are reversed
//   first, from Credit, which can go below zero (as a void can for the LMSR markets).
// - Every resolve, correction and void goes in prediction_pool_resolutions, the pool's public record.
// - Auto pools (stream-peak-pool, top-gainer-pool) come from auto.js and go through guards.js on
//   every bet, like the LMSR auto markets.
// - All of it is behind the prediction-pools flag (api/src/features/prediction-pools.json).

const economy = require("../economy");
const { assertAboveFloor } = require("../sideModeFloor");
const margin = require("../margin");
const notifications = require("../notifications");
const core = require("./core");
const guards = require("./guards");
const markets = require("./markets");
const features = require("../../features");
const poolMath = require("./poolMath");
const resolution = require("./resolution");

const { num, round2, predictionError } = core;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SETTINGS = Object.freeze({
  /** Owner (2026-11-06): the smallest bet and the smallest raise (v1: $5,000). A bookie can ask for more. */
  minBet: envNumber("POOL_MIN_BET", 1000),
  maxBet: envNumber("POOL_MAX_BET", 5_000_000),
  /** Owner (2026-11-06): accounts younger than this can have at most `newAccountStakeCap` staked across open pools. */
  newAccountHours: envNumber("POOL_NEW_ACCOUNT_HOURS", 168),
  newAccountStakeCap: envNumber("POOL_NEW_ACCOUNT_STAKE_CAP", 10_000),
  /** Owner (2026-11-06): staff can correct or void a result this long after it first resolves. */
  correctionWindowHours: envNumber("POOL_CORRECTION_WINDOW_HOURS", 168),
});

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 100;
const MIN_CLOSE_MS = 2 * 60_000;
const MAX_OPEN_MS = 28 * 24 * 3_600_000;
const UNRESOLVED = ["open", "closed", "resolving"];
const REFERENCE = "prediction_pool";

const money = (value) => notifications.money(value);
const poolHref = (slug) => `/predictions/pools/${encodeURIComponent(slug)}`;
/** Bookies open and resolve pools; admins count as bookies. */
const isBookie = (user) => Boolean(user?.is_admin || user?.is_bookie);
const isStaff = (user) => Boolean(user?.is_admin || user?.can_void_prediction_markets || user?.can_resolve_prediction_markets);

function notFound() {
  return predictionError("prediction_market_not_found");
}

function assertCanSee(user) {
  if (!features.isEnabled("prediction-pools", user)) throw notFound();
}

/** Who runs this pool: its bookie, an admin, or (for auto pools) resolving staff. */
function canManage(user, market) {
  if (!user) return false;
  if (user.is_admin) return true;
  if (market.creator_user_id === null || market.creator_user_id === undefined) return Boolean(user.can_resolve_prediction_markets);
  return isBookie(user) && String(market.creator_user_id) === String(user.id);
}

function correctionOpen(market, now = Date.now()) {
  if (!market.resolved_at) return false;
  return now - new Date(market.resolved_at).getTime() <= SETTINGS.correctionWindowHours * 3_600_000;
}

const effectiveMinBet = (market) => Math.max(SETTINGS.minBet, num(market.min_bet, 0));

const isBettable = (market, now = new Date()) =>
  market.pricing === "pool" && market.status === "open" && market.trading_status === "open" && new Date(market.opens_at) <= now && new Date(market.closes_at) > now;

// ── Creation ───────────────────────────────────────────────────────────────
function text(value, { min = 0, max = 1000, field }) {
  const out = String(value ?? "").trim();
  if (out.length < min || out.length > max) throw predictionError("invalid_pool", { field });
  return out;
}

/** Inserts a pool and its options. Used by bookies (createPool) and the auto pool templates. */
async function insertPoolWithClient(client, input, { creatorId = null, kind = "event", autoTemplate = null, autoKey = null, autoData = {}, now = new Date() } = {}) {
  const title = text(input.title, { min: 4, max: 200, field: "title" });
  const rules = text(input.rules_text || "The bookie picks the winning option once the result is known, and links the source.", { min: 10, max: 10_000, field: "rules_text" });
  const source = text(input.resolution_source_text || "Picked by the bookie, with a source link or note on the pool's record.", { min: 3, max: 5000, field: "resolution_source_text" });
  const closesAt = new Date(input.closes_at);
  if (Number.isNaN(closesAt.getTime())) throw predictionError("invalid_pool", { field: "closes_at" });
  const minClose = kind === "auto" ? 60_000 : MIN_CLOSE_MS;
  if (closesAt.getTime() < now.getTime() + minClose || closesAt.getTime() > now.getTime() + MAX_OPEN_MS) throw predictionError("invalid_pool", { field: "closes_at" });
  const minBet = input.min_bet === undefined || input.min_bet === null || input.min_bet === "" ? null : round2(input.min_bet);
  if (minBet !== null && !(minBet >= SETTINGS.minBet && minBet <= SETTINGS.maxBet)) throw predictionError("invalid_pool", { field: "min_bet" });

  const list = Array.isArray(input.options) ? input.options : [];
  if (list.length < MIN_OPTIONS || list.length > MAX_OPTIONS) throw predictionError("invalid_pool", { field: "options" });
  const options = list.map((entry, index) => {
    const raw = typeof entry === "string" ? { label: entry } : entry || {};
    return {
      code: raw.code || `o${index + 1}`,
      label: text(raw.label, { min: 1, max: 80, field: `options.${index}` }),
      assetSymbol: raw.asset_symbol ? String(raw.asset_symbol).toUpperCase().slice(0, 12) : null,
      assetId: raw.asset_id ? Number(raw.asset_id) : null,
    };
  });
  if (new Set(options.map((option) => option.label.toLowerCase())).size !== options.length) throw predictionError("invalid_pool", { field: "options" });

  let categoryId = null;
  if (input.category) {
    const { rows } = await client.query(`SELECT id FROM market.prediction_market_categories WHERE slug = $1`, [String(input.category)]);
    categoryId = rows[0]?.id ?? null;
  }
  const slug = await markets.uniqueSlug(client, input.slug || title);
  const marketType = options.length === 2 && options[0].code === "yes" ? "binary" : "multi";
  const { rows } = await client.query(
    `INSERT INTO market.prediction_markets
       (slug, title, subtitle, description, rules_text, resolution_source_text, category_id, status, trading_status, visibility, market_type,
        creator_user_id, approver_user_id, approved_at, opens_at, closes_at, trading_opened_at, kind, liquidity_b, fee_bps,
        auto_template, auto_key, auto_data, amm_ready, pricing, min_bet)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open','open','public',$8,$9,$9,$10,$10,$11,$10,$12,250,0,$13,$14,$15,true,'pool',$16)
     RETURNING *`,
    [
      slug,
      title,
      input.subtitle ? text(input.subtitle, { max: 240, field: "subtitle" }) : null,
      input.description ? text(input.description, { max: 10_000, field: "description" }) : null,
      rules,
      source,
      categoryId,
      marketType,
      creatorId,
      now,
      closesAt,
      kind,
      autoTemplate,
      autoKey,
      JSON.stringify(autoData || {}),
      minBet,
    ]
  );
  const market = rows[0];
  for (const [index, option] of options.entries()) {
    let assetId = option.assetId;
    if (!assetId && option.assetSymbol) {
      const asset = await client.query(`SELECT id FROM market.market_assets WHERE symbol = $1`, [option.assetSymbol]);
      assetId = asset.rows[0]?.id ?? null;
    }
    await client.query(
      `INSERT INTO market.prediction_market_outcomes (market_id, outcome_code, label, sort_order, asset_id) VALUES ($1, $2, $3, $4, $5)`,
      [market.id, option.code, option.label, index, assetId]
    );
  }
  await core.logEvent(client, market.id, kind === "auto" ? "auto_created" : "pool_created", { options: options.length, template: autoTemplate }, creatorId);
  return market;
}

async function createPool(pool, actor, input) {
  assertCanSee(actor);
  if (!isBookie(actor)) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await insertPoolWithClient(client, input || {}, { creatorId: actor.id });
    return { id: Number(market.id), slug: market.slug, status: market.status, pricing: "pool" };
  });
}

// ── Betting ────────────────────────────────────────────────────────────────
async function lockPool(client, { id = null, slug = null }) {
  const market = await core.lockMarket(client, { id, slug });
  if (market.pricing !== "pool") throw notFound();
  return market;
}

/** What a player under the new-account rule has staked across pools that haven't finished. */
async function openStakeTotal(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(s.stake), 0) AS staked FROM market.prediction_pool_stakes s JOIN market.prediction_markets pm ON pm.id = s.market_id
     WHERE s.user_id = $1 AND pm.status = ANY($2::text[])`,
    [userId, UNRESOLVED]
  );
  return round2(rows[0]?.staked);
}

function newAccountUntil(row) {
  const until = new Date(row.created_at).getTime() + SETTINGS.newAccountHours * 3_600_000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

/**
 * Bets `amount` on an option, or adds it to what the player already has there. The money comes from
 * Credit, then Cash, then (with `useMargin`) the margin line. Returns the bet, the pool's new totals
 * and the player's wallet.
 */
async function placeBet(pool, user, { slug, outcomeCode, amount, useMargin = false }) {
  assertCanSee(user);
  const userId = Number(user.id);
  const value = round2(amount);
  if (!(value > 0) || value > SETTINGS.maxBet) throw predictionError("invalid_amount", { min_bet: SETTINGS.minBet });
  // Cash from a share sale pays down what's owed before anything else.
  await core.inTransaction(pool, (client) => margin.repayFromCash(client, userId));

  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { slug });
    if (!isBettable(market) || (await guards.autoMarketLock(client, market))) throw predictionError("prediction_market_closed");
    if (market.creator_user_id && String(market.creator_user_id) === String(userId)) throw predictionError("bookie_own_pool");
    const minBet = effectiveMinBet(market);
    if (value < minBet) throw predictionError("invalid_amount", { min_bet: minBet });
    const outcomes = await core.loadOutcomes(client, market.id);
    const outcome = outcomes.find((entry) => entry.outcome_code === String(outcomeCode || "").toLowerCase());
    if (!outcome) throw predictionError("invalid_outcome");

    const wallet = await economy.lockWallet(client, userId);
    if (wallet.credit < 0) throw predictionError("in_the_red", { owed: round2(-wallet.credit) });
    await assertAboveFloor(client, userId);
    const row = await margin.userRow(client, userId);
    const newUntil = newAccountUntil(row);
    if (newUntil) {
      const staked = await openStakeTotal(client, userId);
      if (staked + value > SETTINGS.newAccountStakeCap + 1e-9) {
        throw predictionError("new_account_pool_cap", { cap: SETTINGS.newAccountStakeCap, staked, available_at: newUntil });
      }
    }

    const own = Math.max(0, wallet.credit) + (economy.SETTINGS.sideModeFunds === "credit_then_cash" ? Math.max(0, wallet.cash) : 0);
    const borrowed = round2(Math.max(0, value - own));
    if (borrowed > 0) {
      const gate = margin.eligibility(row);
      const line = gate.eligible ? margin.computeLine(await margin.shareValue(client, userId)) : 0;
      if (!useMargin) throw predictionError("insufficient_credit", { cash_balance: round2(own), required_cash: value, margin_available: line });
      if (!gate.eligible) throw predictionError(gate.reason, { available_at: gate.available_at });
      if (borrowed > line + 1e-9) throw predictionError("margin_line_exceeded", { line, borrowed });
    }

    const charged = await economy.charge(client, userId, value, {
      from: economy.SETTINGS.sideModeFunds,
      shortfall: borrowed > 0 ? "credit" : null,
      entryType: "pool_bet",
      referenceType: REFERENCE,
      referenceId: market.id,
    });
    const fromCash = round2(-charged.cash_delta);
    const fromCredit = round2(value - fromCash - borrowed);
    const { rows: stakeRows } = await client.query(
      `INSERT INTO market.prediction_pool_stakes (market_id, outcome_id, user_id, stake, borrowed) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (market_id, outcome_id, user_id) DO UPDATE SET
         stake = market.prediction_pool_stakes.stake + EXCLUDED.stake, borrowed = market.prediction_pool_stakes.borrowed + EXCLUDED.borrowed, updated_at = now()
       RETURNING stake, borrowed`,
      [market.id, outcome.id, userId, value, borrowed]
    );
    const stakeAfter = round2(stakeRows[0].stake);
    const { rows: betRows } = await client.query(
      `INSERT INTO market.prediction_pool_bets (market_id, outcome_id, user_id, amount, from_credit, from_cash, borrowed, stake_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
      [market.id, outcome.id, userId, value, fromCredit, fromCash, borrowed, stakeAfter]
    );
    await client.query(`UPDATE market.prediction_market_outcomes SET pool_stake = pool_stake + $2, updated_at = now() WHERE id = $1`, [outcome.id, value]);
    const { rows: marketRows } = await client.query(
      `UPDATE market.prediction_markets SET pool_total = pool_total + $2, total_volume_cash = total_volume_cash + $2, last_trade_at = now(), updated_at = now()
       WHERE id = $1 RETURNING pool_total`,
      [market.id, value]
    );
    const after = await economy.lockWallet(client, userId);
    return {
      bet: {
        id: Number(betRows[0].id),
        market_id: Number(market.id),
        slug: market.slug,
        outcome_code: outcome.outcome_code,
        outcome_label: outcome.label,
        amount: value,
        from_credit: fromCredit,
        from_cash: fromCash,
        borrowed,
        stake_after: stakeAfter,
        at: betRows[0].created_at,
      },
      pool_total: round2(marketRows[0].pool_total),
      wallet: { credit: round2(after.credit), cash: round2(after.cash), spendable: round2(economy.sideModeSpendable(after)), owed: round2(Math.max(0, -after.credit)) },
    };
  });
}

// ── Bookie tools ───────────────────────────────────────────────────────────
async function closePool(pool, actor, marketId) {
  assertCanSee(actor);
  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { id: marketId });
    if (!canManage(actor, market)) throw predictionError("forbidden");
    if (market.status !== "open") throw predictionError("prediction_market_transition_invalid");
    await resolution.closeWithClient(client, market, { actorUserId: actor.id, reason: "closed_early" });
    return { id: Number(market.id), slug: market.slug, pricing: "pool" };
  });
}

/** A later closing time, while the pool is still open: at most 28 days after it opened. */
async function extendPool(pool, actor, marketId, { closesAt }) {
  assertCanSee(actor);
  const next = new Date(closesAt);
  if (Number.isNaN(next.getTime())) throw predictionError("invalid_pool", { field: "closes_at" });
  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { id: marketId });
    if (!canManage(actor, market)) throw predictionError("forbidden");
    if (market.kind === "auto") throw predictionError("forbidden");
    if (market.status !== "open") throw predictionError("prediction_market_transition_invalid");
    if (next <= new Date(market.closes_at) || next.getTime() > new Date(market.opens_at).getTime() + MAX_OPEN_MS) {
      throw predictionError("invalid_pool", { field: "closes_at" });
    }
    await client.query(`UPDATE market.prediction_markets SET closes_at = $2, updated_at = now() WHERE id = $1`, [market.id, next]);
    await core.logEvent(client, market.id, "pool_extended", { from: market.closes_at, to: next.toISOString() }, actor.id);
    return { id: Number(market.id), slug: market.slug, pricing: "pool" };
  });
}

function sourceAndNote({ sourceUrl, note }, { required = true } = {}) {
  const source = String(sourceUrl || "").trim();
  if (source && (!/^https?:\/\/\S+$/i.test(source) || source.length > 1000)) throw predictionError("invalid_source_url");
  const text = String(note || "").trim().slice(0, 2000);
  if (required && !source && !text) throw predictionError("resolution_note_required");
  return { source: source || null, note: text || null };
}

async function assertNoStake(client, market, actor) {
  const { rows } = await client.query(`SELECT 1 FROM market.prediction_pool_stakes WHERE market_id = $1 AND user_id = $2 LIMIT 1`, [market.id, actor.id]);
  if (rows.length) throw predictionError("bookie_has_stake");
}

function findOutcome(outcomes, code) {
  const outcome = outcomes.find((entry) => entry.outcome_code === String(code || "").toLowerCase());
  if (!outcome) throw predictionError("invalid_outcome");
  return outcome;
}

async function resolvePool(pool, actor, marketId, { outcome, sourceUrl, note }) {
  assertCanSee(actor);
  const record = sourceAndNote({ sourceUrl, note });
  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { id: marketId });
    if (!canManage(actor, market)) throw predictionError("forbidden");
    if (!UNRESOLVED.includes(market.status)) throw predictionError("prediction_market_transition_invalid");
    await assertNoStake(client, market, actor);
    const winner = findOutcome(await core.loadOutcomes(client, market.id), outcome);
    if (market.status === "open") await resolution.closeWithClient(client, market, { actorUserId: actor.id, reason: "resolved" });
    return settleWithClient(client, market, winner, { actorId: actor.id, ...record, action: "resolved" });
  });
}

/** Staff, within the correction window: reverse the payouts, then settle on the right option. */
async function correctPool(pool, actor, marketId, { outcome, sourceUrl, note }) {
  assertCanSee(actor);
  if (!isStaff(actor)) throw predictionError("forbidden");
  const record = sourceAndNote({ sourceUrl, note });
  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { id: marketId });
    if (market.status !== "resolved") throw predictionError("prediction_market_transition_invalid");
    if (!correctionOpen(market)) throw predictionError("correction_window_closed");
    await assertNoStake(client, market, actor);
    const outcomes = await core.loadOutcomes(client, market.id);
    const winner = findOutcome(outcomes, outcome);
    if (String(winner.id) === String(market.winning_outcome_id)) throw predictionError("same_outcome");
    const reversed = await reversePayoutsWithClient(client, market);
    return settleWithClient(client, market, winner, { actorId: actor.id, ...record, action: "corrected", previousOutcomeId: market.winning_outcome_id, reversed });
  });
}

/**
 * Void: every stake goes back where it came from. Its bookie can void a pool that hasn't resolved
 * (v1's refund); after it resolves, only staff can, within the correction window, and the payouts
 * are reversed first.
 */
async function voidPool(pool, actor, marketId, { reason, sourceUrl } = {}) {
  assertCanSee(actor);
  return core.inTransaction(pool, async (client) => {
    const market = await lockPool(client, { id: marketId });
    if (market.status === "resolved") {
      if (!isStaff(actor)) throw predictionError("forbidden");
      if (!correctionOpen(market)) throw predictionError("correction_window_closed");
    } else if (UNRESOLVED.includes(market.status)) {
      if (!canManage(actor, market) && !isStaff(actor)) throw predictionError("forbidden");
    } else {
      throw predictionError("prediction_market_transition_invalid");
    }
    const record = sourceAndNote({ sourceUrl, note: reason }, { required: false });
    return voidWithClient(client, market, { actorId: actor.id, reason: record.note, sourceUrl: record.source });
  });
}

// ── Settlement (inside a transaction, pool row locked) ─────────────────────
async function lockedStakes(client, marketId) {
  const { rows } = await client.query(`SELECT * FROM market.prediction_pool_stakes WHERE market_id = $1 ORDER BY user_id, outcome_id FOR UPDATE`, [marketId]);
  return rows;
}

function byUser(stakes, field) {
  const totals = new Map();
  for (const row of stakes) totals.set(Number(row.user_id), round2((totals.get(Number(row.user_id)) || 0) + num(row[field])));
  return totals;
}

/** Takes back what the current result paid each player, from Credit (it can go below zero). */
async function reversePayoutsWithClient(client, market) {
  const stakes = await lockedStakes(client, market.id);
  const paid = byUser(stakes, "payout");
  let clawedBack = 0;
  const users = new Map();
  for (const [userId, amount] of paid) {
    if (!(amount > 0)) continue;
    await economy.charge(client, userId, amount, { from: "credit", shortfall: "credit", entryType: "pool_payout_reversal", referenceType: REFERENCE, referenceId: market.id });
    clawedBack = round2(clawedBack + amount);
    users.set(userId, amount);
  }
  await client.query(`UPDATE market.prediction_pool_stakes SET payout = NULL, updated_at = now() WHERE market_id = $1`, [market.id]);
  return { clawed_back: clawedBack, users };
}

async function settleWithClient(client, market, winner, { actorId = null, source = null, note = null, evidence = {}, action = "resolved", previousOutcomeId = null, reversed = null }) {
  const stakes = await lockedStakes(client, market.id);
  const result = poolMath.settle(
    stakes.map((row) => ({ key: `${row.user_id}:${row.outcome_id}`, outcomeId: row.outcome_id, stake: row.stake })),
    winner.id
  );
  const perUser = new Map(); // userId → { staked, payout, won }
  for (const row of stakes) {
    const payout = result.payouts.get(`${row.user_id}:${row.outcome_id}`) || 0;
    await client.query(`UPDATE market.prediction_pool_stakes SET payout = $4, updated_at = now() WHERE market_id = $1 AND outcome_id = $2 AND user_id = $3`, [
      market.id,
      row.outcome_id,
      row.user_id,
      payout,
    ]);
    const mine = perUser.get(Number(row.user_id)) ?? { staked: 0, payout: 0, won: false };
    perUser.set(Number(row.user_id), {
      staked: round2(mine.staked + num(row.stake)),
      payout: round2(mine.payout + payout),
      won: mine.won || String(row.outcome_id) === String(winner.id),
    });
  }
  const repaidBy = new Map();
  for (const [userId, entry] of perUser) {
    if (!(entry.payout > 0)) continue;
    const moved =
      result.mode === "no_winner"
        ? await economy.refund(client, userId, entry.payout, { entryType: "pool_refund", referenceType: REFERENCE, referenceId: market.id })
        : await economy.pay(client, userId, entry.payout, { to: "credit", entryType: "pool_payout", referenceType: REFERENCE, referenceId: market.id });
    const owedBefore = Math.max(0, -num(moved.before.credit));
    if (owedBefore > 0) repaidBy.set(userId, round2(Math.min(owedBefore, num(moved.credit_delta))));
  }
  const paidOut = result.mode === "paid" ? round2([...perUser.values()].reduce((sum, entry) => sum + entry.payout, 0)) : 0;
  const refunded = result.mode === "no_winner" ? round2(result.total) : 0;
  await client.query(`UPDATE market.prediction_market_outcomes SET is_winner = (id = $2), updated_at = now() WHERE market_id = $1`, [market.id, winner.id]);
  await client.query(
    `UPDATE market.prediction_markets
     SET status = 'resolved', trading_status = 'resolved', resolution_outcome = $2, winning_outcome_id = $3, resolver_user_id = $4,
         resolved_at = COALESCE(resolved_at, now()), trading_closed_at = COALESCE(trading_closed_at, now()), pool_dust = $5, house_net_cash = $5,
         resolution_notes = $6, updated_at = now()
     WHERE id = $1`,
    [market.id, winner.outcome_code, winner.id, actorId, result.dust, note]
  );
  await client.query(
    `INSERT INTO market.prediction_pool_resolutions
       (market_id, action, outcome_id, previous_outcome_id, actor_user_id, source_url, note, evidence_json, pool_total, paid_out, refunded, clawed_back, no_winner_refund)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [market.id, action, winner.id, previousOutcomeId, actorId, source, note, JSON.stringify(evidence || {}), result.total, paidOut, refunded, reversed?.clawed_back ?? 0, result.mode === "no_winner"]
  );
  await core.logEvent(
    client,
    market.id,
    action === "corrected" ? "pool_corrected" : "pool_resolved",
    { outcome: winner.outcome_code, label: winner.label, pool_total: result.total, paid_out: paidOut, refunded, no_winner: result.mode === "no_winner", source_url: source, note },
    actorId
  );

  const href = poolHref(market.slug);
  const prefix = action === "corrected" ? "Corrected" : "Resolved";
  for (const [userId, entry] of perUser) {
    const took = reversed?.users.get(userId) || 0;
    const tookText = took > 0 ? ` The ${money(took)} the first result paid you was taken back first.` : "";
    const repaid = repaidBy.get(userId) || 0;
    const repaidText = repaid > 0 ? ` ${money(repaid)} of it paid back what you owed on margin.` : "";
    let kind;
    let title;
    let body;
    if (result.mode === "no_winner") {
      kind = "prediction_void";
      title = `Refunded: ${market.title}`;
      body = `${winner.label} won, but nobody had backed it, so every bet came back.${tookText}`;
    } else if (entry.won) {
      kind = "prediction_won";
      title = action === "corrected" ? `Corrected, and you called it: ${market.title}` : `You called it: ${market.title}`;
      body = `${winner.label} won. ${money(entry.payout)} paid to your Credit.${repaidText}${tookText}`;
    } else {
      kind = "prediction_lost";
      title = `${prefix}: ${market.title}`;
      body = `${winner.label} won. Your bet didn't pay out this time.${tookText}`;
    }
    await notifications.notify(client, userId, { kind, title, body, href, data: { market_id: Number(market.id), payout: entry.payout, staked: entry.staked } });
  }
  return { id: Number(market.id), slug: market.slug, pricing: "pool", outcome: winner.outcome_code, mode: result.mode, pool_total: result.total, paid_out: paidOut, refunded, dust: result.dust };
}

async function voidWithClient(client, market, { actorId = null, reason = null, sourceUrl = null, evidence = {} } = {}) {
  const wasResolved = market.status === "resolved";
  const reversed = wasResolved ? await reversePayoutsWithClient(client, market) : null;
  const stakes = await lockedStakes(client, market.id);
  const staked = byUser(stakes, "stake");
  let refunded = 0;
  for (const [userId, amount] of staked) {
    if (!(amount > 0)) continue;
    await economy.refund(client, userId, amount, { entryType: "pool_refund", referenceType: REFERENCE, referenceId: market.id });
    refunded = round2(refunded + amount);
  }
  await client.query(`UPDATE market.prediction_pool_stakes SET payout = stake, updated_at = now() WHERE market_id = $1`, [market.id]);
  await client.query(`UPDATE market.prediction_market_outcomes SET is_winner = false, updated_at = now() WHERE market_id = $1`, [market.id]);
  await client.query(
    `UPDATE market.prediction_markets
     SET status = 'voided', trading_status = 'voided', resolution_outcome = 'void', winning_outcome_id = NULL, resolver_user_id = $2, resolution_notes = $3,
         voided_at = now(), trading_closed_at = COALESCE(trading_closed_at, now()), pool_dust = 0, house_net_cash = 0, updated_at = now()
     WHERE id = $1`,
    [market.id, actorId, reason]
  );
  await client.query(
    `INSERT INTO market.prediction_pool_resolutions
       (market_id, action, outcome_id, previous_outcome_id, actor_user_id, source_url, note, evidence_json, pool_total, refunded, clawed_back)
     VALUES ($1, 'voided', NULL, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [market.id, wasResolved ? market.winning_outcome_id : null, actorId, sourceUrl, reason, JSON.stringify(evidence || {}), round2(market.pool_total), refunded, reversed?.clawed_back ?? 0]
  );
  await core.logEvent(client, market.id, "pool_voided", { reason, refunded, clawed_back: reversed?.clawed_back ?? 0 }, actorId);
  const href = poolHref(market.slug);
  for (const [userId, amount] of staked) {
    const took = reversed?.users.get(userId) || 0;
    await notifications.notify(client, userId, {
      kind: "prediction_void",
      title: `Voided: ${market.title}`,
      body: `${reason ? `${reason.replace(/[.\s]+$/, "")}. ` : ""}${money(amount)} back where it came from.${took > 0 ? ` The ${money(took)} it paid you was taken back first.` : ""}`,
      href,
      data: { market_id: Number(market.id), refund: amount, clawed_back: took },
    });
  }
  return { id: Number(market.id), slug: market.slug, pricing: "pool", refunded, clawed_back: reversed?.clawed_back ?? 0 };
}

// ── Views ──────────────────────────────────────────────────────────────────
async function loadPoolRow(db, slug) {
  const { rows } = await db.query(`${markets.MARKET_SELECT} WHERE pm.slug = $1 AND pm.pricing = 'pool'`, [slug]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function walletOf(db, userId) {
  const { rows } = await db.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [userId]);
  return { cash: num(rows[0]?.cash_balance), credit: num(rows[0]?.credit_balance) };
}

/** What the bet slip needs to know about the player: wallet, margin, and the new-account cap. */
async function bettorState(db, userId) {
  const wallet = await walletOf(db, userId);
  const [status, row] = await Promise.all([margin.status(db, userId, wallet), margin.userRow(db, userId)]);
  const newUntil = row ? newAccountUntil(row) : null;
  return {
    wallet: { credit: round2(wallet.credit), cash: round2(wallet.cash), spendable: round2(economy.sideModeSpendable(wallet)) },
    margin: status,
    new_account: newUntil ? { cap: SETTINGS.newAccountStakeCap, staked: await openStakeTotal(db, userId), until: newUntil } : null,
  };
}

async function getPoolDetail(pool, slug, user = null) {
  assertCanSee(user);
  const market = await loadPoolRow(pool, slug);
  const outcomes = await core.loadOutcomes(pool, market.id);
  const view = markets.marketView(market, outcomes);
  const [bettors, bets, record, lock] = await Promise.all([
    pool.query(
      `SELECT s.outcome_id, s.stake, s.payout, u.username, u.profile_color FROM market.prediction_pool_stakes s JOIN market.users u ON u.id = s.user_id
       WHERE s.market_id = $1 ORDER BY s.stake DESC, s.created_at`,
      [market.id]
    ),
    pool.query(
      `SELECT b.id, b.outcome_id, b.amount, b.stake_after, b.created_at, u.username, u.profile_color, o.label AS outcome_label, o.outcome_code
       FROM market.prediction_pool_bets b JOIN market.users u ON u.id = b.user_id JOIN market.prediction_market_outcomes o ON o.id = b.outcome_id
       WHERE b.market_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 40`,
      [market.id]
    ),
    pool.query(
      `SELECT r.*, u.username AS actor_username, o.label AS outcome_label, o.outcome_code, p.label AS previous_label
       FROM market.prediction_pool_resolutions r LEFT JOIN market.users u ON u.id = r.actor_user_id
       LEFT JOIN market.prediction_market_outcomes o ON o.id = r.outcome_id LEFT JOIN market.prediction_market_outcomes p ON p.id = r.previous_outcome_id
       WHERE r.market_id = $1 ORDER BY r.created_at, r.id`,
      [market.id]
    ),
    market.status === "open" ? guards.autoMarketLock(pool, market) : Promise.resolve(null),
  ]);
  const bettorsBy = {};
  for (const row of bettors.rows) {
    (bettorsBy[row.outcome_id] ||= []).push({ username: row.username, profile_color: row.profile_color, stake: round2(row.stake), payout: row.payout === null ? null : round2(row.payout) });
  }
  const open = isBettable(market) && !lock;
  const detail = {
    ...view,
    description: market.description,
    rules_text: market.rules_text,
    resolution_source_text: market.resolution_source_text,
    auto_data: market.auto_data || {},
    bookie: market.creator_username ? { username: market.creator_username } : null,
    min_bet: effectiveMinBet(market),
    bettors_count: new Set(bettors.rows.map((row) => row.username)).size,
    betting_open: open,
    betting_lock: lock,
    options: view.outcomes.map((option) => ({ ...option, bettors: bettorsBy[option.id] || [] })),
    bets: bets.rows.map((row) => ({
      id: Number(row.id),
      outcome_code: row.outcome_code,
      outcome_label: row.outcome_label,
      amount: round2(row.amount),
      stake_after: round2(row.stake_after),
      raise: round2(row.stake_after) > round2(row.amount),
      username: row.username,
      profile_color: row.profile_color,
      at: row.created_at,
    })),
    record: record.rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      outcome_code: row.outcome_code,
      outcome_label: row.outcome_label,
      previous_label: row.previous_label,
      actor: row.actor_username ? { username: row.actor_username } : null,
      automatic: !row.actor_user_id,
      source_url: row.source_url,
      note: row.note,
      evidence: row.evidence_json || {},
      pool_total: round2(row.pool_total),
      paid_out: round2(row.paid_out),
      refunded: round2(row.refunded),
      clawed_back: round2(row.clawed_back),
      no_winner_refund: row.no_winner_refund,
      at: row.created_at,
    })),
    correction_until: market.resolved_at ? new Date(new Date(market.resolved_at).getTime() + SETTINGS.correctionWindowHours * 3_600_000).toISOString() : null,
  };
  if (user) {
    const mine = await pool.query(`SELECT outcome_id, stake, borrowed, payout FROM market.prediction_pool_stakes WHERE market_id = $1 AND user_id = $2`, [market.id, user.id]);
    const own = market.creator_user_id && String(market.creator_user_id) === String(user.id);
    const hasStake = mine.rows.length > 0;
    detail.mine = {
      stakes: mine.rows.map((row) => ({ outcome_id: Number(row.outcome_id), stake: round2(row.stake), borrowed: round2(row.borrowed), payout: row.payout === null ? null : round2(row.payout) })),
      ...(await bettorState(pool, user.id)),
    };
    detail.can = {
      bet: open && !own,
      own_pool: Boolean(own),
      manage: canManage(user, market) && UNRESOLVED.includes(market.status),
      resolve: canManage(user, market) && UNRESOLVED.includes(market.status) && !hasStake,
      extend: canManage(user, market) && market.status === "open" && market.kind !== "auto",
      void: market.status === "resolved" ? isStaff(user) && correctionOpen(market) : UNRESOLVED.includes(market.status) && (canManage(user, market) || isStaff(user)),
      correct: market.status === "resolved" && isStaff(user) && correctionOpen(market) && !hasStake,
    };
  }
  return detail;
}

/** Finished pools, newest first; `mine` keeps the ones the player bet on, with their result. */
async function listHistory(pool, user, { q = null, mine = false, page = 1, limit = 30 } = {}) {
  assertCanSee(user);
  const params = [];
  const where = [`pm.pricing = 'pool'`, `pm.visibility = 'public'`, `pm.status IN ('resolved', 'voided')`];
  if (q) {
    params.push(`%${String(q).trim().slice(0, 80)}%`);
    where.push(`pm.title ILIKE $${params.length}`);
  }
  let mineJoin = "";
  if (user) {
    params.push(user.id);
    mineJoin = `LEFT JOIN (SELECT market_id, SUM(stake) AS staked, SUM(COALESCE(payout, 0)) AS paid FROM market.prediction_pool_stakes WHERE user_id = $${params.length} GROUP BY market_id) me ON me.market_id = pm.id`;
    if (mine) where.push(`me.market_id IS NOT NULL`);
  }
  const safeLimit = Math.min(60, Math.max(1, Number(limit) || 30));
  const safePage = Math.max(1, Number(page) || 1);
  params.push(safeLimit, (safePage - 1) * safeLimit);
  const { rows } = await pool.query(
    `SELECT pm.id, pm.slug, pm.title, pm.status, pm.kind, pm.pool_total, pm.resolved_at, pm.voided_at, pm.resolution_notes,
            creator.username AS bookie, w.label AS winner_label, w.pool_stake AS winner_stake,
            (SELECT COUNT(DISTINCT s.user_id) FROM market.prediction_pool_stakes s WHERE s.market_id = pm.id)::int AS bettors,
            (SELECT COUNT(*) FROM market.prediction_pool_resolutions r WHERE r.market_id = pm.id AND r.action = 'corrected')::int AS corrections,
            ${user ? "me.staked, me.paid" : "NULL AS staked, NULL AS paid"},
            COUNT(*) OVER()::int AS total_count
     FROM market.prediction_markets pm
     LEFT JOIN market.users creator ON creator.id = pm.creator_user_id
     LEFT JOIN market.prediction_market_outcomes w ON w.id = pm.winning_outcome_id
     ${mineJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(pm.voided_at, pm.resolved_at) DESC, pm.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
      status: row.status,
      kind: row.kind,
      bookie: row.bookie,
      pool_total: round2(row.pool_total),
      winner_label: row.status === "resolved" ? row.winner_label : null,
      winner_multiplier: row.status === "resolved" && num(row.winner_stake) > 0 ? num(row.pool_total) / num(row.winner_stake) : null,
      no_winner: row.status === "resolved" && !(num(row.winner_stake) > 0),
      bettors: row.bettors,
      corrected: row.corrections > 0,
      note: row.resolution_notes,
      finished_at: row.status === "voided" ? row.voided_at : row.resolved_at,
      mine: row.staked === null || row.staked === undefined ? null : { staked: round2(row.staked), paid: round2(row.paid), net: round2(num(row.paid) - num(row.staked)) },
    })),
    total: num(rows[0]?.total_count),
    page: safePage,
    limit: safeLimit,
  };
}

/** The bookie panel: a bookie's own pools (admins see every pool), open ones first. */
async function listBookiePools(pool, actor, { scope = "mine" } = {}) {
  assertCanSee(actor);
  if (!isBookie(actor) && !isStaff(actor)) throw predictionError("forbidden");
  const everyone = scope === "all" && (actor.is_admin || isStaff(actor));
  const params = [];
  const where = [`pm.pricing = 'pool'`, `(pm.status IN ('open', 'closed', 'resolving') OR COALESCE(pm.resolved_at, pm.voided_at) > now() - interval '14 days')`];
  if (!everyone) {
    params.push(actor.id);
    where.push(`pm.creator_user_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `${markets.MARKET_SELECT} WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN pm.status IN ('open', 'closed', 'resolving') THEN 0 ELSE 1 END, pm.closes_at ASC, pm.id DESC LIMIT 100`,
    params
  );
  if (!rows.length) return { pools: [] };
  const ids = rows.map((row) => row.id);
  const [outcomes, counts] = await Promise.all([
    pool.query(
      `SELECT o.*, a.symbol AS asset_symbol, ch.icon AS asset_icon, ch.color AS asset_color FROM market.prediction_market_outcomes o
       LEFT JOIN market.market_assets a ON a.id = o.asset_id LEFT JOIN yt.youtube_channels ch ON ch.youtube_channel_id = a.youtube_channel_id
       WHERE o.market_id = ANY($1::bigint[]) ORDER BY o.sort_order, o.id`,
      [ids]
    ),
    pool.query(`SELECT market_id, COUNT(DISTINCT user_id)::int AS bettors FROM market.prediction_pool_stakes WHERE market_id = ANY($1::bigint[]) GROUP BY market_id`, [ids]),
  ]);
  const countBy = new Map(counts.rows.map((row) => [String(row.market_id), row.bettors]));
  return {
    pools: rows.map((row) => ({
      ...markets.marketView(row, outcomes.rows.filter((outcome) => String(outcome.market_id) === String(row.id))),
      bookie: row.creator_username,
      bettors: countBy.get(String(row.id)) || 0,
      min_bet: effectiveMinBet(row),
      can_correct: row.status === "resolved" && isStaff(actor) && correctionOpen(row),
    })),
  };
}

/** The player's side: stakes in pools still running, recent results, wallet and margin. */
async function getMyPools(pool, user) {
  assertCanSee(user);
  const { rows } = await pool.query(
    `SELECT s.market_id, s.outcome_id, s.stake, s.borrowed, s.payout, pm.slug, pm.title, pm.status, pm.closes_at, pm.pool_total,
            pm.resolved_at, pm.voided_at, pm.winning_outcome_id, o.label AS outcome_label, o.pool_stake
     FROM market.prediction_pool_stakes s JOIN market.prediction_markets pm ON pm.id = s.market_id JOIN market.prediction_market_outcomes o ON o.id = s.outcome_id
     WHERE s.user_id = $1 ORDER BY pm.closes_at ASC`,
    [user.id]
  );
  const open = [];
  const settled = [];
  for (const row of rows) {
    const entry = {
      market_id: Number(row.market_id),
      slug: row.slug,
      title: row.title,
      status: row.status,
      closes_at: row.closes_at,
      outcome_id: Number(row.outcome_id),
      outcome_label: row.outcome_label,
      stake: round2(row.stake),
      borrowed: round2(row.borrowed),
      pool_total: round2(row.pool_total),
      option_total: round2(row.pool_stake),
      // If it closed now and this option won.
      payout_if_wins: num(row.pool_stake) > 0 ? round2((num(row.stake) * num(row.pool_total)) / num(row.pool_stake)) : null,
      payout: row.payout === null ? null : round2(row.payout),
      won: row.winning_outcome_id ? String(row.winning_outcome_id) === String(row.outcome_id) : null,
      finished_at: row.status === "voided" ? row.voided_at : row.resolved_at,
    };
    if (UNRESOLVED.includes(row.status)) open.push(entry);
    else settled.push(entry);
  }
  settled.sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0));
  return {
    open,
    settled: settled.slice(0, 50),
    totals: {
      staked_open: round2(open.reduce((sum, entry) => sum + entry.stake, 0)),
      net_settled: round2(settled.reduce((sum, entry) => sum + num(entry.payout) - entry.stake, 0)),
    },
    ...(await bettorState(pool, user.id)),
    settings: { min_bet: SETTINGS.minBet, new_account_cap: SETTINGS.newAccountStakeCap },
  };
}

module.exports = {
  SETTINGS,
  canManage,
  closePool,
  correctPool,
  createPool,
  extendPool,
  getMyPools,
  getPoolDetail,
  insertPoolWithClient,
  listBookiePools,
  listHistory,
  placeBet,
  resolvePool,
  settleWithClient,
  voidPool,
  voidWithClient,
};
