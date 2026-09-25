// Predictions v2 lifecycle and resolution (docs/predictions/PREDICTIONS_DESIGN.md §4–5, §9).
//
// open → closed → resolving → proposed ⇄ disputed → resolved, or voided from any unresolved state.
// Settlement and voids release every resting limit order first, then pay out positions.

const lmsr = require("./lmsr");
const core = require("./core");
const trading = require("./trading");

const { num, round2, predictionError } = core;

const UNRESOLVED = ["draft", "pending_approval", "open", "closed", "resolving", "proposed", "disputed"];
const CAN_PROPOSE = ["open", "closed", "resolving"];

function canActAs(user, flag) {
  return Boolean(user?.is_admin || user?.[flag]);
}

async function currentProposal(client, marketId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM market.prediction_resolution_proposals WHERE market_id = $1 AND status IN ('proposed', 'disputed')
     ORDER BY created_at DESC, id DESC LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [marketId]
  );
  return rows[0] || null;
}

// ── Trading window ─────────────────────────────────────────────────────────
async function closeWithClient(client, market, { actorUserId = null, reason = "schedule" } = {}) {
  if (market.status !== "open") return false;
  const released = await trading.releaseMarketOrdersWithClient(client, market.id, "market_closed");
  const resolveNow = market.kind === "event" && (!market.resolves_after || new Date(market.resolves_after) <= new Date());
  await client.query(
    `UPDATE market.prediction_markets SET status = $2, trading_status = 'closed', trading_closed_at = now(), updated_at = now() WHERE id = $1`,
    [market.id, resolveNow ? "resolving" : "closed"]
  );
  await core.logEvent(client, market.id, "market_closed", { reason, released_orders: released }, actorUserId);
  return true;
}

async function closeMarket(pool, actor, marketId) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (market.status !== "open") throw predictionError("prediction_market_transition_invalid");
    await closeWithClient(client, market, { actorUserId: actor.id, reason: "closed_early" });
    return { id: Number(market.id), slug: market.slug };
  });
}

async function setHalted(pool, actor, marketId, halted) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (market.status !== "open" || (halted ? market.trading_status !== "open" : market.trading_status !== "halted")) {
      throw predictionError("prediction_market_transition_invalid");
    }
    await client.query(`UPDATE market.prediction_markets SET trading_status = $2, updated_at = now() WHERE id = $1`, [market.id, halted ? "halted" : "open"]);
    await core.logEvent(client, market.id, halted ? "market_halted" : "market_resumed", {}, actor.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

// ── Proposals and disputes ─────────────────────────────────────────────────
function normalizeSourceUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^https?:\/\/\S+$/i.test(text) || text.length > 1000) throw predictionError("invalid_source_url");
  return text;
}

async function insertProposal(client, market, { proposerId, outcomeCode, sourceUrl, note, evidence = {}, windowHours = null }) {
  const isVoid = outcomeCode === "void";
  let outcomeId = null;
  if (!isVoid) {
    const outcomes = await core.loadOutcomes(client, market.id);
    const outcome = outcomes.find((entry) => entry.outcome_code === String(outcomeCode || "").toLowerCase());
    if (!outcome) throw predictionError("invalid_outcome");
    outcomeId = outcome.id;
  }
  const hours = windowHours ?? num(market.dispute_hours, 12);
  const { rows } = await client.query(
    `INSERT INTO market.prediction_resolution_proposals (market_id, proposer_user_id, outcome_id, is_void, source_url, note, evidence_json, window_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval) RETURNING *`,
    [market.id, proposerId, outcomeId, isVoid, sourceUrl, note ? String(note).slice(0, 2000) : null, JSON.stringify(evidence), String(hours)]
  );
  return rows[0];
}

async function propose(pool, actor, marketId, { outcome, sourceUrl, note }) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  const source = normalizeSourceUrl(sourceUrl);
  if (!source) throw predictionError("source_required");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (!CAN_PROPOSE.includes(market.status)) throw predictionError("prediction_market_transition_invalid");
    if (market.status === "open") await closeWithClient(client, market, { actorUserId: actor.id, reason: "resolution_proposed" });
    const proposal = await insertProposal(client, market, { proposerId: actor.id, outcomeCode: outcome, sourceUrl: source, note });
    await client.query(`UPDATE market.prediction_markets SET status = 'proposed', updated_at = now() WHERE id = $1`, [market.id]);
    await core.logEvent(client, market.id, "resolution_proposed", { proposal_id: Number(proposal.id), outcome, source_url: source, note, window_ends_at: proposal.window_ends_at }, actor.id);
    return { id: Number(market.id), slug: market.slug, proposal_id: Number(proposal.id) };
  });
}

