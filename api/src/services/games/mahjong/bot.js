// The bots that fill empty seats, play the tutorial and take over a seat nobody is at.
//
// A bot reads its own hand and what's face up on the table (ponds, melds, dora indicators, riichi
// and scores) and nothing else: never another hand, never the wall. mahjong-bot.test.js scrambles
// everything hidden and checks the move doesn't change.
//
// Three levels:
//   easy    keeps the tiles that move it toward tenpai, with the odd slip; pons value tiles; never folds.
//   normal  the same without slips, counting which tiles are still live; calls when the hand keeps a
//           yaku; folds to a riichi with safe tiles when it is two or more away.
//   hard    normal, and keeps dora, folds earlier late in the hand, and stays quiet with a big hand.
// "auto" is the paid tables' autopilot: it discards what it drew and passes everything, wins included.

const round = require("./round");
const { improvements, orphansShanten, shanten } = require("./shanten");
const { KINDS, countKinds, doraFromIndicator, isDragon, isHonor, isRedFive, isYaochuu, kindOf } = require("./tiles");

const LEVELS = Object.freeze(["easy", "normal", "hard"]);

// ── What the bot can see ───────────────────────────────────────────────────
function seenCounts(state, seat) {
  const seen = countKinds(state.hands[seat].map(kindOf));
  for (let other = 0; other < 4; other += 1) {
    for (const meld of state.melds[other]) for (const tile of meld.tiles) seen[kindOf(tile)] += 1;
    for (const entry of state.ponds[other]) if (!entry.called) seen[kindOf(entry.tile)] += 1;
  }
  for (const tile of round.doraIndicators(state)) seen[kindOf(tile)] += 1;
  return seen;
}

const doraKinds = (state) => round.doraIndicators(state).map((tile) => doraFromIndicator(kindOf(tile)));
const isValueKind = (state, seat, kind) => isDragon(kind) || kind === round.seatWind(state, seat) || kind === state.roundWind;

/**
 * How an open hand means to score: "any" once a value triplet is down or in hand, "tanyao" while
 * every call is simples, null for a closed hand (riichi will do).
 */
function planOf(state, seat, counts, melds = state.melds[seat]) {
  const open = melds.filter((meld) => meld.type !== "ankan");
  if (!open.length) return null;
  if (melds.some((meld) => meld.type !== "chi" && isValueKind(state, seat, round.meldKind(meld)))) return "any";
  for (let kind = 27; kind < KINDS; kind += 1) if (counts[kind] >= 3 && isValueKind(state, seat, kind)) return "any";
  if (melds.every((meld) => meld.tiles.every((tile) => !isYaochuu(kindOf(tile))))) return "tanyao";
  return "any";
}

/** Counts as the plan sees them: an all-simples hand has no use for terminals and honors. */
function planCounts(counts, plan) {
  if (plan !== "tanyao") return counts;
  const copy = counts.slice();
  for (let kind = 0; kind < KINDS; kind += 1) if (isYaochuu(kind)) copy[kind] = 0;
  return copy;
}

// Terminals and honors in an all-simples hand are loose tiles: the shanten of the rest already counts
// them as tiles to replace.
const planShanten = (counts, melds, plan) => shanten(planCounts(counts, plan), melds);

/** Whether the hand has its yaku whatever else it calls: a value triplet, called or in hand. */
function yakuSecured(state, seat, counts, melds) {
  if (melds.some((meld) => meld.type !== "chi" && isValueKind(state, seat, kindOf(meld.tiles[0])))) return true;
  for (let kind = 27; kind < KINDS; kind += 1) if (counts[kind] >= 3 && isValueKind(state, seat, kind)) return true;
  return false;
}

// ── Defense ────────────────────────────────────────────────────────────────
/** The seats this one has to respect: anyone else in riichi. */
function threats(state, seat) {
  const out = [];
  for (let other = 0; other < 4; other += 1) {
    if (other === seat || !state.riichi[other]) continue;
    const declared = state.ponds[other].find((entry) => entry.riichi);
    out.push({ seat: other, since: declared ? declared.n : 0 });
  }
  return out;
}

