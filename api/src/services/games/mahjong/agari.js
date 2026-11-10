// Reading a winning hand: every way it splits into sets, the yaku each reading has, its fu, and the
// points (docs/games/MAHJONG_DESIGN.md §1, "Yaku" and "Scoring"). The reading that scores most wins.
//
// evaluate() takes kinds, not tile ids: red fives and dora arrive as counts and lists. It knows
// nothing about turns or walls; round.js passes in what happened (riichi, last tile, after a kan).

const { ALL_GREEN, KINDS, YAOCHUU_KINDS, countKinds, isDragon, isHonor, isSuited, isTerminal, isWind, isYaochuu, suitOf } = require("./tiles");

/** Every split of a 3n+2 group of concealed tiles into a pair and sets. */
function decompose(counts) {
  const out = [];
  const sets = [];
  const walk = (start, pair) => {
    let i = start;
    while (i < KINDS && counts[i] === 0) i += 1;
    if (i >= KINDS) {
      out.push({ pair, sets: sets.map((set) => ({ ...set })) });
      return;
    }
    if (counts[i] >= 3) {
      counts[i] -= 3;
      sets.push({ seq: false, kind: i });
      walk(i, pair);
      sets.pop();
      counts[i] += 3;
    }
    if (isSuited(i) && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i] -= 1;
      counts[i + 1] -= 1;
      counts[i + 2] -= 1;
      sets.push({ seq: true, kind: i });
      walk(i, pair);
      sets.pop();
      counts[i] += 1;
      counts[i + 1] += 1;
      counts[i + 2] += 1;
    }
  };
  for (let pair = 0; pair < KINDS; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    walk(0, pair);
    counts[pair] += 2;
  }
  return out;
}

const MELD_SHAPE = {
  chi: { seq: true, kan: false, closed: false, called: true },
  pon: { seq: false, kan: false, closed: false, called: true },
  minkan: { seq: false, kan: true, closed: false, called: true },
  kakan: { seq: false, kan: true, closed: false, called: true },
  ankan: { seq: false, kan: true, closed: true, called: false },
};

const setHasYaochuu = (set) => (set.seq ? set.kind % 9 === 0 || set.kind % 9 === 6 : isYaochuu(set.kind));

/** Base points for han and fu, and the name of the limit it hit (null under mangan). */
function basePoints(han, fu, yakuman = 0) {
  if (yakuman > 0) return { base: 8000 * yakuman, limit: "yakuman" };
  if (han >= 13) return { base: 8000, limit: "kazoe" };
  if (han >= 11) return { base: 6000, limit: "sanbaiman" };
  if (han >= 8) return { base: 4000, limit: "baiman" };
  if (han >= 6) return { base: 3000, limit: "haneman" };
  if (han >= 5) return { base: 2000, limit: "mangan" };
  const base = fu * 2 ** (han + 2);
  return base >= 2000 ? { base: 2000, limit: "mangan" } : { base, limit: null };
}

const ceil100 = (value) => Math.ceil(value / 100) * 100;

/**
 * What each seat pays for a win worth `base`, before honba and sticks. Returns { total, from }: `from`
 * maps a paying seat to its amount. A self-draw is paid by all three; a ron by `loser`.
 */
function payments({ base, winner, dealer, tsumo, loser = null }) {
  const from = {};
  if (tsumo) {
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat === winner) continue;
      from[seat] = ceil100(base * (winner === dealer || seat === dealer ? 2 : 1));
    }
  } else {
    from[loser] = ceil100(base * (winner === dealer ? 6 : 4));
  }
  return { total: Object.values(from).reduce((sum, amount) => sum + amount, 0), from };
}

function sequenceWait(set, winKind) {
  if (winKind === set.kind + 1) return "kanchan";
  if (winKind === set.kind) return set.kind % 9 === 6 ? "penchan" : "ryanmen";
  return set.kind % 9 === 0 ? "penchan" : "ryanmen";
}

