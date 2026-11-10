// What a hand looks like to each viewer (docs/games/MAHJONG_DESIGN.md §2, "What each viewer gets").
//
// publicHand() is the table anyone may see: ponds, melds, dora indicators, scores, tile counts. It
// never contains a concealed tile unless the rules have shown it (a win, tenpai at a draw).
// seatHand() adds one seat's own tiles, what that seat may do now, and the beginner help. Bots are
// given seatHand() too, so they play from what a player in that seat can see.

const round = require("./round");
const { evaluate } = require("./agari");
const { improvements, shanten } = require("./shanten");
const { KINDS, countKinds, doraFromIndicator, isRedFive, kindOf, sortTiles } = require("./tiles");

/** The last thing that happened, as everyone saw it (a draw's tile is left out). */
function lastEvent(state) {
  for (let i = state.log.length - 1; i >= 0; i -= 1) {
    const event = state.log[i];
    if (event.t === "deal" || event.t === "end") return { t: event.t };
    if (event.t === "draw") return { t: "draw", s: event.s, rinshan: Boolean(event.rinshan) };
    return { ...event };
  }
  return null;
}

function publicHand(state) {
  return {
    dealer: state.dealer,
    round_wind: state.roundWind,
    honba: state.honba,
    sticks: state.sticks,
    scores: [...state.scores],
    turn: state.phase === "over" ? null : state.turn,
    phase: state.phase,
    remaining: round.remaining(state),
    seq: state.seq,
    dora: round.doraIndicators(state),
    seats: [0, 1, 2, 3].map((seat) => ({
      count: state.hands[seat].length,
      has_drawn: state.phase === "turn" && state.turn === seat && state.drawn !== null,
      melds: state.melds[seat].map((meld) => ({ type: meld.type, tiles: [...meld.tiles], called: meld.called ?? null, from: meld.from ?? null, added: meld.added ?? null })),
      pond: state.ponds[seat].map((entry) => ({ ...entry })),
      riichi: state.riichi[seat],
      wind: round.seatWind(state, seat),
    })),
    last: lastEvent(state),
    last_discard: state.lastDiscard,
    result: state.result,
  };
}

/** How many copies of each kind this seat can see: its hand, every meld and pond, the indicators. */
function seenCounts(state, seat) {
  const seen = countKinds(state.hands[seat].map(kindOf));
  for (let other = 0; other < 4; other += 1) {
    for (const meld of state.melds[other]) for (const tile of meld.tiles) seen[kindOf(tile)] += 1;
    for (const entry of state.ponds[other]) if (!entry.called) seen[kindOf(entry.tile)] += 1;
  }
  for (const tile of round.doraIndicators(state)) seen[kindOf(tile)] += 1;
  return seen;
}

/** The win a seat would have on `kind`, taken from a discard or drawn: what it scores, or that it has no yaku. */
function winPreview(state, seat, hand, kind, tsumo) {
  const melds = state.melds[seat].map((meld) => ({ type: meld.type, kind: round.meldKind(meld) }));
  let reds = hand.filter(isRedFive).length;
  for (const meld of state.melds[seat]) reds += meld.tiles.filter(isRedFive).length;
  const win = evaluate({
    concealed: [...hand.map(kindOf), kind],
    melds,
    winKind: kind,
    tsumo,
    seatWind: round.seatWind(state, seat),
    roundWind: state.roundWind,
    riichi: state.riichi[seat],
    ippatsu: false,
    dora: round.doraIndicators(state).map((id) => doraFromIndicator(kindOf(id))),
    ura: [],
    redFives: reds,
  });
  if (!win) return null;
  return { ok: !win.noYaku, han: win.han, fu: win.fu, yaku: win.yaku.map((entry) => entry.key), limit: win.limit };
}

function describeWaits(state, seat, hand, seen) {
  return round.waits(state, seat, hand).map((kind) => ({
    kind,
    left: Math.max(0, 4 - seen[kind]),
    ron: winPreview(state, seat, hand, kind, false),
    tsumo: winPreview(state, seat, hand, kind, true),
  }));
}

