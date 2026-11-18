// Rebuilds a mahjong table position from a hand's log (the replay). Pure functions, no React:
// `applyEvent` takes one log event (api/src/services/games/mahjong/round.js: deal, draw, discard,
// riichi, chi, pon, minkan, ankan, kakan, dora, end) and returns the next position; `stateAt` folds
// the first n events. Every hand is face up (a replay only exists once the game is over).
//
// Steps are what the viewer walks through. A riichi declaration and a dora flip are part of the move
// that causes them, so `replaySteps` folds them into the step before: one click, one move.

import { kindOf, seatWindOf, sortTiles, windName, type TileId, type TileKind } from "@/app/lib/games/mahjong/tiles";
import { limitName, scoreText, DRAW_REASONS } from "@/app/lib/games/mahjong/yaku";
import type { HandResult, LogEvent, Meld, PondEntry, RecordedHand, RiichiState, SeatIndex, WinEntry } from "@/app/lib/games/mahjong/types";

const LIVE_END = 122;
const FIRST_DRAW = 52;
const RIICHI_STICK = 1000;

export type ReplaySeat = {
  seat: SeatIndex;
  /** Seat wind kind 27-30. */
  wind: TileKind;
  /** Concealed tiles, sorted, without the tile just drawn. */
  hand: TileId[];
  /** The tile just drawn and not yet played. */
  drawn: TileId | null;
  melds: Meld[];
  pond: PondEntry[];
  riichi: RiichiState;
};

export type ReplayState = {
  /** How many log events have been applied. */
  applied: number;
  dealer: SeatIndex;
  /** Kind 27 East, 28 South, 29 West. */
  roundWind: TileKind;
  honba: number;
  /** Riichi sticks on the table. */
  sticks: number;
  scores: [number, number, number, number];
  seats: [ReplaySeat, ReplaySeat, ReplaySeat, ReplaySeat];
  /** Dora indicators showing. */
  dora: TileId[];
  /** Tiles left to draw. */
  remaining: number;
  /** Whose move it is (just drew, or just called); null while a discard waits for answers and once the hand is over. */
  turn: SeatIndex | null;
  /** The discard on the table that nobody has answered yet. */
  lastDiscard: { seat: SeatIndex; tile: TileId; n: number } | null;
  /** The event just applied. */
  last: LogEvent | null;
  over: boolean;
  result: HandResult | null;
  /** Discards so far, numbering the pond entries. */
  discardNo: number;
  /** Replacement tiles drawn so far (kans). */
  rinshan: number;
};

export type HandHeader = Pick<RecordedHand, "wind" | "number" | "honba" | "dealer" | "start_scores">;

const emptySeat = (seat: number, dealer: number): ReplaySeat => ({
  seat: seat as SeatIndex,
  wind: seatWindOf(seat, dealer),
  hand: [],
  drawn: null,
  melds: [],
  pond: [],
  riichi: 0,
});

/** The table before anything is dealt. `sticks` is what was already on the table (see handStartSticks). */
export function initialState(header: HandHeader, sticks = 0): ReplayState {
  const dealer = header.dealer as SeatIndex;
  return {
    applied: 0,
    dealer,
    roundWind: 27 + header.wind,
    honba: header.honba,
    sticks,
    scores: [header.start_scores[0], header.start_scores[1], header.start_scores[2], header.start_scores[3]],
    seats: [emptySeat(0, dealer), emptySeat(1, dealer), emptySeat(2, dealer), emptySeat(3, dealer)],
    dora: [],
    remaining: LIVE_END - FIRST_DRAW,
    turn: null,
    lastDiscard: null,
    last: null,
    over: false,
    result: null,
    discardNo: 0,
    rinshan: 0,
  };
}