/** One reading of the standard form: its yaku and fu. `spot` is where the winning tile sits. */
function readStandard(ctx, pairKind, concealedSets, spot) {
  const { melds, winKind, tsumo, seatWind, roundWind } = ctx;
  const sets = concealedSets.map((set, index) => ({
    seq: set.seq,
    kind: set.kind,
    kan: false,
    called: false,
    // A triplet finished by someone else's discard counts as open for fu and concealed-triplet yaku.
    closed: !(spot.set === index && !set.seq && !tsumo),
  }));
  for (const meld of melds) sets.push({ kind: meld.kind, ...MELD_SHAPE[meld.type] });

  const menzen = sets.every((set) => !set.called);
  const sequences = sets.filter((set) => set.seq);
  const triplets = sets.filter((set) => !set.seq);
  const wait = spot.set === undefined ? "tanki" : sets[spot.set].seq ? sequenceWait(sets[spot.set], winKind) : "shanpon";
  const closedTriplets = triplets.filter((set) => set.closed).length;
  const kans = sets.filter((set) => set.kan).length;
  const hasTriplet = (kind) => triplets.some((set) => set.kind === kind);

  // ── Yakuman ──────────────────────────────────────────────────────────────
  const yakuman = [];
  if (ctx.tenhou) yakuman.push("tenhou");
  if (ctx.chiihou) yakuman.push("chiihou");
  if (closedTriplets === 4) yakuman.push("suuankou");
  if (hasTriplet(31) && hasTriplet(32) && hasTriplet(33)) yakuman.push("daisangen");
  const windTriplets = triplets.filter((set) => isWind(set.kind)).length;
  if (windTriplets === 4) yakuman.push("daisuushii");
  else if (windTriplets === 3 && isWind(pairKind)) yakuman.push("shousuushii");
  if (isHonor(pairKind) && sets.every((set) => !set.seq && isHonor(set.kind))) yakuman.push("tsuuiisou");
  if (isTerminal(pairKind) && sets.every((set) => !set.seq && isTerminal(set.kind))) yakuman.push("chinroutou");
  if (ALL_GREEN.has(pairKind) && sets.every((set) => (set.seq ? set.kind === 19 : ALL_GREEN.has(set.kind)))) yakuman.push("ryuuiisou");
  if (kans === 4) yakuman.push("suukantsu");
  if (!melds.length && ctx.chuuren) yakuman.push("chuuren");
  if (yakuman.length) {
    return { form: "standard", wait, yaku: yakuman.map((key) => ({ key, han: 13 })), yakuman: yakuman.length, yakuHan: 0, fu: 0, fuParts: [], menzen };
  }

  // ── Yaku ─────────────────────────────────────────────────────────────────
  const yaku = [];
  const add = (key, han) => yaku.push({ key, han });
  if (ctx.riichi === 2) add("double-riichi", 2);
  else if (ctx.riichi === 1) add("riichi", 1);
  if (ctx.riichi && ctx.ippatsu) add("ippatsu", 1);
  if (menzen && tsumo) add("menzen-tsumo", 1);
  if (ctx.rinshan) add("rinshan", 1);
  if (ctx.chankan) add("chankan", 1);
  if (ctx.haitei) add("haitei", 1);
  if (ctx.houtei) add("houtei", 1);

  const valuePair = isDragon(pairKind) || pairKind === seatWind || pairKind === roundWind;
  const pinfu = menzen && sequences.length === 4 && !valuePair && wait === "ryanmen";
  if (pinfu) add("pinfu", 1);

  const allSimple = !isYaochuu(pairKind) && sets.every((set) => !setHasYaochuu(set));
  if (allSimple) add("tanyao", 1);

  if (menzen) {
    const seen = new Map();
    for (const set of sequences) seen.set(set.kind, (seen.get(set.kind) ?? 0) + 1);
    let doubles = 0;
    for (const count of seen.values()) doubles += Math.floor(count / 2);
    if (doubles === 2) add("ryanpeikou", 3);
    else if (doubles === 1) add("iipeikou", 1);
  }

  for (const dragon of [31, 32, 33]) if (hasTriplet(dragon)) add(dragon === 31 ? "yakuhai-white" : dragon === 32 ? "yakuhai-green" : "yakuhai-red", 1);
  if (hasTriplet(seatWind)) add("yakuhai-seat", 1);
  if (hasTriplet(roundWind)) add("yakuhai-round", 1);

  const seqAt = (kind) => sequences.some((set) => set.kind === kind);
  for (let n = 0; n <= 6; n += 1) {
    if (seqAt(n) && seqAt(9 + n) && seqAt(18 + n)) {
      add("sanshoku", menzen ? 2 : 1);
      break;
    }
  }
  for (let suit = 0; suit < 3; suit += 1) {
    if (seqAt(suit * 9) && seqAt(suit * 9 + 3) && seqAt(suit * 9 + 6)) {
      add("ittsu", menzen ? 2 : 1);
      break;
    }
  }

  const allOutside = isYaochuu(pairKind) && sets.every(setHasYaochuu);
  const anyHonor = isHonor(pairKind) || sets.some((set) => isHonor(set.kind));
  if (allOutside && sequences.length) {
    if (anyHonor) add("chanta", menzen ? 2 : 1);
    else add("junchan", menzen ? 3 : 2);
  }
  if (!sequences.length) add("toitoi", 2);
  if (closedTriplets === 3) add("sanankou", 2);
  for (let n = 0; n < 9; n += 1) {
    if (hasTriplet(n) && hasTriplet(9 + n) && hasTriplet(18 + n)) {
      add("sanshoku-doukou", 2);
      break;
    }
  }
  if (kans === 3) add("sankantsu", 2);
  if (allOutside && !sequences.length) add("honroutou", 2);
  const dragonTriplets = triplets.filter((set) => isDragon(set.kind)).length;
  if (dragonTriplets === 2 && isDragon(pairKind)) add("shousangen", 2);

  const suits = new Set();
  if (isSuited(pairKind)) suits.add(suitOf(pairKind));
  for (const set of sets) if (isSuited(set.kind)) suits.add(suitOf(set.kind));
  if (suits.size === 1) {
    if (anyHonor) add("honitsu", menzen ? 3 : 2);
    else add("chinitsu", menzen ? 6 : 5);
  }

  // ── Fu ───────────────────────────────────────────────────────────────────
  const fuParts = [];
  let fu = 20;
  if (pinfu) {
    fuParts.push({ key: "base", fu: 20 });
    if (!tsumo) {
      fuParts.push({ key: "closed-ron", fu: 10 });
      fu = 30;
    }
  } else {
    fuParts.push({ key: "base", fu: 20 });
    for (const set of triplets) {
      let value = 2;
      if (set.closed) value *= 2;
      if (isYaochuu(set.kind)) value *= 2;
      if (set.kan) value *= 4;
      fu += value;
      fuParts.push({ key: set.kan ? (set.closed ? "closed-kan" : "open-kan") : set.closed ? "closed-triplet" : "open-triplet", fu: value, kind: set.kind });
    }
    let pairFu = 0;
    if (isDragon(pairKind)) pairFu += 2;
    if (pairKind === seatWind) pairFu += 2;
    if (pairKind === roundWind) pairFu += 2;
    if (pairFu) {
      fu += pairFu;
      fuParts.push({ key: "value-pair", fu: pairFu, kind: pairKind });
    }
    if (wait === "kanchan" || wait === "penchan" || wait === "tanki") {
      fu += 2;
      fuParts.push({ key: `wait-${wait}`, fu: 2 });
    }
    if (tsumo) {
      fu += 2;
      fuParts.push({ key: "tsumo", fu: 2 });
    } else if (menzen) {
      fu += 10;
      fuParts.push({ key: "closed-ron", fu: 10 });
    }
    if (!menzen && fu === 20) {
      fu = 30;
      fuParts.push({ key: "open-minimum", fu: 10 });
    }
  }
  const rounded = Math.ceil(fu / 10) * 10;
  if (rounded !== fu) fuParts.push({ key: "round-up", fu: rounded - fu });

  return { form: "standard", wait, yaku, yakuman: 0, yakuHan: yaku.reduce((sum, entry) => sum + entry.han, 0), fu: rounded, fuParts, menzen };
}

