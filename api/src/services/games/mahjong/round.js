// One hand of riichi mahjong, from the deal to a win or a draw (docs/games/MAHJONG_DESIGN.md §1).
//
// The state is a plain object that act() changes in place: the wall, four hands, melds and ponds,
// whose turn it is and what everyone may do next. Nothing here knows about sockets, clocks or
// money. The table manager calls act() with what a seat wants to do; anything that isn't a legal
// move right now throws `illegal_action`. Every change is appended to `state.log`, which is the
// replay.
//
// Phases:
//   "turn"   state.turn holds 14 tiles (or has just called) and must discard, win or kan.
//   "calls"  a discard (or an added kan) is on the table and the seats in state.pending.options may
//            answer: ron, pon, kan, chi or pass. It resolves as soon as the answers in can't be beaten.
//   "over"   state.result says how it ended.

const { decompose, evaluate, payments } = require("./agari");
const { shanten, waitsOf } = require("./shanten");
const { DORA_START, LIVE_END, RINSHAN_START, URA_START } = require("./wall");
const { countKinds, doraFromIndicator, isDragon, isRedFive, isSuited, isWind, isYaochuu, kindOf, sortTiles } = require("./tiles");

const SEATS = 4;
const DEAL = 13;
const RIICHI_STICK = 1000;
const NOTEN_POOL = 3000;

function mjError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}
const illegal = (why) => mjError("illegal_action", { why });

// ── Reading the state ──────────────────────────────────────────────────────
const remaining = (state) => state.liveEnd - state.livePos;
const seatWind = (state, seat) => 27 + ((seat - state.dealer + SEATS) % SEATS);
const doraIndicators = (state) => state.wall.slice(DORA_START, DORA_START + state.doraShown);
const uraIndicators = (state) => state.wall.slice(URA_START, URA_START + state.doraShown);
const isClosed = (state, seat) => state.melds[seat].every((meld) => meld.type === "ankan");
const meldKind = (meld) => Math.min(...meld.tiles.map(kindOf));
const handKinds = (state, seat) => state.hands[seat].map(kindOf);

/** How many of each kind the seat holds, melds included. */
function heldCounts(state, seat) {
  const counts = countKinds(handKinds(state, seat));
  for (const meld of state.melds[seat]) for (const tile of meld.tiles) counts[kindOf(tile)] += 1;
  return counts;
}

/** The kinds a hand one tile short is waiting on (a kind the seat already holds all four of isn't a wait). */
function waits(state, seat, hand = state.hands[seat]) {
  if (hand.length % 3 !== 1) return [];
  const counts = countKinds(hand.map(kindOf));
  const found = waitsOf(counts, state.melds[seat].length);
  if (!found.length) return found;
  for (const meld of state.melds[seat]) for (const tile of meld.tiles) counts[kindOf(tile)] += 1;
  return found.filter((kind) => counts[kind] < 4);
}

/** The hand without the tile it just drew (the 13 it waits with). */
const restingHand = (state, seat) => (state.turn === seat && state.phase === "turn" && state.drawn !== null ? state.hands[seat].filter((tile) => tile !== state.drawn) : state.hands[seat]);

function discardFuriten(state, seat, waiting) {
  if (!waiting.length) return false;
  const thrown = new Set(state.ponds[seat].map((entry) => kindOf(entry.tile)));
  return waiting.some((kind) => thrown.has(kind));
}

/** Why a seat can't win on a discard right now: "discard", "passed", "riichi", or null. */
function furitenOf(state, seat) {
  if (state.riichiFuriten[seat]) return "riichi";
  if (state.tempFuriten[seat]) return "passed";
  return discardFuriten(state, seat, waits(state, seat, restingHand(state, seat))) ? "discard" : null;
}