const without = (tiles: readonly TileId[], remove: readonly TileId[]) => {
  const left = [...tiles];
  for (const tile of remove) {
    const at = left.indexOf(tile);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
};

/** Takes tiles out of a seat's hand, counting the drawn tile as part of it. */
function take(seat: ReplaySeat, tiles: readonly TileId[]): ReplaySeat {
  const all = seat.drawn === null ? seat.hand : [...seat.hand, seat.drawn];
  return { ...seat, hand: sortTiles(without(all, tiles)), drawn: null };
}

const withSeat = (state: ReplayState, seat: number, next: ReplaySeat): ReplayState["seats"] => {
  const seats = [...state.seats] as ReplayState["seats"];
  seats[seat] = next;
  return seats;
};

/** Marks the discard a call took: the last tile in that seat's pond. */
function markCalled(seat: ReplaySeat): ReplaySeat {
  if (!seat.pond.length) return seat;
  const pond = [...seat.pond];
  pond[pond.length - 1] = { ...pond[pond.length - 1], called: true };
  return { ...seat, pond };
}

/** One event on top of a position. Returns a new position; the old one is untouched. */
export function applyEvent(state: ReplayState, event: LogEvent): ReplayState {
  const base: ReplayState = { ...state, applied: state.applied + 1, last: event };
  switch (event.t) {
    case "deal": {
      const seats = state.seats.map((seat, index) => ({ ...seat, hand: sortTiles(event.hands[index] ?? []), drawn: null })) as ReplayState["seats"];
      return { ...base, dealer: event.dealer, seats, dora: [event.dora], remaining: LIVE_END - FIRST_DRAW, turn: null };
    }
    case "draw": {
      const seat = state.seats[event.s];
      const seats = withSeat(base, event.s, { ...seat, drawn: event.tile });
      // Each kan's replacement tile comes off the end of the live wall, so it is one tile fewer to draw too.
      return { ...base, seats, turn: event.s, lastDiscard: null, rinshan: state.rinshan + (event.rinshan ? 1 : 0), remaining: state.remaining - 1 };
    }
    case "discard": {
      const taken = take(state.seats[event.s], [event.tile]);
      // A tile drawn this turn and kept goes into the hand; `take` already folded it in.
      const n = state.discardNo + 1;
      const entry: PondEntry = { tile: event.tile, tsumogiri: event.tsumogiri, riichi: event.riichi, called: false, n };
      const seats = withSeat(base, event.s, { ...taken, pond: [...taken.pond, entry] });
      return { ...base, seats, discardNo: n, turn: null, lastDiscard: { seat: event.s, tile: event.tile, n } };
    }
    case "riichi": {
      const seat = state.seats[event.s];
      const scores = [...state.scores] as ReplayState["scores"];
      scores[event.s] -= RIICHI_STICK;
      return { ...base, seats: withSeat(base, event.s, { ...seat, riichi: event.double ? 2 : 1 }), scores, sticks: state.sticks + 1 };
    }
    case "chi":
    case "pon":
    case "minkan": {
      const caller = take(state.seats[event.s], event.tiles);
      const meld: Meld = { type: event.t, tiles: sortTiles([...event.tiles, event.tile]), called: event.tile, from: event.from, added: null };
      let seats = withSeat(base, event.s, { ...caller, melds: [...caller.melds, meld] });
      seats = withSeat({ ...base, seats }, event.from, markCalled(seats[event.from]));
      return { ...base, seats, turn: event.s, lastDiscard: null };
    }
    case "ankan": {
      const caller = take(state.seats[event.s], event.tiles);
      const meld: Meld = { type: "ankan", tiles: sortTiles(event.tiles), called: null, from: null, added: null };
      return { ...base, seats: withSeat(base, event.s, { ...caller, melds: [...caller.melds, meld] }), turn: event.s };
    }
    case "kakan": {
      const caller = take(state.seats[event.s], [event.tile]);
      const kind = kindOf(event.tile);
      const melds = caller.melds.map((meld) => (meld.type === "pon" && kindOf(meld.tiles[0]) === kind ? ({ ...meld, type: "kakan", added: event.tile, tiles: sortTiles([...meld.tiles, event.tile]) } as Meld) : meld));
      return { ...base, seats: withSeat(base, event.s, { ...caller, melds }), turn: event.s };
    }
    case "dora":
      return { ...base, dora: [...state.dora, event.tile] };
    case "end": {
      const result = event.result;
      const scores = [...result.scores] as ReplayState["scores"];
      return { ...base, over: true, result, scores, turn: null, lastDiscard: null, sticks: result.type === "win" ? 0 : state.sticks };
    }
    default:
      return base;
  }
}

/** The position after the first `count` events of a hand's log. */
export function stateAt(header: HandHeader, log: readonly LogEvent[], count: number, sticks = 0): ReplayState {
  let state = initialState(header, sticks);
  const upto = Math.max(0, Math.min(count, log.length));
  for (let index = 0; index < upto; index += 1) state = applyEvent(state, log[index]);
  return state;
}

/**
 * The event counts a viewer stops at: after every event except a riichi declaration or a dora flip,
 * which ride along with the move before them. The first stop is the deal (with the dealer's first
 * draw), the last is the end of the hand.
 */
export function replaySteps(log: readonly LogEvent[]): number[] {
  const steps: number[] = [];
  for (let count = 1; count <= log.length; count += 1) {
    const next = log[count];
    const folded = next && (next.t === "dora" || next.t === "riichi");
    const first = count === 1 && log[1]?.t === "draw";
    if (!folded && !first) steps.push(count);
  }
  return steps;
}

/** Riichi sticks on the table when each hand starts, worked out from the hands before it. */
export function handStartSticks(hands: readonly Pick<RecordedHand, "result" | "log">[]): number[] {
  const out: number[] = [];
  let sticks = 0;
  for (const hand of hands) {
    out.push(sticks);
    if (hand.result.type === "win") {
      sticks = 0;
    } else {
      sticks += (hand.log ?? []).filter((event) => event.t === "riichi").length;
    }
  }
  return out;
}

// ── Words ───────────────────────────────────────────────────────────────────
/** "East 1", "South 3". */
export const handLabel = (hand: Pick<RecordedHand, "wind" | "number">) => `${windName(27 + hand.wind)} ${hand.number + 1}`;

/** The seat that just did something in an event, if any. */
export function eventSeat(event: LogEvent): SeatIndex | null {
  switch (event.t) {
    case "draw":
    case "discard":
    case "riichi":
    case "chi":
    case "pon":
    case "minkan":
    case "ankan":
    case "kakan":
      return event.s;
    default:
      return null;
  }
}

/** One line for an event: "Alice discards 5 of circles". `nameOf` words a tile id. */
export function eventText(event: LogEvent, names: readonly string[], nameOf: (tile: TileId) => string): string {
  const who = (seat: number) => names[seat] ?? `Seat ${seat + 1}`;
  switch (event.t) {
    case "deal":
      return `${who(event.dealer)} deals.`;
    case "draw":
      return event.rinshan ? `${who(event.s)} draws a replacement tile.` : `${who(event.s)} draws.`;
    case "discard":
      return `${who(event.s)} ${event.riichi ? "declares riichi and discards" : "discards"} ${nameOf(event.tile)}${event.tsumogiri ? " (straight from the draw)" : ""}.`;
    case "riichi":
      return `${who(event.s)}’s ${event.double ? "double " : ""}riichi stands.`;
    case "chi":
      return `${who(event.s)} calls chi on ${who(event.from)}’s ${nameOf(event.tile)}.`;
    case "pon":
      return `${who(event.s)} calls pon on ${who(event.from)}’s ${nameOf(event.tile)}.`;
    case "minkan":
      return `${who(event.s)} calls kan on ${who(event.from)}’s ${nameOf(event.tile)}.`;
    case "ankan":
      return `${who(event.s)} makes a closed kan.`;
    case "kakan":
      return `${who(event.s)} adds ${nameOf(event.tile)} to a pon for a kan.`;
    case "dora":
      return "A new dora indicator turns.";
    case "end":
      return outcomeText(event.result, names);
    default:
      return "";
  }
}

export type Outcome = {
  /** "tsumo", "ron", "draw". */
  kind: "tsumo" | "ron" | "draw";
  /** Short name for a hand list: "Tsumo", "Ron", "Draw". */
  label: string;
  winners: SeatIndex[];
  /** The seat that dealt in (ron), the first of them. */
  loser: SeatIndex | null;
  /** The biggest single win, in points gained; 0 for a draw. */
  points: number;
};

/** What a hand came to, in a form a list can show. */
export function outcomeOf(result: HandResult): Outcome {
  if (result.type === "draw") return { kind: "draw", label: DRAW_REASONS[result.reason]?.name ?? "Draw", winners: [], loser: null, points: 0 };
  const winners = result.wins.map((win) => win.seat);
  const first = result.wins[0];
  return {
    kind: first.tsumo ? "tsumo" : "ron",
    label: first.tsumo ? "Tsumo" : "Ron",
    winners,
    loser: first.tsumo ? null : first.from,
    points: Math.max(...result.wins.map((win) => win.gain)),
  };
}

/** "Alice wins by self-draw: Haneman, +6,000." */
export function outcomeText(result: HandResult, names: readonly string[]): string {
  const who = (seat: number) => names[seat] ?? `Seat ${seat + 1}`;
  if (result.type === "draw") {
    const info = DRAW_REASONS[result.reason];
    return `${info?.name ?? "Draw"}. ${info?.text ?? ""}`.trim();
  }
  return result.wins
    .map((win) => `${who(win.seat)} wins ${win.tsumo ? "by self-draw" : `on ${who(win.from ?? 0)}’s discard`}: ${winScoreText(win)}, +${win.gain.toLocaleString("en-US")}.`)
    .join(" ");
}

/** "Haneman", "Double yakuman" or "3 han 30 fu". */
export const winScoreText = (win: Pick<WinEntry, "han" | "fu" | "limit" | "yakuman">) => scoreText(win);

/** The limit's name if the hand is one ("Mangan"), else null. */
export const winLimit = (win: Pick<WinEntry, "limit" | "yakuman">) => (win.yakuman > 0 ? "Yakuman" : limitName(win.limit));