async function dispute(pool, user, marketId, { reason }) {
  const text = String(reason || "").trim();
  if (text.length < 20 || text.length > 2000) throw predictionError("invalid_dispute_reason");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (!["proposed", "disputed"].includes(market.status)) throw predictionError("prediction_market_transition_invalid");
    const proposal = await currentProposal(client, market.id, { lock: true });
    if (!proposal || new Date(proposal.window_ends_at) <= new Date()) throw predictionError("dispute_window_closed");
    const held = await client.query(`SELECT 1 FROM market.prediction_market_positions WHERE user_id = $1 AND market_id = $2 LIMIT 1`, [user.id, market.id]);
    if (!held.rows.length) throw predictionError("dispute_requires_position");
    const inserted = await client.query(
      `INSERT INTO market.prediction_disputes (proposal_id, market_id, user_id, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [proposal.id, market.id, user.id, text]
    );
    if (!inserted.rows.length) throw predictionError("already_disputed");
    await client.query(`UPDATE market.prediction_resolution_proposals SET status = 'disputed' WHERE id = $1`, [proposal.id]);
    await client.query(`UPDATE market.prediction_markets SET status = 'disputed', updated_at = now() WHERE id = $1`, [market.id]);
    await core.logEvent(client, market.id, "resolution_disputed", { proposal_id: Number(proposal.id), reason: text }, user.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

async function confirm(pool, actor, marketId) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    const proposal = await currentProposal(client, market.id, { lock: true });
    if (!proposal) throw predictionError("no_open_proposal");
    const sameUser = String(proposal.proposer_user_id) === String(actor.id);
    if (sameUser && !actor.is_admin) throw predictionError("confirm_requires_second_resolver");
    await finalizeWithClient(client, market, proposal, { confirmerId: actor.id, selfConfirmed: sameUser });
    return { id: Number(market.id), slug: market.slug };
  });
}

async function withdraw(pool, actor, marketId) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    const proposal = await currentProposal(client, market.id, { lock: true });
    if (!proposal) throw predictionError("no_open_proposal");
    await client.query(`UPDATE market.prediction_resolution_proposals SET status = 'withdrawn' WHERE id = $1`, [proposal.id]);
    await client.query(`UPDATE market.prediction_markets SET status = 'resolving', updated_at = now() WHERE id = $1`, [market.id]);
    await core.logEvent(client, market.id, "resolution_withdrawn", { proposal_id: Number(proposal.id) }, actor.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

/** Replace the standing proposal with a different call; a fresh dispute window opens. */
async function overturn(pool, actor, marketId, { outcome, sourceUrl, note }) {
  if (!canActAs(actor, "can_resolve_prediction_markets")) throw predictionError("forbidden");
  const source = normalizeSourceUrl(sourceUrl);
  if (!source) throw predictionError("source_required");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    const previous = await currentProposal(client, market.id, { lock: true });
    if (!previous) throw predictionError("no_open_proposal");
    await client.query(`UPDATE market.prediction_resolution_proposals SET status = 'overturned' WHERE id = $1`, [previous.id]);
    const proposal = await insertProposal(client, market, { proposerId: actor.id, outcomeCode: outcome, sourceUrl: source, note });
    await client.query(`UPDATE market.prediction_markets SET status = 'proposed', updated_at = now() WHERE id = $1`, [market.id]);
    await core.logEvent(client, market.id, "resolution_proposed", { proposal_id: Number(proposal.id), outcome, source_url: source, note, overturned: Number(previous.id), window_ends_at: proposal.window_ends_at }, actor.id);
    return { id: Number(market.id), slug: market.slug, proposal_id: Number(proposal.id) };
  });
}

/** Undisputed proposals whose window has ended settle on their own. */
async function finalizeDueProposals(pool, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT market_id FROM market.prediction_resolution_proposals WHERE status = 'proposed' AND window_ends_at <= now() ORDER BY window_ends_at LIMIT $1`,
    [limit]
  );
  const done = [];
  for (const row of rows) {
    const result = await core.inTransaction(pool, async (client) => {
      const market = await core.lockMarket(client, { id: row.market_id });
      const proposal = await currentProposal(client, market.id, { lock: true });
      if (!proposal || proposal.status !== "proposed" || new Date(proposal.window_ends_at) > new Date()) return null;
      await finalizeWithClient(client, market, proposal, { confirmerId: null, selfConfirmed: false });
      return { id: Number(market.id), slug: market.slug };
    });
    if (result) done.push(result);
  }
  return done;
}