/** Seven pairs: seven different pairs, closed. */
function readSevenPairs(ctx, counts) {
  const kinds = [];
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] === 0) continue;
    if (counts[kind] !== 2) return null;
    kinds.push(kind);
  }
  if (kinds.length !== 7) return null;
  if (ctx.tenhou || ctx.chiihou || kinds.every(isHonor)) {
    const yakuman = [];
    if (ctx.tenhou) yakuman.push("tenhou");
    if (ctx.chiihou) yakuman.push("chiihou");
    if (kinds.every(isHonor)) yakuman.push("tsuuiisou");
    return { form: "pairs", wait: "tanki", yaku: yakuman.map((key) => ({ key, han: 13 })), yakuman: yakuman.length, yakuHan: 0, fu: 0, fuParts: [], menzen: true };
  }
  const yaku = [];
  const add = (key, han) => yaku.push({ key, han });
  if (ctx.riichi === 2) add("double-riichi", 2);
  else if (ctx.riichi === 1) add("riichi", 1);
  if (ctx.riichi && ctx.ippatsu) add("ippatsu", 1);
  if (ctx.tsumo) add("menzen-tsumo", 1);
  if (ctx.rinshan) add("rinshan", 1);
  if (ctx.chankan) add("chankan", 1);
  if (ctx.haitei) add("haitei", 1);
  if (ctx.houtei) add("houtei", 1);
  add("chiitoitsu", 2);
  if (kinds.every((kind) => !isYaochuu(kind))) add("tanyao", 1);
  if (kinds.every(isYaochuu)) add("honroutou", 2);
  const suits = new Set(kinds.filter(isSuited).map(suitOf));
  if (suits.size === 1) {
    if (kinds.some(isHonor)) add("honitsu", 3);
    else add("chinitsu", 6);
  }
  return { form: "pairs", wait: "tanki", yaku, yakuman: 0, yakuHan: yaku.reduce((sum, entry) => sum + entry.han, 0), fu: 25, fuParts: [{ key: "seven-pairs", fu: 25 }], menzen: true };
}