/** evaluate() for this seat taking `tile` (already in hand on a self-draw). */
function readWin(state, seat, tile, { tsumo, chankan = false }) {
  const concealed = handKinds(state, seat);
  if (!tsumo) concealed.push(kindOf(tile));
  // Most tiles complete nothing: the shanten lookup says so far faster than reading the hand does.
  if (shanten(countKinds(concealed), state.melds[seat].length) !== -1) return null;
  const melds = state.melds[seat].map((meld) => ({ type: meld.type, kind: meldKind(meld) }));
  const left = remaining(state);
  const first = state.discards[seat] === 0 && !state.called;
  let reds = tsumo ? 0 : isRedFive(tile) ? 1 : 0;
  for (const held of state.hands[seat]) if (isRedFive(held)) reds += 1;
  for (const meld of state.melds[seat]) for (const held of meld.tiles) if (isRedFive(held)) reds += 1;
  return evaluate({
    concealed,
    melds,
    winKind: kindOf(tile),
    tsumo,
    seatWind: seatWind(state, seat),
    roundWind: state.roundWind,
    riichi: state.riichiDeclared === seat ? 0 : state.riichi[seat],
    ippatsu: state.ippatsu[seat],
    rinshan: tsumo && state.afterKan,
    chankan,
    haitei: tsumo && left === 0 && !state.afterKan,
    houtei: !tsumo && !chankan && left === 0,
    tenhou: tsumo && first && seat === state.dealer && !state.afterKan,
    chiihou: tsumo && first && seat !== state.dealer && !state.afterKan,
    dora: doraIndicators(state).map((id) => doraFromIndicator(kindOf(id))),
    ura: uraIndicators(state).map((id) => doraFromIndicator(kindOf(id))),
    redFives: reds,
  });
}

// ── Setting up ─────────────────────────────────────────────────────────────
/**
 * Deals a hand from a wall (wall.js buildWall) and gives the dealer their first draw.
 * `roundWind` is the wind's tile kind (27 East, 28 South, 29 West).
 */
function createHand({ wall, dealer, roundWind, honba = 0, sticks = 0, scores }) {
  if (!Array.isArray(wall) || wall.length !== 136 || new Set(wall).size !== 136) throw mjError("bad_wall");
  const state = {
    wall,
    dealer,
    roundWind,
    honba,
    sticks,
    scores: [...scores],
    startScores: [...scores],
    hands: [[], [], [], []],
    melds: [[], [], [], []],
    ponds: [[], [], [], []],
    drawn: null,
    livePos: 0,
    liveEnd: LIVE_END,
    rinshanUsed: 0,
    doraShown: 1,
    pendingDora: 0,
    kans: 0,
    kanSeats: [0, 0, 0, 0],
    riichi: [0, 0, 0, 0],
    riichiDeclared: null,
    ippatsu: [false, false, false, false],
    tempFuriten: [false, false, false, false],
    riichiFuriten: [false, false, false, false],
    discards: [0, 0, 0, 0],
    // Every discard is numbered in the order it was made, so anyone can tell what came after a riichi.
    discardNo: 0,
    called: false,
    afterKan: false,
    kuikae: [],
    pao: [null, null, null, null],
    turn: dealer,
    phase: "turn",
    pending: null,
    lastDiscard: null,
    seq: 0,
    log: [],
    result: null,
  };
  for (let i = 0; i < DEAL * SEATS; i += 1) state.hands[(dealer + i) % SEATS].push(wall[state.livePos++]);
  for (let seat = 0; seat < SEATS; seat += 1) state.hands[seat] = sortTiles(state.hands[seat]);
  record(state, { t: "deal", dealer, hands: state.hands.map((hand) => [...hand]), dora: state.wall[DORA_START] });
  draw(state, dealer);
  return state;
}

function record(state, event) {
  state.seq += 1;
  state.log.push(event);
}

function draw(state, seat) {
  const tile = state.wall[state.livePos++];
  state.hands[seat].push(tile);
  state.drawn = tile;
  state.turn = seat;
  state.afterKan = false;
  state.kuikae = [];
  state.phase = "turn";
  record(state, { t: "draw", s: seat, tile });
}

function drawReplacement(state, seat) {
  const tile = state.wall[RINSHAN_START + state.rinshanUsed];
  state.rinshanUsed += 1;
  state.liveEnd -= 1;
  state.hands[seat].push(tile);
  state.drawn = tile;
  state.turn = seat;
  state.afterKan = true;
  state.kuikae = [];
  state.phase = "turn";
  record(state, { t: "draw", s: seat, tile, rinshan: true });
}

function flipPendingDora(state) {
  while (state.pendingDora > 0) {
    state.pendingDora -= 1;
    state.doraShown += 1;
    record(state, { t: "dora", tile: state.wall[DORA_START + state.doraShown - 1] });
  }
}