/**
 * Help every player gets: what the hand waits on and how many are left, whether a win on each has a
 * yaku, furiten and why, and why a tile that completes the hand can't be won on.
 */
function basicHelp(state, seat, options) {
  const help = { waits: [], furiten: null, tenpai_discards: {}, no_win: null };
  if (state.phase === "over") return help;
  const seen = seenCounts(state, seat);
  const resting = round.restingHand(state, seat);
  if (resting.length % 3 === 1) {
    help.waits = describeWaits(state, seat, resting, seen);
    if (help.waits.length) help.furiten = round.furitenOf(state, seat);
  }
  if (options?.phase === "turn") {
    // Which discards leave the hand tenpai, and on what.
    const tried = new Set();
    for (const tile of options.discards) {
      const kind = kindOf(tile);
      if (tried.has(kind)) continue;
      tried.add(kind);
      const index = state.hands[seat].indexOf(tile);
      const rest = state.hands[seat].filter((_, at) => at !== index);
      const waiting = describeWaits(state, seat, rest, seen);
      if (waiting.length) help.tenpai_discards[kind] = waiting;
    }
    if (state.drawn !== null && !options.tsumo && shanten(countKinds(state.hands[seat].map(kindOf)), state.melds[seat].length) === -1) {
      help.no_win = { tile: state.drawn, reason: "no_yaku" };
    }
  }
  if (state.phase === "calls" && state.pending.hits.includes(seat) && !state.pending.options[seat]?.ron) {
    const furiten = round.furitenOf(state, seat);
    help.no_win = { tile: state.pending.tile, reason: furiten ? `furiten_${furiten}` : "no_yaku" };
  }
  return help;
}

/**
 * Coaching for tables that allow it (practice, the tutorial, friend rooms): for each tile you could
 * discard, how far from tenpai it leaves you and how many tiles would then improve the hand.
 */
function coachHelp(state, seat, options) {
  if (options?.phase !== "turn") return null;
  const seen = seenCounts(state, seat);
  const counts = countKinds(state.hands[seat].map(kindOf));
  const melds = state.melds[seat].length;
  const discards = [];
  const tried = new Set();
  for (const tile of options.discards) {
    const kind = kindOf(tile);
    if (tried.has(kind)) continue;
    tried.add(kind);
    counts[kind] -= 1;
    const result = improvements(counts, melds, seen);
    counts[kind] += 1;
    discards.push({ kind, shanten: result.shanten, useful: result.left, kinds: result.kinds });
  }
  if (!discards.length) return null;
  const bestShanten = Math.min(...discards.map((entry) => entry.shanten));
  const bestUseful = Math.max(...discards.filter((entry) => entry.shanten === bestShanten).map((entry) => entry.useful));
  return {
    shanten: bestShanten,
    discards,
    best: discards.filter((entry) => entry.shanten === bestShanten && entry.useful === bestUseful).map((entry) => entry.kind),
  };
}

/** One seat's view: the public table, their own tiles and moves, and help. */
function seatHand(state, seat, { coach = false } = {}) {
  const options = round.optionsFor(state, seat);
  const view = publicHand(state);
  view.seat = seat;
  view.hand = sortTiles(state.hands[seat].filter((tile) => !(state.turn === seat && state.phase === "turn" && tile === state.drawn)));
  view.drawn = state.turn === seat && state.phase === "turn" ? state.drawn : null;
  view.options = options;
  view.help = basicHelp(state, seat, options);
  if (coach) view.help.coach = coachHelp(state, seat, options);
  if (view.last?.t === "draw" && view.last.s === seat) view.last.tile = state.drawn;
  return view;
}

/** Everything, for the replay once a game is over and for tests: all four hands face up. */
function openHand(state) {
  const view = publicHand(state);
  view.hands = state.hands.map((hand) => sortTiles(hand));
  return view;
}

module.exports = { KINDS, basicHelp, coachHelp, openHand, publicHand, seatHand, seenCounts };