/** Thirteen orphans: one of each terminal and honor and a second of any of them. */
function readOrphans(ctx, counts) {
  let total = 0;
  for (let kind = 0; kind < KINDS; kind += 1) total += counts[kind];
  if (total !== 14) return null;
  for (const kind of YAOCHUU_KINDS) if (counts[kind] === 0) return null;
  if (YAOCHUU_KINDS.reduce((sum, kind) => sum + counts[kind], 0) !== 14) return null;
  const yakuman = ["kokushi"];
  if (ctx.tenhou) yakuman.push("tenhou");
  if (ctx.chiihou) yakuman.push("chiihou");
  return { form: "orphans", wait: "tanki", yaku: yakuman.map((key) => ({ key, han: 13 })), yakuman: yakuman.length, yakuHan: 0, fu: 0, fuParts: [], menzen: true };
}

/** Nine gates: 1112345678999 of one suit plus any one more of it, all concealed. */
function isNineGates(counts) {
  for (let suit = 0; suit < 3; suit += 1) {
    const offset = suit * 9;
    let total = 0;
    let ok = counts[offset] >= 3 && counts[offset + 8] >= 3;
    for (let n = 0; n < 9; n += 1) {
      total += counts[offset + n];
      if (counts[offset + n] === 0) ok = false;
    }
    if (ok && total === 14) return true;
  }
  return false;
}

/**
 * Reads a hand that has just taken its winning tile.
 *
 *   concealed  kinds in hand, the winning tile included
 *   melds      [{ type: "chi" | "pon" | "minkan" | "kakan" | "ankan", kind }] (kind: lowest tile)
 *   winKind, tsumo, seatWind, roundWind (27..30)
 *   riichi (0, 1, 2 for double), ippatsu, rinshan, chankan, haitei, houtei, tenhou, chiihou
 *   dora, ura  dora kinds (not indicators), with repeats; redFives: how many red fives the hand holds
 *
 * Returns null when the tiles aren't a winning shape. Otherwise { complete: true, yaku, yakuman, han,
 * yakuHan, fu, fuParts, dora: { dora, ura, red }, base, limit, wait, form, noYaku }. With noYaku the
 * shape is complete but nothing scores, so it can't be declared (han and base are 0).
 */
function evaluate(input) {
  const melds = input.melds ?? [];
  const counts = countKinds(input.concealed);
  const total = input.concealed.length + melds.length * 3;
  if (total !== 14) return null;
  const ctx = { ...input, melds, chuuren: !melds.length && isNineGates(counts) };

  const readings = [];
  for (const { pair, sets } of decompose(counts)) {
    if (sets.length + melds.length !== 4) continue;
    const spots = [];
    if (pair === input.winKind) spots.push({});
    const seen = new Set();
    sets.forEach((set, index) => {
      const holds = set.seq ? input.winKind >= set.kind && input.winKind <= set.kind + 2 : input.winKind === set.kind;
      if (!holds) return;
      const key = `${set.seq}:${set.kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      spots.push({ set: index });
    });
    for (const spot of spots) readings.push(readStandard(ctx, pair, sets, spot));
  }
  if (!melds.length) {
    const pairs = readSevenPairs(ctx, counts);
    if (pairs) readings.push(pairs);
    const orphans = readOrphans(ctx, counts);
    if (orphans) readings.push(orphans);
  }
  if (!readings.length) return null;

  const allKinds = [...input.concealed];
  for (const meld of melds) {
    if (meld.type === "chi") allKinds.push(meld.kind, meld.kind + 1, meld.kind + 2);
    else for (let i = 0; i < (MELD_SHAPE[meld.type].kan ? 4 : 3); i += 1) allKinds.push(meld.kind);
  }
  const all = countKinds(allKinds);
  const doraCount = (list) => (list ?? []).reduce((sum, kind) => sum + all[kind], 0);
  const dora = { dora: doraCount(input.dora), ura: ctx.riichi ? doraCount(input.ura) : 0, red: input.redFives ?? 0 };

  let best = null;
  for (const reading of readings) {
    let scored;
    if (reading.yakuman) {
      scored = { ...reading, han: 13 * reading.yakuman, dora: { dora: 0, ura: 0, red: 0 }, ...basePoints(0, 0, reading.yakuman), noYaku: false };
    } else if (!reading.yakuHan) {
      scored = { ...reading, han: 0, dora, base: 0, limit: null, noYaku: true };
    } else {
      const han = reading.yakuHan + dora.dora + dora.ura + dora.red;
      scored = { ...reading, han, dora, ...basePoints(han, reading.fu), noYaku: false };
    }
    if (!best || scored.base > best.base || (scored.base === best.base && (scored.han > best.han || (scored.han === best.han && scored.fu > best.fu)))) best = scored;
  }
  return { complete: true, ...best };
}

module.exports = { basePoints, ceil100, decompose, evaluate, isNineGates, payments };