async function finalizeWithClient(client, market, proposal, { confirmerId, selfConfirmed }) {
  await client.query(
    `UPDATE market.prediction_resolution_proposals SET status = 'finalized', confirmer_user_id = $2, self_confirmed = $3, finalized_at = now() WHERE id = $1`,
    [proposal.id, confirmerId, selfConfirmed]
  );
  await core.logEvent(client, market.id, "resolution_finalized", { proposal_id: Number(proposal.id), confirmed_by: confirmerId, self_confirmed: selfConfirmed, automatic: confirmerId === null }, confirmerId);
  const resolverId = confirmerId ?? proposal.proposer_user_id ?? null;
  if (proposal.is_void) return voidWithClient(client, market, { actorUserId: resolverId, reason: proposal.note || "Resolved as void" });
  return settleWithClient(client, market, proposal.outcome_id, { actorUserId: resolverId });
}

// ── Settlement ─────────────────────────────────────────────────────────────
async function settleWithClient(client, market, winningOutcomeId, { actorUserId = null } = {}) {
  await trading.releaseMarketOrdersWithClient(client, market.id, "market_resolved");
  const outcomes = await core.loadOutcomes(client, market.id);
  const winner = outcomes.find((outcome) => String(outcome.id) === String(winningOutcomeId));
  if (!winner) throw predictionError("invalid_outcome");
  const { rows: positions } = await client.query(`SELECT * FROM market.prediction_market_positions WHERE market_id = $1 AND shares > 0 FOR UPDATE`, [market.id]);
  let paid = 0;
  for (const position of positions) {
    const shares = num(position.shares);
    const won = String(position.outcome_id) === String(winner.id);
    const payout = won ? round2(shares) : 0;
    await core.moveCash(client, position.user_id, payout, {
      entryType: won ? "prediction_payout_win" : "prediction_payout_loss",
      marketId: market.id,
      quantityDelta: -shares,
      referenceType: "prediction_resolution",
    });
    paid += payout;
    await client.query(
      `UPDATE market.prediction_market_positions SET shares = 0, realized_pnl_cash = realized_pnl_cash + $4, updated_at = now()
       WHERE user_id = $1 AND market_id = $2 AND outcome_id = $3`,
      [position.user_id, market.id, position.outcome_id, round2(payout - num(position.avg_entry_price) * shares)]
    );
  }
  await client.query(`UPDATE market.prediction_market_outcomes SET is_winner = (id = $2), updated_at = now() WHERE market_id = $1`, [market.id, winner.id]);
  await client.query(
    `UPDATE market.prediction_markets
     SET status = 'resolved', trading_status = 'resolved', resolution_outcome = $2, winning_outcome_id = $3, resolver_user_id = $4,
         resolved_at = now(), trading_closed_at = COALESCE(trading_closed_at, now()), house_net_cash = house_net_cash - $5, open_interest_shares = 0, updated_at = now()
     WHERE id = $1`,
    [market.id, winner.outcome_code, winner.id, actorUserId, round2(paid)]
  );
  await core.logEvent(client, market.id, "market_resolved", { outcome: winner.outcome_code, label: winner.label, paid_out: round2(paid), positions: positions.length }, actorUserId);
  return { id: Number(market.id), slug: market.slug, outcome: winner.outcome_code, paid_out: round2(paid) };
}

/** Everyone gets back what they put in net of what they took out (never negative). */
async function voidWithClient(client, market, { actorUserId = null, reason = null } = {}) {
  await trading.releaseMarketOrdersWithClient(client, market.id, "market_voided");
  const { rows } = await client.query(
    `SELECT user_id, SUM(net_cost_cash) AS net, SUM(shares) AS shares FROM market.prediction_market_positions WHERE market_id = $1 GROUP BY user_id`,
    [market.id]
  );
  let refunded = 0;
  for (const row of rows) {
    const refund = Math.max(0, round2(num(row.net)));
    if (refund > 0 || num(row.shares) > 0) {
      await core.moveCash(client, row.user_id, refund, { entryType: "prediction_void_refund", marketId: market.id, quantityDelta: -num(row.shares), referenceType: "prediction_void" });
      refunded += refund;
    }
  }
  await client.query(`UPDATE market.prediction_market_positions SET shares = 0, updated_at = now() WHERE market_id = $1`, [market.id]);
  await client.query(
    `UPDATE market.prediction_markets
     SET status = 'voided', trading_status = 'voided', resolution_outcome = 'void', resolver_user_id = $2, resolution_notes = $3,
         voided_at = now(), house_net_cash = house_net_cash - $4, open_interest_shares = 0, updated_at = now()
     WHERE id = $1`,
    [market.id, actorUserId, reason, round2(refunded)]
  );
  await core.logEvent(client, market.id, "market_voided", { reason, refunded: round2(refunded) }, actorUserId);
  return { id: Number(market.id), slug: market.slug, refunded: round2(refunded) };
}

async function voidMarket(pool, actor, marketId, { reason }) {
  if (!canActAs(actor, "can_void_prediction_markets")) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (!UNRESOLVED.includes(market.status)) throw predictionError("prediction_market_transition_invalid");
    const open = await currentProposal(client, market.id, { lock: true });
    if (open) await client.query(`UPDATE market.prediction_resolution_proposals SET status = 'overturned' WHERE id = $1`, [open.id]);
    return voidWithClient(client, market, { actorUserId: actor.id, reason: String(reason || "").slice(0, 2000) || null });
  });
}

