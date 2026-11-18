import { NORTH, SOUTH, WEST, type TileKind } from "@/app/lib/games/mahjong/tiles";
import type { YakuKey } from "@/app/lib/games/mahjong/types";

// The words for the guided hands (api/src/services/games/mahjong/tutorial.js decides what must happen
// on the table; this is what the learner reads while it does). Each step is the one move the table
// accepts, so the page can point at it. Plain sentences, a gloss for every term, no talent speech.

export type LessonMove = { type: "discard"; kind: TileKind; riichi?: boolean } | { type: "pass" | "pon" | "ron" | "tsumo" };
export type LessonStep = { move: LessonMove; title: string; text: string };

export type LessonInfo = {
  key: string;
  name: string;
  /** Shown before the first move. */
  intro: string;
  steps: LessonStep[];
  /** After the hand: what just happened, as short paragraphs. */
  recap: string[];
  /** The yaku the hand wins with, for the recap's list. */
  yaku: YakuKey[];
  /** Where to go next. */
  next: { lesson: string; label: string } | { practice: true; label: string };
};

export const LESSONS: Record<string, LessonInfo> = {
  riichi: {
    key: "riichi",
    name: "A closed hand and riichi",
    intro: "You are East, the dealer, in a hand that is nearly finished. Four steps and you will have won it. A winning hand is four sets of three tiles plus one pair.",
    steps: [
      {
        move: { type: "discard", kind: NORTH },
        title: "Throw away what doesn’t belong",
        text: "You hold three finished sets (2-3-4 of characters, 4-5-6 of circles, 7-8-9 of bamboo) and a pair of 5s of bamboo. The 9 of characters, the West and the North are loose. Start with the North: tap it to lift it, then tap it again to throw it.",
      },
      {
        move: { type: "pass" },
        title: "Say no to the pon",
        text: "Someone threw a 5 of bamboo, and you hold two of them, so the game offers a Pon: take the tile and make a set. That would open your hand face up, and you would lose the chance to call riichi. Press Pass to keep your hand closed.",
      },
      {
        move: { type: "discard", kind: WEST, riichi: true },
        title: "Call riichi",
        text: "You drew the 8 of characters. Now 8-9 of characters only needs a 7, so if the West goes, you are one tile from winning: that is called ready, or tenpai. Press Riichi to announce it, then pick the West. Riichi costs 1,000 points and locks your hand, so from here on you throw whatever you draw. In return it is a yaku, the scoring pattern every win needs.",
      },
      {
        move: { type: "tsumo" },
        title: "Win",
        text: "The 7 of characters came off the wall: 7-8-9 completes your last set. Winning on your own draw is called Tsumo. Press it.",
      },
    ],
    recap: [
      "You made four sets and a pair, and you had a yaku. Riichi is the yaku you chose; winning on your own draw with a closed hand adds another, called menzen tsumo. If nobody calls a tile before your next turn, winning then adds ippatsu, one more han.",
      "The two 5s of bamboo were dora, the bonus tiles the indicator in the middle of the table points to. They don’t make a hand legal, but each adds a han (a point of value) once you can win.",
      "Closed hands that call riichi are the backbone of the game: stay closed, get ready, announce it, and wait.",
    ],
    yaku: ["riichi", "menzen-tsumo"],
    next: { lesson: "calls", label: "Next lesson: calling tiles" },
  },
  calls: {
    key: "calls",
    name: "Calling tiles",
    intro: "This hand is open: you take other players’ discards to finish faster. Four steps, and the last one wins.",
    steps: [
      {
        move: { type: "discard", kind: SOUTH },
        title: "Throw the loose South",
        text: "You hold a pair of white dragons. A set of three dragons is a yaku all by itself, so if a third one is thrown, you want it. The South wind helps nothing in your hand: tap it to lift it, tap again to throw it.",
      },
      {
        move: { type: "pon" },
        title: "Call the dragon",
        text: "A white dragon just hit the table. With your pair, you can Pon: take it, and lay three white dragons face up. The cost is that your hand is now open, so no riichi. The gain is a guaranteed yaku. Press Pon.",
      },
      {
        move: { type: "discard", kind: NORTH },
        title: "Discard after the call",
        text: "Every call ends with you throwing a tile, since you don’t draw this turn. The North is the only one that doesn’t fit. Your hand now waits on a 2 or a 5 of bamboo to finish 3-4 of bamboo.",
      },
      {
        move: { type: "ron" },
        title: "Win on a discard",
        text: "Another player threw a 5 of bamboo, which completes 3-4-5. Winning on someone else’s discard is called Ron, and they pay for it. Press Ron.",
      },
    ],
    recap: [
      "You won with an open hand. Calling made it faster, and the white dragon set was your yaku (called yakuhai).",
      "Closed hands get riichi and self-draw bonuses; open hands trade those for speed. The rule of thumb: call only when it keeps a yaku in your hand.",
      "The two 7s of bamboo were dora, which is why the hand is worth more than one han.",
    ],
    yaku: ["yakuhai-white"],
    next: { practice: true, label: "Play a practice game" },
  },
};

export const lessonOf = (key: string | null | undefined): LessonInfo | null => (key && Object.hasOwn(LESSONS, key) ? LESSONS[key] : null);
