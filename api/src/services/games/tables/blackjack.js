// Blackjack tables against the house (docs/games/GAMES_DESIGN.md §4).
//
// Flow: idle → (first bet) betting (15 s) → deal → players act in seat order (15 s each,
// auto-stand) → dealer → settle → idle. Bets are debited when placed; payouts are credited at
// settle in one transaction. A round still open at startup refunds its bets.

const crypto = require("node:crypto");
const gamesWallet = require("../wallet");
const hub = require("./hub");

const TABLES = [
  { key: "low", name: "Low table", min: 10, max: 200 },
  { key: "mid", name: "Mid table", min: 100, max: 2000 },
  { key: "high", name: "High table", min: 1000, max: 10000 },
];
const SEATS = 5;
const DECKS = 6;
const BET_MS = 15_000;
const TURN_MS = 15_000;
const DEAL_MS = 1200;
const DEALER_STEP_MS = 900;
const RESULT_MS = 5000;
const IDLE_ROUNDS_BEFORE_KICK = 3;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];

const tables = new Map();
const locks = new Map();
let pool = null;

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function bjError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => {});
  locks.set(key, settled);
  return run;
}

// ── Cards ──────────────────────────────────────────────────────────────────
function newShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d += 1) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function cardValue(card) {
  if (card.rank === "A") return 11;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** Best total and whether it's soft (an ace still counted as 11). */
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (hand) => hand.length === 2 && handValue(hand).total === 21;

function draw(table) {
  if (!table.shoe.length) table.shoe = newShoe();
  return table.shoe.shift();
}

// ── Views ──────────────────────────────────────────────────────────────────
function publicTable(table) {
  const dealerHand = table.dealer.hidden ? [table.dealer.hand[0], null].filter((card, index) => index < table.dealer.hand.length) : table.dealer.hand;
  return {
    key: table.key,
    name: table.name,
    min_bet: table.min,
    max_bet: table.max,
    phase: table.phase,
    deadline: table.deadline,
    turn: table.turn,
    round_id: table.roundId,
    dealer: {
      hand: dealerHand,
      value: table.dealer.hidden ? (table.dealer.hand[0] ? handValue([table.dealer.hand[0]]).total : null) : table.dealer.hand.length ? handValue(table.dealer.hand).total : null,
      hidden: table.dealer.hidden,
    },
    seats: table.seats.map((seat, index) =>
      seat
        ? {
            seat: index,
            user_id: seat.user_id,
            username: seat.username,
            profile_color: seat.profile_color,
            bet: seat.bet,
            doubled: seat.doubled,
            hand: seat.hand,
            value: seat.hand.length ? handValue(seat.hand).total : null,
            status: seat.status,
            outcome: seat.outcome,
            payout: seat.payout,
          }
        : null
    ),
    shoe_remaining: table.shoe.length,
    shoe_size: DECKS * 52,
    history: table.history,
    spectators: hub.count(`blackjack:${table.key}`),
    server_time: Date.now(),
  };
}

function publish(table) {
  hub.publish(`blackjack:${table.key}`, { type: "blackjack", table: publicTable(table) });
  hub.publish("lobby:blackjack", { type: "lobby", game: "blackjack", tables: lobby() });
}

function lobby() {
  return TABLES.map((spec) => {
    const table = tables.get(spec.key);
    return {
      key: spec.key,
      name: spec.name,
      min_bet: spec.min,
      max_bet: spec.max,
      seated: table.seats.filter(Boolean).length,
      seats: SEATS,
      phase: table.phase,
      spectators: hub.count(`blackjack:${spec.key}`),
    };
  });
}

// ── Timers ─────────────────────────────────────────────────────────────────
function schedule(table, ms, fn) {
  clearTimeout(table.timer);
  table.deadline = Date.now() + ms;
  table.timer = setTimeout(() => withLock(table.key, fn).catch((error) => console.error("blackjack error:", error)), ms);
}

// ── Seats ──────────────────────────────────────────────────────────────────
async function sit({ userId, tableKey, seat }) {
  return withLock(tableKey, async () => {
    const table = getTableOrThrow(tableKey);
    if (table.seats.some((entry) => entry?.user_id === userId)) throw bjError("already_seated");
    let index = Number.isInteger(Number(seat)) ? Number(seat) : table.seats.findIndex((entry) => !entry);
    if (index < 0 || index >= SEATS || table.seats[index]) index = table.seats.findIndex((entry) => !entry);
    if (index < 0) throw bjError("table_full");
    const { rows } = await pool.query(`SELECT id, username, profile_color FROM market.users WHERE id = $1`, [userId]);
    if (!rows[0]) throw bjError("unauthenticated");
    table.seats[index] = { user_id: userId, username: rows[0].username, profile_color: rows[0].profile_color, bet: 0, doubled: false, hand: [], status: "waiting", outcome: null, payout: 0, idle_rounds: 0 };
    publish(table);
    return publicTable(table);
  });
}

async function leave({ userId, tableKey }) {
  return withLock(tableKey, async () => {
    const table = getTableOrThrow(tableKey);
    const index = table.seats.findIndex((entry) => entry?.user_id === userId);
    if (index < 0) throw bjError("invalid_action");
    const seat = table.seats[index];
    if (seat.bet > 0 && table.phase !== "idle") throw bjError("invalid_action"); // finish the hand first
    table.seats[index] = null;
    publish(table);
    return publicTable(table);
  });
}

function getTableOrThrow(tableKey) {
  const table = tables.get(String(tableKey));
  if (!table) throw bjError("table_not_found");
  return table;
}

// ── Betting ────────────────────────────────────────────────────────────────
async function bet({ userId, tableKey, amount }) {
  return withLock(tableKey, async () => {
    const table = getTableOrThrow(tableKey);
    if (table.phase !== "idle" && table.phase !== "betting") throw bjError("invalid_action");
    const index = table.seats.findIndex((entry) => entry?.user_id === userId);
    if (index < 0) throw bjError("invalid_action");
    const seat = table.seats[index];
    if (seat.bet > 0) throw bjError("invalid_action");
    const wager = round2(amount);
    if (!Number.isFinite(wager) || wager < table.min || wager > table.max) throw bjError("invalid_bet");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!table.roundId) {
        const { rows } = await client.query(`INSERT INTO games.blackjack_rounds (table_key, status) VALUES ($1, 'betting') RETURNING id`, [table.key]);
        table.roundId = Number(rows[0].id);
      }
      await client.query(`INSERT INTO games.blackjack_bets (round_id, user_id, seat, bet_cash) VALUES ($1,$2,$3,$4)`, [table.roundId, userId, index, wager]);
      await client.query(`UPDATE games.blackjack_rounds SET total_bet_cash = total_bet_cash + $2 WHERE id = $1`, [table.roundId, wager]);
      await gamesWallet.debitCashForGameWithClient(client, { userId, amount: wager, entryType: "table_bet_debit", referenceType: "blackjack_round", referenceId: table.roundId });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    seat.bet = wager;
    seat.status = "betting";
    seat.outcome = null;
    seat.payout = 0;
    seat.hand = [];
    seat.idle_rounds = 0;
    if (table.phase === "idle") {
      table.phase = "betting";
      schedule(table, BET_MS, () => deal(table));
    }
    // Everyone seated has bet: no need to wait out the clock.
    if (table.seats.every((entry) => !entry || entry.bet > 0)) schedule(table, 800, () => deal(table));
    publish(table);
    return publicTable(table);
  });
}

