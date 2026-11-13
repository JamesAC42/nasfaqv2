"use client";

import { TileRow, rowFromExample } from "@/app/components/games/mahjong/tile";
import { YAKU, yakuValueText } from "@/app/lib/games/mahjong/yaku";
import type { YakuKey } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/learn/easy-patterns.module.scss";

// The five yaku a newcomer should reach for first. Names, han and example hands come from yaku.ts
// (every example there is checked against the server's scorer); the "counts when" and "trap" lines
// are written here. Pinfu is left out on purpose: it depends on the shape of the wait, the pair and
// the absence of triplets, which is exactly what a first-week player misjudges, and it is only one
// han. Half flush (one suit plus honors) is easy to see at a glance and worth three han closed.
type Pattern = { key: YakuKey; counts: string; trap: string };

export const EASY_PATTERNS: Pattern[] = [
  {
    key: "riichi",
    counts: "Your hand is one tile from complete and has no called sets. Say riichi, pay a 1,000-point stick, and keep drawing and discarding.",
    trap: "Open hands can’t riichi. One chi, pon or open kan and it’s gone for the hand (a closed kan is fine). After riichi your hand is locked: you only discard what you draw.",
  },
  {
    key: "tanyao",
    counts: "Every tile in the hand, called sets included, is a 2 through 8 of a suit. No 1s, 9s or honors at all. It scores open or closed.",
    trap: "One 1, 9, wind or dragon anywhere ruins it, including inside a set you called. Check before you pon a 9.",
  },
  {
    key: "yakuhai-white",
    counts: "You hold three of a dragon (white, green or red), or of your seat wind or the round wind. Pon one from anyone and you already have a yaku.",
    trap: "A pair doesn’t count: it takes three. A wind that is neither yours nor the round’s scores nothing, and neither do red fives, which are only bonus points.",
  },
  {
    key: "menzen-tsumo",
    counts: "You win by drawing the last tile yourself, with no called sets. It’s a yaku even when nothing else is.",
    trap: "Winning on someone’s discard doesn’t count, and a single call turns it off. It’s the closed hand’s reward for staying closed.",
  },
  {
    key: "honitsu",
    counts: "The whole hand is one suit plus honors: characters and winds, say, with no circles or bamboo. Three han closed, two if you called.",
    trap: "Honors don’t break it, but a second suit does. It’s easy to drift into one: count your suits before you chase it.",
  },
];

/**
 * The cheat sheet. `size` is the tile width of the example hands; `compact` drops the "counts when"
 * paragraphs, for a small panel. Mount it in a dialog or on a page.
 */
export function EasyPatterns({ size = 22, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <ol className={styles.list} aria-label="Five easy patterns">
      {EASY_PATTERNS.map((pattern, index) => {
        const info = YAKU[pattern.key];
        return (
          <li key={pattern.key} className={styles.item}>
            <div className={styles.head}>
              <span className={styles.num}>{index + 1}</span>
              <h3>{pattern.key === "yakuhai-white" ? "Value honors (yakuhai)" : info.name}</h3>
              <small>{pattern.key === "yakuhai-white" ? "1 han a set" : yakuValueText(info)}</small>
            </div>
            <div className={styles.hand}>
              <TileRow {...rowFromExample(info.example)} size={size} />
            </div>
            <p className={styles.caption}>{info.example.caption}</p>
            {compact ? null : <p className={styles.counts}>{pattern.counts}</p>}
            <p className={styles.trap}>
              <b>Trap.</b> {pattern.trap}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