// ── Scheduler steps ────────────────────────────────────────────────────────
async function openDueMarkets(pool) {
  const { rows } = await pool.query(
    `UPDATE market.prediction_markets SET trading_status = 'open', trading_opened_at = now(), updated_at = now()
     WHERE status = 'open' AND trading_status = 'pending_open' AND opens_at <= now() AND amm_ready
     RETURNING id, slug`
  );
  for (const row of rows) await core.logEvent(pool, row.id, "market_opened", {});
  return rows;
}

async function closeDueMarkets(pool, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM market.prediction_markets WHERE status = 'open' AND closes_at <= now() ORDER BY closes_at LIMIT $1`,
    [limit]
  );
  const closed = [];
  for (const row of rows) {
    const done = await core.inTransaction(pool, async (client) => {
      const market = await core.lockMarket(client, { id: row.id });
      if (market.status !== "open" || new Date(market.closes_at) > new Date()) return null;
      await closeWithClient(client, market);
      return { id: Number(market.id), slug: market.slug };
    });
    if (done) closed.push(done);
  }
  // Event markets closed with a later resolves_after move to "resolving" once it passes.
  const { rows: ready } = await pool.query(
    `UPDATE market.prediction_markets SET status = 'resolving', updated_at = now()
     WHERE kind = 'event' AND status = 'closed' AND (resolves_after IS NULL OR resolves_after <= now()) RETURNING id, slug`
  );
  return [...closed, ...ready];
}

// ── Legacy hand-off (order-book build → market maker) ──────────────────────
/** Cancels the first build's resting order-book orders and refunds their reserved cash. */
async function releaseLegacyOrdersWithClient(client, marketId) {
  const { rows } = await client.query(
    `SELECT id, user_id, cash_reserved FROM market.prediction_market_orders
     WHERE market_id = $1 AND status IN ('open', 'partially_filled') FOR UPDATE`,
    [marketId]
  );
  const released = [];
  for (const order of rows) {
    const cash = round2(num(order.cash_reserved));
    if (cash > 0) {
      await core.moveCash(client, order.user_id, cash, { entryType: "prediction_cash_release", marketId, referenceType: "prediction_order", referenceId: order.id });
    }
    await client.query(
      `UPDATE market.prediction_market_orders SET status = 'cancelled', open_quantity = 0, cash_reserved = 0, cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [order.id]
    );
    released.push({ order_id: Number(order.id), released_cash: cash });
  }
  return released;
}

/** Idempotent: cancels legacy resting orders, seeds market-maker state, seeds net cost. */
async function retireLegacyOrderBook(pool) {
  const { rows } = await pool.query(`SELECT id FROM market.prediction_markets WHERE NOT amm_ready ORDER BY id`);
  for (const row of rows) {
    await core.inTransaction(pool, async (client) => {
      const market = await core.lockMarket(client, { id: row.id });
      if (market.amm_ready) return;
      const released = await releaseLegacyOrdersWithClient(client, market.id);
      const outcomes = await core.loadOutcomes(client, market.id);
      if (outcomes.length >= 2) {
        const b = num(market.liquidity_b, 250);
        const yes = num(market.last_traded_probability, 0.5) || 0.5;
        const probabilities = outcomes.map((outcome) => (outcome.outcome_code === "yes" ? yes : outcome.outcome_code === "no" ? 1 - yes : 1 / outcomes.length));
        const q = lmsr.seedShares(probabilities, b);
        await core.storePrices(client, market, outcomes, q, lmsr.prices(q, b));
      }
      await client.query(
        `UPDATE market.prediction_market_positions SET net_cost_cash = ROUND(avg_entry_price * shares, 2)
         WHERE market_id = $1 AND shares > 0 AND net_cost_cash = 0`,
        [market.id]
      );
      await client.query(`UPDATE market.prediction_markets SET amm_ready = true, updated_at = now() WHERE id = $1`, [market.id]);
      await core.logEvent(client, market.id, "legacy_orders_released", { released_orders: released.length, released_cash: round2(released.reduce((sum, entry) => sum + num(entry.released_cash), 0)) });
    });
  }
  return rows.length;
}

module.exports = {
  UNRESOLVED,
  canActAs,
  closeDueMarkets,
  closeMarket,
  closeWithClient,
  confirm,
  currentProposal,
  dispute,
  finalizeDueProposals,
  insertProposal,
  openDueMarkets,
  overturn,
  propose,
  retireLegacyOrderBook,
  setHalted,
  settleWithClient,
  voidMarket,
  voidWithClient,
  withdraw,
};