// ── What the turn player may do ────────────────────────────────────────────
/** A closed kan in riichi must leave the waits, and the way the hand reads, exactly as they were. */
function riichiKanAllowed(state, seat, kind) {
  if (state.drawn === null || kindOf(state.drawn) !== kind) return false;
  const before = state.hands[seat].filter((tile) => tile !== state.drawn).map(kindOf);
  const counts = countKinds(before);
  if (counts[kind] !== 3) return false;
  const melds = state.melds[seat].length;
  const waitsBefore = waitsOf(counts, melds);
  const after = countKinds(before);
  after[kind] = 0;
  const waitsAfter = waitsOf(after, melds + 1);
  if (!waitsBefore.length || waitsBefore.length !== waitsAfter.length || waitsBefore.some((wait, index) => wait !== waitsAfter[index])) return false;
  // In every reading of every winning hand, the three must already be a triplet.
  for (const wait of waitsBefore) {
    counts[wait] += 1;
    const readings = decompose(counts);
    counts[wait] -= 1;
    if (!readings.length) return false; // seven pairs or thirteen orphans can't hold three of a kind
    if (readings.some((reading) => !reading.sets.some((set) => !set.seq && set.kind === kind))) return false;
  }
  return true;
}

// turnOptions() is asked for several times between moves (the check, the view, the bot): worked out
// once per position.
const turnCache = new WeakMap();

function turnOptions(state) {
  const cached = turnCache.get(state);
  if (cached && cached.seq === state.seq) return cached.options;
  const options = readTurnOptions(state);
  turnCache.set(state, { seq: state.seq, options });
  return options;
}

function readTurnOptions(state) {
  const seat = state.turn;
  const hand = state.hands[seat];
  const inRiichi = state.riichi[seat] > 0;
  const hasDrawn = state.drawn !== null;
  const left = remaining(state);
  const options = { discards: [], riichi: [], tsumo: false, ankan: [], kakan: [], kyuushu: false };

  options.discards = inRiichi ? [state.drawn] : hand.filter((tile) => !state.kuikae.includes(kindOf(tile)));

  if (hasDrawn) {
    const win = readWin(state, seat, state.drawn, { tsumo: true });
    options.tsumo = Boolean(win && !win.noYaku);
  }

  if (hasDrawn && !inRiichi && isClosed(state, seat) && state.scores[seat] >= RIICHI_STICK && left >= 4) {
    const counts = countKinds(hand.map(kindOf));
    const melds = state.melds[seat].length;
    const held = heldCounts(state, seat);
    const tenpaiAfter = new Map();
    for (const tile of hand) {
      const kind = kindOf(tile);
      if (!tenpaiAfter.has(kind)) {
        counts[kind] -= 1;
        held[kind] -= 1;
        tenpaiAfter.set(kind, waitsOf(counts, melds).some((wait) => held[wait] < 4));
        counts[kind] += 1;
        held[kind] += 1;
      }
      if (tenpaiAfter.get(kind)) options.riichi.push(tile);
    }
  }

  if (hasDrawn && state.kans < 4 && left > 0) {
    const counts = countKinds(hand.map(kindOf));
    for (let kind = 0; kind < counts.length; kind += 1) {
      if (counts[kind] === 4 && (!inRiichi || riichiKanAllowed(state, seat, kind))) options.ankan.push(kind);
    }
    if (!inRiichi) {
      for (const meld of state.melds[seat]) {
        if (meld.type === "pon" && counts[meldKind(meld)] > 0) options.kakan.push(meldKind(meld));
      }
    }
  }

  if (hasDrawn && state.discards[seat] === 0 && !state.called && !state.afterKan) {
    const kinds = new Set(hand.map(kindOf).filter(isYaochuu));
    options.kyuushu = kinds.size >= 9;
  }
  return options;
}

// ── What the others may do with a discard ──────────────────────────────────
/** Pairs of tiles from `hand` that could take `kind` as a pon: one per way that differs by red fives. */
function ponPairs(hand, kind) {
  const same = hand.filter((tile) => kindOf(tile) === kind);
  if (same.length < 2) return [];
  const reds = same.filter(isRedFive);
  const plain = same.filter((tile) => !isRedFive(tile));
  const pairs = [];
  if (plain.length >= 2) pairs.push([plain[0], plain[1]]);
  if (reds.length && plain.length >= 1) pairs.push([reds[0], plain[0]]);
  return pairs;
}

