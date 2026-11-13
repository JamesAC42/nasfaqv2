"use client";

import Link from "next/link";
import { EasyPatterns } from "@/app/components/games/mahjong/learn/easy-patterns";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { useStartTable } from "@/app/components/games/mahjong/learn/start-table";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

export function EasyPatternsPage() {
  const table = useStartTable();
  return (
    <LearnFrame
      title="Five easy patterns"
      blurb="A hand needs at least one yaku to win. These five are the ones to reach for first, each with a hand to picture."
    >
      <EasyPatterns size={22} />
      <p className={styles.caption} style={{ marginTop: "1rem" }}>
        Dora never count as a yaku: they add han, but only to a hand that already has one. The rest of the patterns are on the <Link href="/games/mahjong/learn/yaku">yaku page</Link>, pinfu among them.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
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