/** 0 to 100: how safe `kind` is to discard against one riichi. */
function safetyAgainst(state, threat, kind, seen) {
  const pond = state.ponds[threat.seat];
  const thrown = new Set(pond.map((entry) => kindOf(entry.tile)));
  if (thrown.has(kind)) return 100;
  // Anything discarded since the riichi went by them without a win.
  for (let other = 0; other < 4; other += 1) {
    if (other === threat.seat) continue;
    if (state.ponds[other].some((entry) => entry.n > threat.since && kindOf(entry.tile) === kind)) return 100;
  }
  if (isHonor(kind)) return seen[kind] >= 3 ? 95 : seen[kind] === 2 ? 80 : seen[kind] === 1 ? 60 : 45;
  const n = kind % 9;
  const base = kind - n;
  const low = n >= 3 && thrown.has(base + n - 3);
  const high = n <= 5 && thrown.has(base + n + 3);
  const suji = n <= 2 ? high : n >= 6 ? low : low && high;
  const edge = Math.min(n, 8 - n); // 0 for a terminal, up to 4 for a five
  if (suji) return edge === 0 ? 75 : edge === 1 ? 62 : edge === 2 ? 55 : 50;
  if ((n <= 2 || n >= 6 ? false : low || high) && edge >= 3) return 30;
  return edge === 0 ? 40 : edge === 1 ? 26 : edge === 2 ? 20 : 12;
}

// ── Choosing a discard ─────────────────────────────────────────────────────
/** How much a tile is worth keeping when two discards are otherwise equal. */
function keepValue(state, seat, counts, kind, dora) {
  let value = 0;
  if (dora.includes(kind)) value += 6;
  if (isHonor(kind)) {
    if (counts[kind] >= 2) value += 6;
    else if (isValueKind(state, seat, kind)) value += 2;
    return value;
  }
  const n = kind % 9;
  value += 3 - Math.abs(4 - n) * 0.5; // middle tiles connect more ways
  for (const step of [-2, -1, 1, 2]) {
    const other = n + step;
    if (other >= 0 && other <= 8 && counts[kind + step] > 0) value += Math.abs(step) === 1 ? 2 : 1;
  }
  if (counts[kind] >= 2) value += 3;
  return value;
}

/** One tile to throw for each kind that may be discarded: the drawn one or a plain five before a red. */
function discardChoices(state, discards) {
  const byKind = new Map();
  for (const tile of discards) {
    const kind = kindOf(tile);
    const current = byKind.get(kind);
    if (current === undefined) byKind.set(kind, tile);
    else if (isRedFive(current) && !isRedFive(tile)) byKind.set(kind, tile);
    else if (tile === state.drawn && !isRedFive(tile)) byKind.set(kind, tile);
  }
  return byKind;
}

function chooseDiscard(state, seat, options, level, random) {
  const hand = state.hands[seat];
  const counts = countKinds(hand.map(kindOf));
  const melds = state.melds[seat].length;
  const seen = seenCounts(state, seat);
  const dora = doraKinds(state);
  const plan = planOf(state, seat, counts);
  const choices = discardChoices(state, options.discards);

  const scored = [];
  for (const [kind, tile] of choices) {
    counts[kind] -= 1;
    scored.push({ kind, tile, shanten: planShanten(counts, melds, plan) });
    counts[kind] += 1;
  }
  const bestShanten = Math.min(...scored.map((entry) => entry.shanten));

  const facing = level === "easy" ? [] : threats(state, seat);
  const left = round.remaining(state);
  const fold = facing.length > 0 && (bestShanten >= 2 || (level === "hard" && bestShanten === 1 && left < 20));
  if (facing.length) for (const entry of scored) entry.safety = Math.min(...facing.map((threat) => safetyAgainst(state, threat, entry.kind, seen)));

  if (fold) {
    scored.sort((a, b) => b.safety - a.safety || a.shanten - b.shanten || keepValue(state, seat, counts, a.kind, dora) - keepValue(state, seat, counts, b.kind, dora));
    return { entry: scored[0], folding: true, bestShanten };
  }

  const top = scored.filter((entry) => entry.shanten === bestShanten);
  for (const entry of top) {
    counts[entry.kind] -= 1;
    entry.useful = improvements(planCounts(counts, plan), melds, seen).left;
    counts[entry.kind] += 1;
    entry.keep = keepValue(state, seat, counts, entry.kind, dora) + (level === "hard" && isRedFive(entry.tile) ? 6 : 0);
  }
  top.sort((a, b) => b.useful - a.useful || (facing.length ? b.safety - a.safety : 0) || a.keep - b.keep);
  // An easy bot's slip: now and then, the second or third choice.
  if (level === "easy" && top.length > 1 && random() < 0.2) return { entry: top[Math.min(top.length - 1, 1 + Math.floor(random() * 2))], folding: false, bestShanten };
  return { entry: top[0], folding: false, bestShanten };
}

// ── The turn ───────────────────────────────────────────────────────────────
function wantsKan(state, seat, kind, level) {
  if (level === "easy" || threats(state, seat).length) return false;
  if (state.riichi[seat]) return true; // only offered when it changes nothing
  const counts = countKinds(state.hands[seat].map(kindOf));
  const melds = state.melds[seat].length;
  const before = shanten(counts, melds);
  const after = counts.slice();
  // A closed kan takes all four out of the hand and adds a set; an added kan takes the one in hand.
  const closed = counts[kind] === 4;
  after[kind] -= closed ? 4 : 1;
  return shanten(after, melds + (closed ? 1 : 0)) <= before;
}