/** The kinds a seat can't discard right after a chi of `called` with `a` and `b`. */
function chiKuikae(called, a, b) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const banned = [called];
  if (called < low && low % 9 <= 6 && high === low + 1 && high % 9 !== 8) banned.push(high + 1);
  if (called > high && high % 9 >= 2 && high === low + 1 && low % 9 !== 0) banned.push(low - 1);
  return banned;
}

/** Pairs of tiles from `hand` that make a run with `kind`, one per way that differs by red fives. */
function chiPairs(hand, kind) {
  if (!isSuited(kind)) return [];
  const n = kind % 9;
  const shapes = [];
  if (n >= 2) shapes.push([kind - 2, kind - 1]);
  if (n >= 1 && n <= 7) shapes.push([kind - 1, kind + 1]);
  if (n <= 6) shapes.push([kind + 1, kind + 2]);
  const pairs = [];
  const pick = (wanted) => {
    const same = hand.filter((tile) => kindOf(tile) === wanted);
    const red = same.find(isRedFive);
    const plain = same.find((tile) => !isRedFive(tile));
    return [plain, red].filter((tile) => tile !== undefined);
  };
  for (const [a, b] of shapes) {
    for (const first of pick(a)) {
      for (const second of pick(b)) {
        const banned = chiKuikae(kind, a, b);
        const rest = hand.filter((tile) => tile !== first && tile !== second);
        if (rest.some((tile) => !banned.includes(kindOf(tile)))) pairs.push([first, second]);
      }
    }
  }
  return pairs;
}

/** Four kans held by more than one player: the hand is drawn once the next discard goes by. */
const fourKansAbort = (state) => state.kans === 4 && Math.max(...state.kanSeats) < 4;

function callOptions(state, tile, from, { chankan = false } = {}) {
  const kind = kindOf(tile);
  const options = {};
  const hits = [];
  const onlyRon = chankan || remaining(state) === 0 || fourKansAbort(state);
  for (let step = 1; step < SEATS; step += 1) {
    const seat = (from + step) % SEATS;
    const mine = {};
    const win = readWin(state, seat, tile, { tsumo: false, chankan });
    if (win) {
      hits.push(seat);
      if (!win.noYaku && !furitenOf(state, seat)) mine.ron = true;
    }
    if (!onlyRon && !state.riichi[seat]) {
      const hand = state.hands[seat];
      const pon = ponPairs(hand, kind);
      if (pon.length) mine.pon = pon;
      if (state.kans < 4 && hand.filter((held) => kindOf(held) === kind).length === 3) mine.kan = true;
      if (step === 1) {
        const chi = chiPairs(hand, kind);
        if (chi.length) mine.chi = chi;
      }
    }
    if (Object.keys(mine).length) options[seat] = mine;
  }
  return { options, hits };
}

// ── Ending a hand ──────────────────────────────────────────────────────────
function finish(state, result) {
  state.phase = "over";
  state.pending = null;
  state.result = { ...result, scores: [...state.scores] };
  record(state, { t: "end", result: state.result });
}

function winRecord(state, seat, tile, from, win) {
  return {
    seat,
    from,
    tile,
    tsumo: from === null,
    hand: sortTiles(state.hands[seat].filter((held) => held !== tile || from !== null)),
    melds: state.melds[seat].map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
    yaku: win.yaku,
    han: win.han,
    fu: win.fu,
    fu_parts: win.fuParts,
    yakuman: win.yakuman,
    limit: win.limit,
    dora: win.dora,
    base: win.base,
    wait: win.wait,
    riichi: state.riichi[seat],
  };
}

/** The seat that has to pay for this win's big three dragons or big four winds, if anyone fed it. */
function liableFor(state, seat, win) {
  const liable = state.pao[seat];
  if (liable === null || !win.yakuman) return null;
  return win.yaku.some((entry) => entry.key === "daisangen" || entry.key === "daisuushii") ? liable : null;
}

