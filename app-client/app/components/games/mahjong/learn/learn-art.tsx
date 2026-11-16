"use client";

import type { CSSProperties } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { Tile, TileBack } from "@/app/components/games/mahjong/tile";
import styles from "@/app/components/games/mahjong/learn/learn-art.module.scss";

// The drawn versions of the Learn pages' art slots (mahjong-learn-* in lib/art/slots/mahjong-learn.json).
// Each fills its slot and centers a fixed composition scaled by --art-scale; colors are theme tokens,
// tiles are the real tile set. A delivered image replaces the drawing with no code change.

const t = (kind: number, size: number, extra?: { red?: boolean; rotated?: boolean; highlight?: boolean }) => <Tile kind={kind} size={size} labels={false} title="" {...extra} />;

/** Hub: a winning hand standing on the felt, its groups lifting one after another, a rising tape behind. */
function HubArt() {
  const groups = [
    [0, 1, 2],
    [12, 13, 14],
    [24, 25, 26],
    [15, 15, 15],
    [4, 4],
  ];
  return (
    <div className={styles.art}>
      <div className={styles.hub}>
        <svg className={styles.tape} viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="0,100 40,92 70,96 110,74 150,80 190,58 230,64 270,40 310,46 350,22 400,14" />
          <polyline className={styles.tapeShadow} points="0,100 40,92 70,96 110,74 150,80 190,58 230,64 270,40 310,46 350,22 400,14 400,120 0,120" />
        </svg>
        <span className={styles.float} data-at="a">
          {t(33, 30)}
        </span>
        <span className={styles.float} data-at="b">
          {t(27, 26)}
        </span>
        <span className={styles.float} data-at="c">
          {t(13, 24, { red: true })}
        </span>
        <div className={styles.felt}>
          {groups.map((group, at) => (
            <span key={at} className={styles.group} style={{ "--i": at } as CSSProperties}>
              {group.map((kind, n) => (
                <span key={n}>{t(kind, 30)}</span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Rules: a rule sheet on a clipboard with a tile pinned to it, a scoring stick and a clock ring. */
function RulesArt() {
  return (
    <div className={styles.art}>
      <div className={styles.rules}>
        <div className={styles.sheet}>
          <span className={styles.clip} />
          <i />
          <i />
          <i data-short="" />
          <i />
          <i data-short="" />
          <span className={styles.sheetTile}>{t(27, 28)}</span>
        </div>
        <span className={styles.stick}>
          <i />
        </span>
        <svg className={styles.ring} viewBox="0 0 60 60" aria-hidden="true">
          <circle className={styles.ringTrack} cx="30" cy="30" r="24" />
          <circle className={styles.ringArc} cx="30" cy="30" r="24" pathLength="100" />
          <line x1="30" y1="30" x2="30" y2="13" />
        </svg>
      </div>
    </div>
  );
}

/** Easy patterns: five plinths, one pattern on each, the middle one lit. */
function PatternsArt() {
  return (
    <div className={styles.art}>
      <div className={styles.plinths}>
        <span data-h="1">
          <span className={styles.stickSmall}>
            <i />
          </span>
        </span>
        <span data-h="2">
          {t(21, 18)}
          {t(22, 18)}
          {t(23, 18)}
        </span>
        <span data-h="3" data-lit="">
          {t(31, 22)}
          {t(31, 22)}
          {t(31, 22)}
        </span>
        <span data-h="2">
          {t(14, 18, { highlight: true })}
        </span>
        <span data-h="1">
          {t(1, 18)}
          {t(2, 18)}
          {t(28, 18)}
        </span>
      </div>
    </div>
  );
}

/** Yaku: a chart whose bars are stacks of tiles, rising to a glowing yakuman column. */
function YakuArt() {
  const bars = [1, 2, 3, 5, 7];
  return (
    <div className={styles.art}>
      <div className={styles.chart}>
        <span className={styles.axis} />
        {bars.map((height, at) => (
          <span key={at} className={styles.bar} data-top={at === bars.length - 1 ? "" : undefined} style={{ "--i": at } as CSSProperties}>
            {Array.from({ length: height }, (_, row) => (
              <span key={row}>{row === height - 1 ? t([4, 31, 18, 32, 33][at], 20) : <TileBack size={20} rotated />}</span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Glossary: three index cards fanned out, a tile on each. */
function GlossaryArt() {
  return (
    <div className={styles.art}>
      <div className={styles.cards}>
        {[27, 31, 0].map((kind, at) => (
          <span key={kind} className={styles.card} data-at={at}>
            <b />
            {t(kind, 24)}
            <i />
            <i data-short="" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Tips: a discard pond with one tile lit as the safe one, under a shield outline. */
function TipsArt() {
  const pond = [27, 9, 30, 25, 33, 0, 17, 12, 29, 7, 18, 31];
  return (
    <div className={styles.art}>
      <div className={styles.tips}>
        <div className={styles.pond}>
          {pond.map((kind, at) => (
            <span key={at} data-safe={at === 4 ? "" : undefined}>
              {t(kind, 20, at === 4 ? { highlight: true } : undefined)}
            </span>
          ))}
        </div>
        <svg className={styles.shield} viewBox="0 0 60 70" aria-hidden="true">
          <path d="M30 4 L54 13 V34 C54 50 43 60 30 66 C17 60 6 50 6 34 V13 Z" />
          <path className={styles.shieldCheck} d="M19 35 L27 43 L42 26" />
        </svg>
      </div>
    </div>
  );
}

/** Walkthrough done: a cup with tiles bursting out of it. */
function FinishArt() {
  const burst = [
    [33, -46, -58, -18],
    [12, -14, -78, 12],
    [27, 22, -70, -10],
    [4, 52, -50, 20],
    [31, -64, -24, 30],
    [24, 70, -18, -26],
  ];
  return (
    <div className={styles.art}>
      <div className={styles.finish}>
        <span className={styles.rays} />
        {burst.map(([kind, x, y, r], at) => (
          <span key={at} className={styles.burst} style={{ "--x": `${x}px`, "--y": `${y}px`, "--r": `${r}deg`, "--i": at } as CSSProperties}>
            {t(kind, 20)}
          </span>
        ))}
        <svg className={styles.cup} viewBox="0 0 80 90" aria-hidden="true">
          <path className={styles.cupHandle} d="M16 18 C2 18 2 40 20 44 M64 18 C78 18 78 40 60 44" />
          <path className={styles.cupBody} d="M14 10 H66 V26 C66 44 54 54 40 54 C26 54 14 44 14 26 Z" />
          <rect className={styles.cupBody} x="34" y="54" width="12" height="14" />
          <rect className={styles.cupBase} x="22" y="68" width="36" height="9" rx="2" />
        </svg>
      </div>
    </div>
  );
}

const DRAWN = {
  "mahjong-learn-hub-hero": HubArt,
  "mahjong-learn-rules": RulesArt,
  "mahjong-learn-patterns": PatternsArt,
  "mahjong-learn-yaku": YakuArt,
  "mahjong-learn-glossary": GlossaryArt,
  "mahjong-learn-tips": TipsArt,
  "mahjong-learn-finish": FinishArt,
} as const;

export type LearnArtSlot = keyof typeof DRAWN;

/** A Learn page's art: the slot's image when it ships, the drawing until then. Fills its parent. */
export function LearnArt({ slot, width = 560, priority = false }: { slot: LearnArtSlot; width?: number; priority?: boolean }) {
  const Drawn = DRAWN[slot];
  return <SceneArt slot={slot} fill width={width} priority={priority} fallback={<Drawn />} />;
}