// ── Dealing and play ───────────────────────────────────────────────────────
async function deal(table) {
  if (table.phase !== "betting") return;
  if (table.shoe.length < DECKS * 52 * 0.25) table.shoe = newShoe();
  const players = table.seats.map((seat, index) => (seat && seat.bet > 0 ? index : null)).filter((index) => index !== null);
  for (const index of table.seats.keys()) {
    const seat = table.seats[index];
    if (seat && !seat.bet) {
      seat.idle_rounds += 1;
      seat.status = "waiting";
      seat.hand = [];
      seat.outcome = null;
      seat.payout = 0;
      if (seat.idle_rounds >= IDLE_ROUNDS_BEFORE_KICK) table.seats[index] = null;
    }
  }
  table.dealer = { hand: [], hidden: true };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const index of players) table.seats[index].hand.push(draw(table));
    table.dealer.hand.push(draw(table));
  }
  for (const index of players) table.seats[index].status = isBlackjack(table.seats[index].hand) ? "blackjack" : "playing";
  table.phase = "playing";
  await pool.query(`UPDATE games.blackjack_rounds SET status = 'playing' WHERE id = $1`, [table.roundId]);

  // Dealer peeks on an ace or ten: a dealer blackjack ends the round at once.
  const up = cardValue(table.dealer.hand[0]);
  if ((up === 11 || up === 10) && isBlackjack(table.dealer.hand)) {
    table.dealer.hidden = false;
    publish(table);
    return schedule(table, DEAL_MS, () => settle(table));
  }
  publish(table);
  schedule(table, DEAL_MS, () => nextTurn(table, -1));
}