function finishTsumo(state, seat) {
  flipPendingDora(state);
  const tile = state.drawn;
  const win = readWin(state, seat, tile, { tsumo: true });
  if (!win || win.noYaku) throw illegal("no_win");
  const deltas = [0, 0, 0, 0];
  const paid = payments({ base: win.base, winner: seat, dealer: state.dealer, tsumo: true });
  const liable = liableFor(state, seat, win);
  if (liable !== null) {
    deltas[liable] -= paid.total + 300 * state.honba;
  } else {
    for (const [payer, amount] of Object.entries(paid.from)) deltas[Number(payer)] -= amount + 100 * state.honba;
  }
  const sticks = state.sticks * RIICHI_STICK;
  deltas[seat] += paid.total + 300 * state.honba + sticks;
  state.sticks = 0;
  for (let i = 0; i < SEATS; i += 1) state.scores[i] += deltas[i];
  const entry = { ...winRecord(state, seat, tile, null, win), gain: paid.total + 300 * state.honba + sticks, sticks, honba: 300 * state.honba, pao: liable };
  finish(state, {
    type: "win",
    wins: [entry],
    ura: state.riichi[seat] ? uraIndicators(state) : [],
    dora: doraIndicators(state),
    deltas,
    renchan: seat === state.dealer,
    honba_next: seat === state.dealer ? state.honba + 1 : 0,
  });
}

function finishRon(state, winners, tile, loser, chankan) {
  const deltas = [0, 0, 0, 0];
  const wins = [];
  // Sticks on the table go to the winner who's next in turn after the one who dealt in.
  const ordered = [...winners].sort((a, b) => ((a - loser + SEATS) % SEATS) - ((b - loser + SEATS) % SEATS));
  let sticks = state.sticks * RIICHI_STICK;
  state.sticks = 0;
  for (const seat of ordered) {
    const win = readWin(state, seat, tile, { tsumo: false, chankan });
    if (!win || win.noYaku) throw illegal("no_win");
    const paid = payments({ base: win.base, winner: seat, dealer: state.dealer, tsumo: false, loser });
    const bonus = 300 * state.honba;
    const liable = liableFor(state, seat, win);
    if (liable !== null && liable !== loser) {
      const half = paid.total / 2;
      deltas[liable] -= half;
      deltas[loser] -= half + bonus;
    } else {
      deltas[loser] -= paid.total + bonus;
    }
    deltas[seat] += paid.total + bonus + sticks;
    wins.push({ ...winRecord(state, seat, tile, loser, win), gain: paid.total + bonus + sticks, sticks, honba: bonus, pao: liable, chankan });
    sticks = 0;
  }
  for (let i = 0; i < SEATS; i += 1) state.scores[i] += deltas[i];
  const dealerWon = winners.includes(state.dealer);
  finish(state, {
    type: "win",
    wins,
    ura: winners.some((seat) => state.riichi[seat] && state.riichiDeclared !== seat) ? uraIndicators(state) : [],
    dora: doraIndicators(state),
    deltas,
    renchan: dealerWon,
    honba_next: dealerWon ? state.honba + 1 : 0,
  });
}

function isTenpai(state, seat) {
  return waits(state, seat).length > 0;
}

function finishExhaustive(state) {
  const tenpai = [0, 1, 2, 3].map((seat) => isTenpai(state, seat));
  const deltas = [0, 0, 0, 0];
  const nagashi = [0, 1, 2, 3].filter((seat) => state.ponds[seat].length > 0 && state.ponds[seat].every((entry) => !entry.called && isYaochuu(kindOf(entry.tile))));
  if (nagashi.length) {
    for (const seat of nagashi) {
      const paid = payments({ base: 2000, winner: seat, dealer: state.dealer, tsumo: true });
      for (const [payer, amount] of Object.entries(paid.from)) deltas[Number(payer)] -= amount;
      deltas[seat] += paid.total;
    }
  } else {
    const count = tenpai.filter(Boolean).length;
    if (count > 0 && count < SEATS) {
      for (let seat = 0; seat < SEATS; seat += 1) deltas[seat] += tenpai[seat] ? NOTEN_POOL / count : -NOTEN_POOL / (SEATS - count);
    }
  }
  for (let i = 0; i < SEATS; i += 1) state.scores[i] += deltas[i];
  const shown = {};
  for (let seat = 0; seat < SEATS; seat += 1) if (tenpai[seat]) shown[seat] = sortTiles(state.hands[seat]);
  finish(state, {
    type: "draw",
    reason: nagashi.length ? "nagashi" : "exhaustive",
    tenpai,
    nagashi,
    hands: shown,
    waits: Object.fromEntries(Object.keys(shown).map((seat) => [seat, waits(state, Number(seat))])),
    deltas,
    renchan: tenpai[state.dealer],
    honba_next: state.honba + 1,
  });
}

