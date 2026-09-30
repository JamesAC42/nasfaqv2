// The practice opponent at the two-player tables (Oshi Card Duel, High-Low). Practice tables are
// free and never recorded (see pvp.js); this is only who sits in the other seat and what it plays.
// It decides from what a player can see: never the order of the high-low deck, never your pick, and
// never the duel's upcoming conditions.

const crypto = require("node:crypto");
const cards = require("../cards");
const duelEngine = require("./duelEngine");

const NPC_PLAYER = Object.freeze({ user_id: null, username: "NPC", profile_color: "#8a94a6", profile_picture_url: null, npc: true });

// How often the duel NPC plays a random card instead of its best one, so it isn't a lookup table.
const DUEL_WANDER = 0.25;
// High-low: doubles once it's at least this sure (by counting the cards already seen).
const DOUBLE_CONFIDENCE = 0.8;

const randomUnit = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

/**
 * A duel deck for the NPC: the same rarities and stars as the player's cards, on other talents, so
 * the base power is even and the market decides it.
 */
function duelDeck(playerDeck, talents, pickIndex = (n) => crypto.randomInt(0, n)) {
  const taken = new Set(playerDeck.map((card) => card.symbol));
  const pool = talents.filter((talent) => !taken.has(talent.symbol));
  const source = pool.length >= playerDeck.length ? pool : talents;
  const remaining = [...source];
  return playerDeck.map((card) => {
    const talent = remaining.splice(pickIndex(remaining.length), 1)[0];
    return {
      key: cards.cardKey(talent.symbol, card.rarity),
      symbol: talent.symbol,
      name: talent.name ?? talent.symbol,
      unit: talent.unit ?? null,
      icon: talent.icon ?? null,
      color: talent.color ?? null,
      rarity: card.rarity,
      stars: card.stars,
      base: cards.basePower(card.rarity, card.stars),
      momentum: cards.momentumOf(talent.move_pct),
      move_pct: talent.move_pct ?? null,
      price: talent.price ?? null,
    };
  });
}

const unusedIndexes = (state, seat) => state.used[seat].map((used, index) => (used ? null : index)).filter((index) => index !== null);

/**
 * The duel NPC's pick this round: the card that beats the player's remaining cards by the most
 * under the round's condition (both decks are face up), or now and then any card.
 */
function duelPick(state, seat, random = randomUnit) {
  const mine = unusedIndexes(state, seat);
  if (random() < DUEL_WANDER) return { type: "pick", card: mine[Math.floor(random() * mine.length) % mine.length] };
  const other = seat === 0 ? 1 : 0;
  const theirs = unusedIndexes(state, other).map((index) => state.decks[other][index]);
  const condition = state.conditions[state.round - 1];
  let best = mine[0];
  let bestMargin = -Infinity;
  for (const index of mine) {
    const card = state.decks[seat][index];
    const margin = theirs.reduce((sum, opponent) => sum + duelEngine.powerOf(card, opponent, condition).total - duelEngine.powerOf(opponent, card, condition).total, 0) / Math.max(1, theirs.length);
    if (margin > bestMargin) {
      best = index;
      bestMargin = margin;
    }
  }
  return { type: "pick", card: best };
}

/** Ranks still in the deck, from a full deck minus every card turned over so far. */
function unseenRanks(state) {
  const seen = new Set([`${state.current.rank}${state.current.suit}`]);
  for (const entry of state.history) {
    seen.add(`${entry.from.rank}${entry.from.suit}`);
    seen.add(`${entry.to.rank}${entry.to.suit}`);
  }
  const ranks = [];
  for (const suit of ["S", "H", "D", "C"]) for (let rank = 2; rank <= 14; rank += 1) if (!seen.has(`${rank}${suit}`)) ranks.push(rank);
  return ranks;
}

/** The high-low NPC's call: whichever way more of the unseen cards lie, doubling when it's sure. */
function highLowCall(state, seat, random = randomUnit) {
  const ranks = unseenRanks(state);
  const higher = ranks.filter((rank) => rank > state.current.rank).length;
  const lower = ranks.filter((rank) => rank < state.current.rank).length;
  const dir = higher > lower ? "higher" : lower > higher ? "lower" : random() < 0.5 ? "higher" : "lower";
  const confidence = ranks.length ? Math.max(higher, lower) / ranks.length : 0;
  return { type: "call", dir, double: !state.doubles_used[seat] && confidence >= DOUBLE_CONFIDENCE };
}

/** Whether the round is waiting on this seat's move. */
function toMove(gameKey, state, seat) {
  if (gameKey === "oshi-duel") return state.phase === "picking" && state.picks[seat] === null;
  if (gameKey === "high-low") return state.phase === "calling" && !state.calls[seat];
  return false;
}

/** The NPC's move if it has one to make now, else null. */
function nextAction(gameKey, state, seat, random = randomUnit) {
  if (!toMove(gameKey, state, seat)) return null;
  return gameKey === "oshi-duel" ? duelPick(state, seat, random) : highLowCall(state, seat, random);
}

/** A human-looking pause before it plays: 1.2 to 3.5 s, always inside the round's clock. */
function thinkMs(state, now, random = randomUnit) {
  const pause = 1200 + Math.floor(random() * 2300);
  return Math.max(150, Math.min(pause, (state.deadline ?? now + pause) - now - 400));
}

module.exports = { NPC_PLAYER, duelDeck, duelPick, highLowCall, nextAction, thinkMs, toMove, unseenRanks };