async function nextTurn(table, after) {
  const next = table.seats.findIndex((seat, index) => index > after && seat && seat.bet > 0 && seat.status === "playing");
  if (next < 0) {
    table.turn = null;
    table.dealer.hidden = false;
    publish(table);
    return schedule(table, DEALER_STEP_MS, () => dealerPlay(table));
  }
  table.turn = next;
  publish(table);
  schedule(table, TURN_MS, () => stand(table, next));
}

async function stand(table, index) {
  const seat = table.seats[index];
  if (seat && seat.status === "playing") seat.status = "stood";
  return nextTurn(table, index);
}

async function act({ userId, tableKey, action }) {
  return withLock(tableKey, async () => {
    const table = getTableOrThrow(tableKey);
    if (table.phase !== "playing" || table.turn === null) throw bjError("not_your_turn");
    const seat = table.seats[table.turn];
    if (!seat || seat.user_id !== userId) throw bjError("not_your_turn");
    const index = table.turn;
    if (action === "stand") {
      await stand(table, index);
    } else if (action === "hit") {
      seat.hand.push(draw(table));
      const { total } = handValue(seat.hand);
      if (total > 21) {
        seat.status = "bust";
        await nextTurn(table, index);
      } else if (total === 21) {
        await stand(table, index);
      } else {
        publish(table);
        schedule(table, TURN_MS, () => stand(table, index));
      }
    } else if (action === "double") {
      if (seat.hand.length !== 2 || seat.doubled) throw bjError("invalid_action");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await gamesWallet.debitCashForGameWithClient(client, { userId, amount: seat.bet, entryType: "table_bet_debit", referenceType: "blackjack_round", referenceId: table.roundId });
        await client.query(`UPDATE games.blackjack_bets SET doubled = true WHERE round_id = $1 AND seat = $2`, [table.roundId, index]);
        await client.query(`UPDATE games.blackjack_rounds SET total_bet_cash = total_bet_cash + $2 WHERE id = $1`, [table.roundId, seat.bet]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      seat.doubled = true;
      seat.hand.push(draw(table));
      seat.status = handValue(seat.hand).total > 21 ? "bust" : "stood";
      await nextTurn(table, index);
    } else {
      throw bjError("invalid_action");
    }
    return publicTable(table);
  });
}

async function dealerPlay(table) {
  const anyLive = table.seats.some((seat) => seat && seat.bet > 0 && (seat.status === "stood" || seat.status === "playing"));
  const { total } = handValue(table.dealer.hand);
  // Stand on all 17s, soft ones included. Skip drawing if everyone busted or has blackjack.
  if (anyLive && total < 17) {
    table.dealer.hand.push(draw(table));
    publish(table);
    return schedule(table, DEALER_STEP_MS, () => dealerPlay(table));
  }
  return settle(table);
}

function outcomeFor(seat, dealerHand) {
  const player = handValue(seat.hand).total;
  const dealer = handValue(dealerHand).total;
  const wager = seat.bet * (seat.doubled ? 2 : 1);
  const dealerBj = isBlackjack(dealerHand);
  if (seat.status === "blackjack") return dealerBj ? { outcome: "push", payout: wager } : { outcome: "blackjack", payout: round2(wager * 2.5) };
  if (dealerBj) return { outcome: "loss", payout: 0 };
  if (seat.status === "bust" || player > 21) return { outcome: "bust", payout: 0 };
  if (dealer > 21 || player > dealer) return { outcome: "win", payout: round2(wager * 2) };
  if (player === dealer) return { outcome: "push", payout: wager };
  return { outcome: "loss", payout: 0 };
}

async function settle(table) {
  table.dealer.hidden = false;
  const results = [];
  for (const [index, seat] of table.seats.entries()) {
    if (!seat || !(seat.bet > 0)) continue;
    const { outcome, payout } = outcomeFor(seat, table.dealer.hand);
    seat.outcome = outcome;
    seat.payout = payout;
    seat.status = "done";
    results.push({ index, seat, outcome, payout });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let totalPayout = 0;
    for (const { index, seat, outcome, payout } of results) {
      if (payout > 0) {
        await gamesWallet.creditCashForGameWithClient(client, { userId: seat.user_id, amount: payout, entryType: "table_payout", referenceType: "blackjack_round", referenceId: table.roundId });
      }
      totalPayout += payout;
      await client.query(`UPDATE games.blackjack_bets SET outcome = $3, payout_cash = $4 WHERE round_id = $1 AND seat = $2`, [table.roundId, index, outcome, payout]);
    }
    await client.query(
      `UPDATE games.blackjack_rounds SET status = 'settled', settled_at = now(), total_payout_cash = $2, dealer_json = $3, seats_json = $4 WHERE id = $1`,
      [
        table.roundId,
        round2(totalPayout),
        JSON.stringify({ hand: table.dealer.hand, value: handValue(table.dealer.hand).total }),
        JSON.stringify(results.map(({ index, seat, outcome, payout }) => ({ seat: index, user_id: seat.user_id, username: seat.username, hand: seat.hand, bet: seat.bet, doubled: seat.doubled, outcome, payout }))),
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  table.history = [
    { round_id: table.roundId, dealer: handValue(table.dealer.hand).total, results: results.map(({ seat, outcome, payout }) => ({ username: seat.username, outcome, payout, bet: seat.bet * (seat.doubled ? 2 : 1) })) },
    ...table.history,
  ].slice(0, 8);
  table.phase = "results";
  table.turn = null;
  publish(table);
  schedule(table, RESULT_MS, () => resetTable(table));
}

async function resetTable(table) {
  table.phase = "idle";
  table.deadline = null;
  table.roundId = null;
  table.dealer = { hand: [], hidden: true };
  for (const seat of table.seats) {
    if (!seat) continue;
    seat.bet = 0;
    seat.doubled = false;
    seat.hand = [];
    seat.status = "waiting";
    // Keep the last outcome visible until the next bet.
  }
  clearTimeout(table.timer);
  publish(table);
}

// ── Startup ────────────────────────────────────────────────────────────────
async function recover() {
  const { rows } = await pool.query(`SELECT id FROM games.blackjack_rounds WHERE status IN ('betting', 'playing')`);
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const bets = await client.query(`SELECT id, user_id, bet_cash, doubled FROM games.blackjack_bets WHERE round_id = $1 AND outcome IS NULL`, [row.id]);
      for (const betRow of bets.rows) {
        const amount = round2(Number(betRow.bet_cash) * (betRow.doubled ? 2 : 1));
        await gamesWallet.refundCashForGameWithClient(client, { userId: Number(betRow.user_id), amount, referenceType: "blackjack_round", referenceId: Number(row.id) });
        await client.query(`UPDATE games.blackjack_bets SET outcome = 'refund', payout_cash = $2 WHERE id = $1`, [betRow.id, amount]);
      }
      await client.query(`UPDATE games.blackjack_rounds SET status = 'refunded', settled_at = now() WHERE id = $1`, [row.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  if (rows.length) console.log(`games: refunded ${rows.length} unfinished blackjack round(s) from before restart`);
}

async function init(db) {
  pool = db;
  await recover();
  for (const spec of TABLES) {
    tables.set(spec.key, { ...spec, seats: Array(SEATS).fill(null), dealer: { hand: [], hidden: true }, phase: "idle", turn: null, deadline: null, roundId: null, shoe: newShoe(), history: [], timer: null });
  }
  hub.registerSnapshotProvider((channel) => {
    const match = /^blackjack:([a-z]+)$/.exec(channel);
    if (match && tables.has(match[1])) return { type: "blackjack", table: publicTable(tables.get(match[1])) };
    if (channel === "lobby:blackjack") return { type: "lobby", game: "blackjack", tables: lobby() };
    return null;
  });
}

function getTable(tableKey) {
  return publicTable(getTableOrThrow(tableKey));
}

module.exports = { TABLES, act, bet, getTable, handValue, init, leave, lobby, outcomeFor, sit };