function finishAbort(state, reason, extra = {}) {
  finish(state, { type: "draw", reason, tenpai: [false, false, false, false], nagashi: [], hands: {}, waits: {}, deltas: [0, 0, 0, 0], renchan: true, honba_next: state.honba + 1, ...extra });
}

// ── Discards and the calls on them ─────────────────────────────────────────
function removeTile(state, seat, tile) {
  const index = state.hands[seat].indexOf(tile);
  if (index < 0) throw illegal("tile_not_in_hand");
  state.hands[seat].splice(index, 1);
}

function doDiscard(state, seat, tile, riichi) {
  const options = turnOptions(state);
  if (!options.discards.includes(tile)) throw illegal("cannot_discard");
  if (riichi && !options.riichi.includes(tile)) throw illegal("cannot_riichi");
  const tsumogiri = tile === state.drawn;
  removeTile(state, seat, tile);
  state.hands[seat] = sortTiles(state.hands[seat]);
  if (riichi) {
    state.riichi[seat] = state.discards[seat] === 0 && !state.called ? 2 : 1;
    state.riichiDeclared = seat;
  }
  state.discardNo += 1;
  state.ponds[seat].push({ tile, tsumogiri, riichi: Boolean(riichi), called: false, n: state.discardNo });
  state.discards[seat] += 1;
  state.ippatsu[seat] = false;
  state.tempFuriten[seat] = false;
  state.drawn = null;
  state.kuikae = [];
  state.afterKan = false;
  state.lastDiscard = { seat, tile };
  record(state, { t: "discard", s: seat, tile, tsumogiri, riichi: Boolean(riichi) });
  // An open or added kan's indicator turns once the discard is down.
  flipPendingDora(state);

  const { options: calls, hits } = callOptions(state, tile, seat);
  if (Object.keys(calls).length) {
    state.phase = "calls";
    state.pending = { kind: "discard", tile, from: seat, options: calls, hits, replies: {} };
  } else {
    state.pending = { kind: "discard", tile, from: seat, options: {}, hits, replies: {} };
    resolve(state);
  }
}

/** A tile that would have completed a hand went by without a win: that hand is furiten for a while. */
function markPassed(state, hits, winners = []) {
  for (const seat of hits) {
    if (winners.includes(seat)) continue;
    if (state.riichi[seat] && state.riichiDeclared !== seat) state.riichiFuriten[seat] = true;
    else state.tempFuriten[seat] = true;
  }
}

function establishRiichi(state) {
  const seat = state.riichiDeclared;
  if (seat === null) return;
  state.riichiDeclared = null;
  state.scores[seat] -= RIICHI_STICK;
  state.sticks += 1;
  state.ippatsu[seat] = true;
  record(state, { t: "riichi", s: seat, double: state.riichi[seat] === 2 });
}

const REPLY_RANK = { pass: 0, chi: 1, pon: 2, kan: 2, ron: 3 };

