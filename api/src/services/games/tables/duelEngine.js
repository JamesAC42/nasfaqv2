// Oshi Card Duel rules (docs/games/GAMES_DESIGN.md §3). Pure state transitions: the table
// manager owns timers, money and persistence.

const crypto = require("node:crypto");

const DECK_SIZE = 5;
const WINS_NEEDED = 3;
const MAX_ROUNDS = 5;
const REVEAL_MS = 4500;
const START_MS = 3000;

const CONDITIONS = [
  { key: "bull", label: "Bull run", text: "+5 to cards whose stock is up today" },
  { key: "bear", label: "Bear market", text: "+5 to cards whose stock is down today" },
  { key: "unit", label: "Unit spotlight", text: "+6 to members of the spotlit unit" },
  { key: "underdog", label: "Underdog", text: "+7 to the lower base-power card" },
  { key: "whale", label: "Whale day", text: "+4 to the higher-priced stock" },
  { key: "volatility", label: "Volatility", text: "Momentum counts double" },
  { key: "quiet", label: "Quiet market", text: "Momentum doesn't count" },
  { key: "rookie", label: "Rookie night", text: "+5 to C and R cards" },
];

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function unitLabel(unit) {
  return String(unit || "").replace(/^hololive\s+/i, "").trim();
}

function drawConditions(decks) {
  const units = [...new Set(decks.flat().map((card) => card.unit).filter(Boolean))];
  return shuffle(CONDITIONS)
    .slice(0, MAX_ROUNDS)
    .map((condition) => {
      if (condition.key !== "unit") return { ...condition };
      const unit = units.length ? units[crypto.randomInt(0, units.length)] : null;
      return { ...condition, unit, label: unit ? `Spotlight: ${unitLabel(unit)}` : condition.label, text: unit ? `+6 to ${unitLabel(unit)} members` : condition.text };
    });
}

/** Power of `card` against `other` under `condition`, with the breakdown shown on reveal. */
function powerOf(card, other, condition) {
  let momentum = card.momentum;
  if (condition.key === "volatility") momentum *= 2;
  if (condition.key === "quiet") momentum = 0;
  let bonus = 0;
  if (condition.key === "bull" && card.move_pct > 0) bonus = 5;
  if (condition.key === "bear" && card.move_pct < 0) bonus = 5;
  if (condition.key === "unit" && condition.unit && card.unit === condition.unit) bonus = 6;
  if (condition.key === "underdog" && card.base < other.base) bonus = 7;
  if (condition.key === "whale" && (card.price ?? 0) > (other.price ?? 0)) bonus = 4;
  if (condition.key === "rookie" && (card.rarity === "C" || card.rarity === "R")) bonus = 5;
  return { base: card.base, momentum, bonus, total: card.base + momentum + bonus };
}

function setup({ decks, now, pickSeconds = 20 }) {
  return {
    phase: "starting",
    round: 0,
    pick_ms: pickSeconds * 1000,
    decks,
    used: decks.map(() => Array(DECK_SIZE).fill(false)),
    conditions: drawConditions(decks),
    picks: [null, null],
    auto: [false, false],
    wins: [0, 0],
    history: [],
    deadline: now + START_MS,
    winner: null,
    done_reason: null,
  };
}

function startRound(state, now) {
  return { ...state, phase: "picking", round: state.round + 1, picks: [null, null], auto: [false, false], deadline: now + state.pick_ms };
}

function resolveRound(state, now) {
  const condition = state.conditions[state.round - 1];
  const cardsPlayed = state.picks.map((index, seat) => state.decks[seat][index]);
  const powers = [powerOf(cardsPlayed[0], cardsPlayed[1], condition), powerOf(cardsPlayed[1], cardsPlayed[0], condition)];
  const winner = powers[0].total > powers[1].total ? 0 : powers[1].total > powers[0].total ? 1 : null;
  const wins = [...state.wins];
  if (winner !== null) wins[winner] += 1;
  const used = state.used.map((row, seat) => row.map((flag, index) => flag || index === state.picks[seat]));
  return {
    ...state,
    phase: "reveal",
    wins,
    used,
    history: [...state.history, { round: state.round, condition, picks: [...state.picks], auto: [...state.auto], powers, winner }],
    deadline: now + REVEAL_MS,
  };
}

function finish(state, winner, reason) {
  return { ...state, phase: "done", deadline: null, winner, done_reason: reason };
}

function afterReveal(state, now) {
  const [a, b] = state.wins;
  if (a >= WINS_NEEDED) return finish(state, 0, "wins");
  if (b >= WINS_NEEDED) return finish(state, 1, "wins");
  if (state.round >= MAX_ROUNDS) return finish(state, a > b ? 0 : b > a ? 1 : null, "rounds");
  // No path to 3 wins for the trailing side and nothing left to change? Keep playing: every round counts.
  return startRound(state, now);
}

function randomUnused(state, seat) {
  const open = state.used[seat].map((used, index) => (used ? null : index)).filter((index) => index !== null);
  return open[crypto.randomInt(0, open.length)];
}

/** A player action. Throws invalid_action for anything that isn't allowed right now. */
function act(state, seat, action, now) {
  if (action?.type === "forfeit") {
    if (state.phase === "done") throw invalid();
    return finish(state, seat === 0 ? 1 : 0, "forfeit");
  }
  if (action?.type !== "pick" || state.phase !== "picking") throw invalid();
  const index = Number(action.card);
  if (!Number.isInteger(index) || index < 0 || index >= DECK_SIZE || state.used[seat][index]) throw invalid();
  if (state.picks[seat] !== null) throw invalid();
  const picks = [...state.picks];
  picks[seat] = index;
  const next = { ...state, picks };
  return picks.every((pick) => pick !== null) ? resolveRound(next, now) : next;
}

/** Advance on deadlines: start, auto-picks on timeout, end of the reveal pause. */
function tick(state, now) {
  if (state.deadline === null || now < state.deadline) return state;
  if (state.phase === "starting") return startRound(state, now);
  if (state.phase === "picking") {
    const picks = [...state.picks];
    const auto = [...state.auto];
    for (const seat of [0, 1]) {
      if (picks[seat] === null) {
        picks[seat] = randomUnused(state, seat);
        auto[seat] = true;
      }
    }
    return resolveRound({ ...state, picks, auto }, now);
  }
  if (state.phase === "reveal") return afterReveal(state, now);
  return state;
}

/** What everyone (players and spectators) sees. Picks stay hidden until both are in. */
function publicState(state) {
  return {
    phase: state.phase,
    round: state.round,
    max_rounds: MAX_ROUNDS,
    wins_needed: WINS_NEEDED,
    deadline: state.deadline,
    decks: state.decks,
    used: state.used,
    wins: state.wins,
    picked: state.picks.map((pick) => pick !== null),
    condition: state.round ? state.conditions[state.round - 1] : null,
    upcoming_conditions: state.conditions.length - state.round,
    history: state.history,
    winner: state.winner,
    done_reason: state.done_reason,
  };
}

function invalid() {
  const error = new Error("invalid_action");
  error.code = "invalid_action";
  return error;
}

module.exports = {
  CONDITIONS,
  DECK_SIZE,
  MAX_ROUNDS,
  WINS_NEEDED,
  act,
  powerOf,
  publicState,
  setup,
  tick,
};
