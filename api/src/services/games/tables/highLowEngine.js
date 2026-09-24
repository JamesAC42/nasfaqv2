// High-low duel rules (docs/games/GAMES_DESIGN.md §5). Pure state transitions.

const crypto = require("node:crypto");

const ROUNDS = 9;
const REVEAL_MS = 2500;
const START_MS = 3000;
const SUITS = ["S", "H", "D", "C"];

function freshDeck() {
  const deck = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank += 1) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function setup({ now, callSeconds = 10 }) {
  const deck = freshDeck();
  return {
    phase: "starting",
    round: 0,
    call_ms: callSeconds * 1000,
    current: deck.shift(),
    deck,
    calls: [null, null],
    scores: [0, 0],
    doubles_used: [false, false],
    history: [],
    deadline: now + START_MS,
    winner: null,
    done_reason: null,
  };
}

function startRound(state, now) {
  return { ...state, phase: "calling", round: state.round + 1, calls: [null, null], deadline: now + state.call_ms };
}

function scoreCall(call, current, next) {
  if (!call || call.dir === "pass") return 0;
  if (next.rank === current.rank) return 0;
  const correct = call.dir === "higher" ? next.rank > current.rank : next.rank < current.rank;
  if (call.double) return correct ? 2 : -1;
  return correct ? 1 : 0;
}

function resolveRound(state, now) {
  const [next, ...deck] = state.deck;
  const deltas = state.calls.map((call) => scoreCall(call, state.current, next));
  return {
    ...state,
    phase: "reveal",
    deck,
    history: [...state.history, { round: state.round, from: state.current, to: next, calls: state.calls, deltas }],
    scores: state.scores.map((score, seat) => score + deltas[seat]),
    current: next,
    deadline: now + REVEAL_MS,
  };
}

function afterReveal(state, now) {
  if (state.round >= ROUNDS) {
    const [a, b] = state.scores;
    return { ...state, phase: "done", deadline: null, winner: a > b ? 0 : b > a ? 1 : null, done_reason: "rounds" };
  }
  return startRound(state, now);
}

function act(state, seat, action, now) {
  if (action?.type === "forfeit") {
    if (state.phase === "done") throw invalid();
    return { ...state, phase: "done", deadline: null, winner: seat === 0 ? 1 : 0, done_reason: "forfeit" };
  }
  if (action?.type !== "call" || state.phase !== "calling" || state.calls[seat]) throw invalid();
  const dir = action.dir === "higher" || action.dir === "lower" ? action.dir : null;
  if (!dir) throw invalid();
  const double = Boolean(action.double);
  if (double && state.doubles_used[seat]) throw invalid();
  const calls = [...state.calls];
  calls[seat] = { dir, double };
  const doubles = [...state.doubles_used];
  if (double) doubles[seat] = true;
  const next = { ...state, calls, doubles_used: doubles };
  return calls.every(Boolean) ? resolveRound(next, now) : next;
}

function tick(state, now) {
  if (state.deadline === null || now < state.deadline) return state;
  if (state.phase === "starting") return startRound(state, now);
  if (state.phase === "calling") {
    const calls = state.calls.map((call) => call || { dir: "pass", double: false });
    return resolveRound({ ...state, calls }, now);
  }
  if (state.phase === "reveal") return afterReveal(state, now);
  return state;
}

function publicState(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: ROUNDS,
    deadline: state.deadline,
    current: state.current,
    cards_left: state.deck.length,
    called: state.calls.map(Boolean),
    scores: state.scores,
    doubles_used: state.doubles_used,
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

module.exports = { ROUNDS, act, publicState, scoreCall, setup, tick };