/** Settles the calls on the tile in state.pending if the answers so far can't be beaten. True if it did. */
function resolve(state) {
  const pending = state.pending;
  const waiting = Object.keys(pending.options).map(Number).filter((seat) => !pending.replies[seat]);
  const best = Object.values(pending.replies).reduce((top, reply) => Math.max(top, REPLY_RANK[reply.type]), 0);
  for (const seat of waiting) {
    const mine = pending.options[seat];
    const reach = mine.ron ? 3 : mine.pon || mine.kan ? 2 : mine.chi ? 1 : 0;
    // Someone who could still win is always waited for; a lesser call only if it would outrank what's in.
    if (reach === 3 || reach > best) return false;
  }

  const { tile, from, hits } = pending;
  const winners = Object.entries(pending.replies).filter(([, reply]) => reply.type === "ron").map(([seat]) => Number(seat));
  state.pending = null;
  if (winners.length) {
    markPassed(state, hits, winners);
    finishRon(state, winners, tile, from, pending.kind === "kakan");
    return true;
  }
  markPassed(state, hits);

  if (pending.kind === "kakan") {
    completeKan(state, from, "kakan");
    return true;
  }

  establishRiichi(state);
  const call = Object.entries(pending.replies).find(([, reply]) => REPLY_RANK[reply.type] === best && best > 0);
  if (call) {
    applyCall(state, Number(call[0]), call[1], tile, from);
    return true;
  }

  // Nobody took it. Abortive draws first, then the wall.
  if (!state.called && state.discards.every((count) => count === 1)) {
    const first = state.ponds.map((pond) => kindOf(pond[0].tile));
    if (isWind(first[0]) && first.every((kind) => kind === first[0])) return finishAbort(state, "suufon"), true;
  }
  if (state.riichi.every((value) => value > 0)) return finishAbort(state, "suucha"), true;
  if (fourKansAbort(state)) return finishAbort(state, "suukan"), true;
  if (remaining(state) === 0) return finishExhaustive(state), true;
  draw(state, (from + 1) % SEATS);
  return true;
}

function notePao(state, seat, from) {
  const kinds = state.melds[seat].map(meldKind);
  if (isDragon(kinds[kinds.length - 1]) && kinds.filter(isDragon).length === 3) state.pao[seat] = from;
  if (isWind(kinds[kinds.length - 1]) && kinds.filter(isWind).length === 4) state.pao[seat] = from;
}

function applyCall(state, seat, reply, tile, from) {
  const pond = state.ponds[from];
  pond[pond.length - 1].called = true;
  state.called = true;
  state.ippatsu = [false, false, false, false];
  const kind = kindOf(tile);
  if (reply.type === "kan") {
    const mine = state.hands[seat].filter((held) => kindOf(held) === kind);
    for (const held of mine) removeTile(state, seat, held);
    state.melds[seat].push({ type: "minkan", tiles: sortTiles([...mine, tile]), called: tile, from });
    record(state, { t: "minkan", s: seat, from, tile, tiles: mine });
    notePao(state, seat, from);
    completeKan(state, seat, "minkan");
    return;
  }
  for (const held of reply.tiles) removeTile(state, seat, held);
  state.melds[seat].push({ type: reply.type, tiles: sortTiles([...reply.tiles, tile]), called: tile, from });
  record(state, { t: reply.type, s: seat, from, tile, tiles: [...reply.tiles] });
  if (reply.type === "pon") notePao(state, seat, from);
  state.turn = seat;
  state.drawn = null;
  state.afterKan = false;
  state.kuikae = reply.type === "pon" ? [kind] : chiKuikae(kind, kindOf(reply.tiles[0]), kindOf(reply.tiles[1]));
  state.phase = "turn";
}

/** The part of every kan after the tiles are down: count it, turn or queue the indicator, draw. */
function completeKan(state, seat, type) {
  state.kans += 1;
  state.kanSeats[seat] += 1;
  state.called = true;
  state.ippatsu = [false, false, false, false];
  if (type === "ankan") {
    state.doraShown += 1;
    record(state, { t: "dora", tile: state.wall[DORA_START + state.doraShown - 1] });
  } else {
    state.pendingDora += 1;
  }
  drawReplacement(state, seat);
}

function doAnkan(state, seat, kind) {
  if (!turnOptions(state).ankan.includes(kind)) throw illegal("cannot_kan");
  flipPendingDora(state);
  const tiles = state.hands[seat].filter((held) => kindOf(held) === kind);
  for (const held of tiles) removeTile(state, seat, held);
  state.melds[seat].push({ type: "ankan", tiles: sortTiles(tiles) });
  record(state, { t: "ankan", s: seat, tiles: sortTiles(tiles) });
  completeKan(state, seat, "ankan");
}