function wantsRiichi(state, seat, entry, level, random) {
  if (level !== "hard") return level === "normal" || random() < 0.9;
  // With a hand that already scores well on its own, stay quiet late in the hand.
  const hand = state.hands[seat].filter((tile) => tile !== entry.tile);
  const counts = countKinds(hand.map(kindOf));
  const valueTriplets = [27, 28, 29, 30, 31, 32, 33].filter((kind) => counts[kind] >= 3 && isValueKind(state, seat, kind)).length;
  const dora = doraKinds(state).reduce((sum, kind) => sum + counts[kind], 0) + hand.filter(isRedFive).length;
  return !(valueTriplets >= 1 && dora >= 3 && round.remaining(state) < 24);
}

function playTurn(state, seat, options, level, random) {
  if (options.tsumo) return { type: "tsumo" };
  if (options.kyuushu) {
    const counts = countKinds(state.hands[seat].map(kindOf));
    if (orphansShanten(counts) > 2) return { type: "kyuushu" };
  }
  for (const kind of options.ankan) if (wantsKan(state, seat, kind, level)) return { type: "ankan", kind };
  for (const kind of options.kakan) if (wantsKan(state, seat, kind, level)) return { type: "kakan", kind };
  if (state.riichi[seat]) return { type: "discard", tile: state.drawn };

  const { entry, folding, bestShanten } = chooseDiscard(state, seat, options, level, random);
  if (!folding && bestShanten === 0 && options.riichi.length) {
    const riichiTile = options.riichi.includes(entry.tile) ? entry.tile : options.riichi.find((tile) => kindOf(tile) === entry.kind);
    if (riichiTile !== undefined && wantsRiichi(state, seat, entry, level, random)) return { type: "discard", tile: riichiTile, riichi: true };
  }
  return { type: "discard", tile: entry.tile };
}

// ── Answering a discard ────────────────────────────────────────────────────
function considerCall(state, seat, options, level) {
  if (level === "easy" && !options.pon) return null;
  const hand = state.hands[seat];
  const kind = kindOf(options.tile);
  const counts = countKinds(hand.map(kindOf));
  const melds = state.melds[seat];
  const facing = level === "easy" ? [] : threats(state, seat);
  const planNow = planOf(state, seat, counts);
  const before = planShanten(counts, melds.length, planNow);
  if (facing.length && before >= 2) return null;

  const tryCall = (type, tiles) => {
    const after = counts.slice();
    for (const tile of tiles) after[kindOf(tile)] -= 1;
    const meld = { type, tiles: [...tiles, options.tile] };
    const nextMelds = [...melds, meld];
    const plan = planOf(state, seat, after, nextMelds);
    const simple = meld.tiles.every((tile) => !isYaochuu(kindOf(tile)));
    const value = type === "pon" && isValueKind(state, seat, kind);
    // The hand after the call still has to discard: the best it can then be.
    let best = 8;
    for (let other = 0; other < KINDS; other += 1) {
      if (after[other] === 0) continue;
      after[other] -= 1;
      best = Math.min(best, planShanten(after, nextMelds.length, plan));
      after[other] += 1;
    }
    if (best >= before) return null;
    if (value) return { type, tiles };
    if (level === "easy") return null;
    if (yakuSecured(state, seat, after, nextMelds)) return { type, tiles };
    if (plan === "tanyao" && simple) {
      let outside = 0;
      for (let other = 0; other < KINDS; other += 1) if (isYaochuu(other)) outside += after[other];
      if (outside <= 2 && best <= 1) return { type, tiles };
    }
    return null;
  };

  if (options.pon) {
    const call = tryCall("pon", options.pon[0]);
    if (call) return call;
  }
  if (options.chi && level !== "easy") {
    for (const tiles of options.chi) {
      const call = tryCall("chi", tiles);
      if (call) return call;
    }
  }
  return null;
}

/**
 * The move a bot at `level` makes for `seat` right now, as an action for round.act(), or null if
 * nothing is asked of that seat. `random` is a 0-1 source (the easy bot's slips).
 */
function decide(state, seat, { level = "normal", random = Math.random } = {}) {
  const options = round.optionsFor(state, seat);
  if (!options) return null;
  if (level === "auto") {
    return options.phase === "turn" ? { type: "discard", tile: state.drawn ?? options.discards[options.discards.length - 1] } : { type: "pass" };
  }
  if (options.phase === "turn") return playTurn(state, seat, options, level, random);
  if (options.ron) return { type: "ron" };
  return considerCall(state, seat, options, level) ?? { type: "pass" };
}

module.exports = { LEVELS, chooseDiscard, decide, planOf, safetyAgainst, seenCounts, threats };
