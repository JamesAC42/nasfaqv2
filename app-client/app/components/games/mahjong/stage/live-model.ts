// The live table payload as the 3D stage's model. Pure: the same table, seat and moment always give
// the same model. Only what the payload holds is drawn: other players' concealed tiles stay counts
// until a result shows them (a win, or a ready hand at an exhaustive draw).

import type { Moment, Mood, StageHand, StageMeld, StageModel, StagePondTile, StageSeat } from "@/app/components/games/mahjong/stage/model";
import { seatLabel } from "@/app/lib/games/mahjong/table-model";
import { windLetter, type TileId } from "@/app/lib/games/mahjong/tiles";
import { isSeatHand, type GameView, type MahjongTable, type Meld, type PondEntry, type PublicHand, type SeatHand, type SeatIndex } from "@/app/lib/games/mahjong/types";

/** A moment as the live table records it: on a real seat (the adapter turns it to a stage seat). */
export type LiveMoment = Omit<Moment, "seat"> & { seat: SeatIndex };

export type LiveStageInput = {
  table: MahjongTable;
  game: GameView;
  hand: PublicHand | SeatHand;
  /** The real seat drawn at the bottom: yours, or the one a spectator watches from. */
  bottom: SeatIndex;
  /** Your seat, null when watching. */
  me: SeatIndex | null;
  /** Each real seat's color for the current theme. */
  colors: readonly string[];
  moment: LiveMoment | null;
};

/** Real seat for a stage seat (0 bottom, 1 right, 2 across, 3 left). */
export const realSeat = (stage: number, bottom: number) => ((bottom + stage) % 4) as SeatIndex;
/** Stage seat for a real seat. */
export const stageSeat = (real: number, bottom: number) => (real - bottom + 4) % 4;

/**
 * A called set laid out the way its owner sees it: the tile taken sits on the side it came from (the
 * left for the player before you, the middle from across, the right from the player after you).
 */
export function stageMeld(meld: Meld, owner: number): StageMeld {
  if (meld.type === "ankan" || meld.called === null || meld.from === null) return { tiles: [...meld.tiles], called: -1, added: null, closed: meld.type === "ankan" };
  const from = (meld.from - owner + 4) % 4;
  const base = meld.type === "kakan" && meld.added !== null ? meld.tiles.filter((id) => id !== meld.added) : [...meld.tiles];
  const others = base.filter((id) => id !== meld.called);
  const at = from === 3 ? 0 : from === 2 ? 1 : others.length;
  const tiles = [...others.slice(0, at), meld.called, ...others.slice(at)];
  return { tiles, called: at, added: meld.type === "kakan" ? meld.added : null, closed: false };
}

/**
 * A pond as it lies on the table: tiles taken by a call have gone to that call's set, and a riichi
 * declaration that was called passes its sideways turn to the next discard.
 */
export function stagePond(entries: readonly PondEntry[], skip: ReadonlySet<TileId>): StagePondTile[] {
  const out: StagePondTile[] = [];
  let owed = false;
  for (const entry of entries) {
    if (entry.called || skip.has(entry.tile)) {
      if (entry.riichi) owed = true;
      continue;
    }
    out.push({ id: entry.tile, sideways: entry.riichi || owed });
    owed = false;
  }
  return out;
}

/** Points after each finished hand, then now, worked back from the current score. */
export function scoreLine(game: GameView, seat: number, now: number): number[] {
  const line = [now];
  let at = now;
  for (let index = game.history.length - 1; index >= 0; index--) {
    at -= game.history[index].result.deltas[seat] ?? 0;
    line.unshift(at);
  }
  return line;
}

export function liveStageModel({ table, game, hand, bottom, me, colors, moment }: LiveStageInput): StageModel {
  const result = hand.phase === "over" ? hand.result : null;
  const win = result?.type === "win" ? result : null;
  const draw = result?.type === "draw" ? result : null;
  const winners = new Set(win ? win.wins.map((entry) => entry.seat) : []);
  // A ron's winning tile leaves the pond it was thrown into for the winner's hand.
  const ronTiles = new Set(win ? win.wins.filter((entry) => !entry.tsumo).map((entry) => entry.tile) : []);
  const seatView = isSeatHand(hand) ? hand : null;
  const clock = table.clock?.phase === "turn" && table.speed !== "untimed" ? table.clock : null;
  const order = [0, 1, 2, 3].map((stage) => realSeat(stage, bottom));

  const moodOf = (real: SeatIndex): Mood => {
    if (winners.has(real) || (moment?.kind === "win" && moment.seat === real)) return "win";
    if (moment?.kind === "riichi" && moment.seat === real) return "riichi";
    if (hand.phase !== "over" && hand.turn === real) return "think";
    return "idle";
  };

  const seats: StageSeat[] = order.map((real) => {
    const seat = table.seats[real];
    const info = hand.seats[real];
    const points = result ? result.scores[real] : hand.scores[real];
    return {
      name: seatLabel(seat),
      symbol: seat?.talent ?? null,
      color: colors[real] ?? "#3fb8f5",
      wind: windLetter(info.wind),
      dealer: hand.dealer === real,
      points,
      history: scoreLine(game, real, points),
      riichi: info.riichi > 0,
      turn: hand.phase !== "over" && hand.turn === real,
      mood: moodOf(real),
      tag: !seat ? null : seat.bot ? "Bot" : seat.away ? "Away" : !seat.connected ? "Offline" : null,
      deadline: clock?.seats.find((entry) => entry.seat === real)?.deadline ?? null,
    };
  });

  const hands: StageHand[] = order.map((real) => {
    const info = hand.seats[real];
    const won = win?.wins.find((entry) => entry.seat === real);
    if (won) return { tiles: [...won.hand, won.tile], count: won.hand.length + 1, drawn: false, revealed: true, win: won.tile };
    const shown = draw?.hands[String(real)];
    if (shown) return { tiles: [...shown], count: shown.length, drawn: false, revealed: true, win: null };
    if (seatView && real === me && real === seatView.seat) {
      const tiles = seatView.drawn !== null ? [...seatView.hand, seatView.drawn] : [...seatView.hand];
      return { tiles, count: tiles.length, drawn: seatView.drawn !== null, revealed: false, win: null };
    }
    return { tiles: null, count: info.count, drawn: info.has_drawn, revealed: false, win: null };
  });

  return {
    key: `${table.id}:${game.hand_index}`,
    seats,
    hands,
    melds: order.map((real) => hand.seats[real].melds.map((meld) => stageMeld(meld, real))),
    ponds: order.map((real) => stagePond(hand.seats[real].pond, ronTiles)),
    dora: [...hand.dora],
    wall: hand.remaining,
    round: { label: game.label, honba: hand.honba, sticks: hand.sticks },
    moment: moment ? { ...moment, seat: stageSeat(moment.seat, bottom) } : null,
    last: hand.phase !== "over" ? (hand.last_discard?.tile ?? null) : null,
  };
}