function doKakan(state, seat, kind) {
  if (!turnOptions(state).kakan.includes(kind)) throw illegal("cannot_kan");
  flipPendingDora(state);
  const tile = state.hands[seat].find((held) => kindOf(held) === kind);
  removeTile(state, seat, tile);
  const meld = state.melds[seat].find((entry) => entry.type === "pon" && meldKind(entry) === kind);
  meld.type = "kakan";
  meld.added = tile;
  meld.tiles = sortTiles([...meld.tiles, tile]);
  state.drawn = null;
  record(state, { t: "kakan", s: seat, tile });
  // An added kan can be robbed: the others get the chance before the replacement tile is drawn.
  const { options, hits } = callOptions(state, tile, seat, { chankan: true });
  state.pending = { kind: "kakan", tile, from: seat, options, hits, replies: {} };
  if (Object.keys(options).length) state.phase = "calls";
  else resolve(state);
}

function doReply(state, seat, action) {
  const pending = state.pending;
  const mine = pending?.options[seat];
  if (!mine || pending.replies[seat]) throw illegal("nothing_to_answer");
  const sameTiles = (wanted, offered) => Array.isArray(offered) && offered.length === 2 && wanted.some((pair) => (pair[0] === offered[0] && pair[1] === offered[1]) || (pair[0] === offered[1] && pair[1] === offered[0]));
  if (action.type === "pass") pending.replies[seat] = { type: "pass" };
  else if (action.type === "ron" && mine.ron) pending.replies[seat] = { type: "ron" };
  else if (action.type === "kan" && mine.kan) pending.replies[seat] = { type: "kan" };
  else if (action.type === "pon" && mine.pon && sameTiles(mine.pon, action.tiles)) pending.replies[seat] = { type: "pon", tiles: [...action.tiles] };
  else if (action.type === "chi" && mine.chi && sameTiles(mine.chi, action.tiles)) pending.replies[seat] = { type: "chi", tiles: [...action.tiles] };
  else throw illegal("cannot_call");
  resolve(state);
}

/**
 * Applies one move. On your turn: { type: "discard", tile, riichi? }, "tsumo", { type: "ankan", kind },
 * { type: "kakan", kind }, "kyuushu". Answering a discard: "ron", { type: "pon" | "chi", tiles: [a, b] },
 * "kan", "pass". Throws `illegal_action` for anything that isn't allowed right now.
 */
function act(state, seat, action) {
  if (state.phase === "over") throw illegal("hand_over");
  if (!action || typeof action.type !== "string") throw illegal("bad_action");
  if (state.phase === "calls") return doReply(state, seat, action);
  if (seat !== state.turn) throw illegal("not_your_turn");
  switch (action.type) {
    case "discard":
      return doDiscard(state, seat, action.tile, Boolean(action.riichi));
    case "tsumo":
      if (!turnOptions(state).tsumo) throw illegal("no_win");
      return finishTsumo(state, seat);
    case "ankan":
      return doAnkan(state, seat, action.kind);
    case "kakan":
      return doKakan(state, seat, action.kind);
    case "kyuushu":
      if (!turnOptions(state).kyuushu) throw illegal("cannot_abort");
      return finishAbort(state, "kyuushu", { by: seat, hands: { [seat]: sortTiles(state.hands[seat]) } });
    default:
      throw illegal("bad_action");
  }
}

/** What `seat` may do right now, or null if nothing is asked of them. */
function optionsFor(state, seat) {
  if (state.phase === "turn" && state.turn === seat) return { phase: "turn", ...turnOptions(state) };
  if (state.phase === "calls" && state.pending.options[seat] && !state.pending.replies[seat]) {
    return { phase: "calls", tile: state.pending.tile, from: state.pending.from, ...state.pending.options[seat] };
  }
  return null;
}

/** The seats the hand is waiting on. */
function waitingSeats(state) {
  if (state.phase === "turn") return [state.turn];
  if (state.phase === "calls") return Object.keys(state.pending.options).map(Number).filter((seat) => !state.pending.replies[seat]);
  return [];
}

module.exports = {
  RIICHI_STICK,
  SEATS,
  act,
  chiKuikae,
  createHand,
  doraIndicators,
  furitenOf,
  heldCounts,
  isClosed,
  isTenpai,
  meldKind,
  mjError,
  optionsFor,
  readWin,
  remaining,
  restingHand,
  seatWind,
  turnOptions,
  uraIndicators,
  waitingSeats,
  waits,
};
