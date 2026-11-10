"use client";

import Link from "next/link";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { LESSONS } from "@/app/components/games/mahjong/learn/lessons";
import { useWalkthroughProgress } from "@/app/components/games/mahjong/learn/progress";
import { MAHJONG_TERMS } from "@/app/lib/games/mahjong/terms";
import { YAKU_LIST } from "@/app/lib/games/mahjong/yaku";
import { useStartTable } from "@/app/components/games/mahjong/learn/start-table";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

export function LearnHub() {
  const { done } = useWalkthroughProgress();
  const finished = LESSONS.filter((lesson) => lesson.exercises.every((exercise) => done.has(exercise.id))).length;
  const started = finished > 0;
  const table = useStartTable();

  return (
    <LearnFrame
      title="Learn mahjong"
      blurb={
        <>
          Riichi mahjong takes a few hands to click. Do the three steps in order, or skip to the page you need.
        </>
      }
    >
      <ol className={styles.path}>
        <li>
          <span className={styles.step}>01</span>
          <h2>Walkthrough</h2>
          <p>
            Ten short lessons, tiles first, with a question in each. Tiles, sets, the winning shape, your turn, waits, yaku, calls, furiten, scoring and the clock. It remembers where you stopped.
          </p>
          <span className={styles.progressLine}>
            {finished} of {LESSONS.length} lessons done
          </span>
          <Link href="/games/mahjong/learn/tutorial" className={styles.primary}>
            {finished >= LESSONS.length ? "Review the walkthrough" : started ? "Keep going" : "Start the walkthrough"}
          </Link>
        </li>
        <li>
          <span className={styles.step}>02</span>
          <h2>Guided hands</h2>
          <p>Two hands dealt for teaching: a closed hand that wins with riichi, and an open one that wins with a pon. The table says which move to make and why.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className={styles.secondary} onClick={() => table.lesson("riichi")} disabled={table.disabled}>
              {table.busy === "riichi" ? "Dealing…" : "Riichi hand"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => table.lesson("calls")} disabled={table.disabled}>
              {table.busy === "calls" ? "Dealing…" : "Calls hand"}
            </button>
          </div>
        </li>
        <li>
          <span className={styles.step}>03</span>
          <h2>Practice vs bots</h2>
          <p>A full East-only game against three easy bots, no clock, nothing rated, nothing to lose. Do it a few times.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className={styles.primary} onClick={table.practice} disabled={table.disabled}>
              {table.busy === "practice" ? "Dealing…" : "Practice vs bots"}
            </button>
            <Link href="/games/mahjong" className={styles.secondary}>
              Lobby
            </Link>
          </div>
          {table.error ? <span className={styles.error}>{table.error}</span> : null}
        </li>
      </ol>

      <h2 className={styles.headRow}>For reference</h2>
      <ul className={styles.refs}>
        <li>
          <Link href="/games/mahjong/learn/rules">
            <b>Rules</b>
            <span>The rule sheet this site plays by: calls, riichi, furiten, draws, scoring, clocks, rating and the money rules.</span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/yaku">
            <b>Yaku</b>
            <span>
              All {YAKU_LIST.length} scoring patterns with their han and a pictured hand. Search, or filter to closed-only and yakuman.
            </span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/glossary">
            <b>Glossary</b>
            <span>{MAHJONG_TERMS.length} Japanese terms in plain English, A to Z, searchable.</span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/tips">
            <b>Tips</b>
            <span>First games, getting better, and table sense: what to do, and what to stop doing.</span>
          </Link>
        </li>
      </ul>

    </LearnFrame>
  );
}
