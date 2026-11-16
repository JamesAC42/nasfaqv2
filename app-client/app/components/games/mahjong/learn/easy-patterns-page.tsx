"use client";

import Link from "next/link";
import { EasyPatterns } from "@/app/components/games/mahjong/learn/easy-patterns";
import { LearnArt } from "@/app/components/games/mahjong/learn/learn-art";
import { Callout, LearnFrame, PageIntro } from "@/app/components/games/mahjong/learn/learn-frame";
import { PatternQuiz } from "@/app/components/games/mahjong/learn/pattern-quiz";
import { useStartTable } from "@/app/components/games/mahjong/learn/start-table";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

export function EasyPatternsPage() {
  const table = useStartTable();
  return (
    <LearnFrame
      title="Five easy patterns"
      blurb="A hand needs at least one yaku to win. These five are the ones to reach for first, each with a hand to picture."
    >
      <PageIntro
        art={<LearnArt slot="mahjong-learn-patterns" width={420} priority />}
        points={[
          <>
            A hand needs <b>at least one yaku</b> to win. These five are the easiest to get.
          </>,
          <>
            Each comes with the one <b>trap</b> that catches new players.
          </>,
          <>
            Then try <b>Spot the pattern</b> at the bottom: five hands, one pattern each.
          </>,
        ]}
      />
      <EasyPatterns size={22} rich />
      <Callout>
        <p>
          Dora never count as a yaku: they add han, but only to a hand that already has one. The rest of the patterns are on the <Link href="/games/mahjong/learn/yaku">yaku page</Link>, pinfu among them.
        </p>
      </Callout>

      <h2 className={styles.headRow} id="spot">
        Spot the pattern
      </h2>
      <p className={styles.caption} style={{ margin: "0.5rem 0 0", fontSize: "0.9375rem" }}>
        Each hand has exactly one of the five. Read the tiles and how it was won, then pick.
      </p>
      <PatternQuiz />

      <div className={styles.buttons} style={{ marginTop: "1.5rem" }}>
        <button type="button" className={styles.primary} onClick={table.practice} disabled={table.disabled}>
          {table.busy === "practice" ? "Dealing…" : "Practice vs bots"}
        </button>
        <Link href="/games/mahjong/learn/tutorial" className={styles.secondary}>
          Walkthrough
        </Link>
      </div>
      {table.error ? <span className={styles.error}>{table.error}</span> : null}
    </LearnFrame>
  );
}
