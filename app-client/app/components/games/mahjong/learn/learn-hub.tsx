"use client";

import Link from "next/link";
import { HandLab } from "@/app/components/games/mahjong/learn/hand-lab";
import { LearnArt } from "@/app/components/games/mahjong/learn/learn-art";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { LESSONS } from "@/app/components/games/mahjong/learn/lessons";
import { useWalkthroughProgress } from "@/app/components/games/mahjong/learn/progress";
import { Tile } from "@/app/components/games/mahjong/tile";
import { MAHJONG_TERMS } from "@/app/lib/games/mahjong/terms";
import { YAKU_LIST } from "@/app/lib/games/mahjong/yaku";
import { useStartTable } from "@/app/components/games/mahjong/learn/start-table";
import styles from "@/app/components/games/mahjong/learn/learn.module.scss";

const glyph = (kinds: number[], red = false) => (
  <span className={styles.refTile} aria-hidden="true">
    {kinds.map((kind, index) => (
      <Tile key={index} kind={kind} size={20} labels={false} title="" red={red && kind % 9 === 4} />
    ))}
  </span>
);

export function LearnHub() {
  const { done, at, setAt } = useWalkthroughProgress();
  const lessonDone = (index: number) => LESSONS[index].exercises.every((exercise) => done.has(exercise.id));
  const finished = LESSONS.filter((_, index) => lessonDone(index)).length;
  const started = finished > 0;
  const allDone = finished >= LESSONS.length;
  // Where the walkthrough will open: the lesson they stopped on, or the first one not done.
  const firstOpen = Math.max(0, LESSONS.findIndex((_, index) => !lessonDone(index)));
  const next = at >= 0 && at < LESSONS.length ? at : firstOpen;
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
      <section className={styles.hero} aria-label="Your progress">
        <div className={styles.heroText}>
          <span className={styles.kicker}>{allDone ? "Walkthrough done" : started ? "Pick up where you stopped" : "New here? Start with the tiles"}</span>
          <h2>{allDone ? "All ten lessons done" : started ? `Next: ${LESSONS[next].title}` : "From the tiles to a first win"}</h2>
          <p>
            {allDone
              ? "Play a guided hand or a practice game against bots next, or open any lesson again from the row below."
              : started
                ? `Lesson ${next + 1} of ${LESSONS.length}. ${LESSONS[next].blurb}`
                : "Ten short lessons, tiles first, with a question in each. It remembers where you stopped."}
          </p>
          <span className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={finished} aria-label="Lessons done">
            <i style={{ width: `${(finished / LESSONS.length) * 100}%` }} />
          </span>
          <span className={styles.progressLine}>
            {finished} of {LESSONS.length} lessons done
          </span>
          <ol className={styles.pips} aria-label="Lessons">
            {LESSONS.map((lesson, index) => (
              <li key={lesson.id}>
                <Link
                  href="/games/mahjong/learn/tutorial"
                  onClick={() => setAt(index)}
                  data-done={lessonDone(index)}
                  data-next={index === next && !allDone}
                  aria-label={`Lesson ${index + 1}: ${lesson.title}${lessonDone(index) ? " (done)" : ""}`}
                  title={lesson.title}
                >
                  {lessonDone(index) ? "✓" : index + 1}
                </Link>
              </li>
            ))}
          </ol>
          <div className={styles.buttons}>
            {allDone ? (
              <button type="button" className={styles.primary} onClick={table.practice} disabled={table.disabled}>
                {table.busy === "practice" ? "Dealing…" : "Practice vs bots"}
              </button>
            ) : (
              <Link href="/games/mahjong/learn/tutorial" className={styles.primary} onClick={() => (at === next ? undefined : setAt(next))}>
                {started ? "Keep going" : "Start the walkthrough"}
              </Link>
            )}
          </div>
        </div>
        <div className={styles.heroArt}>
          <LearnArt slot="mahjong-learn-hub-hero" width={560} priority />
        </div>
      </section>

      <ol className={styles.path}>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.step}>01</span>
            {glyph([0, 9, 18])}
          </div>
          <h2>Walkthrough</h2>
          <p>
            Ten short lessons, tiles first, with a question in each. Tiles, sets, the winning shape, your turn, waits, yaku, calls, furiten, scoring and the clock. It remembers where you stopped.
          </p>
          <span className={styles.progressLine}>
            {finished} of {LESSONS.length} lessons done
          </span>
          <Link href="/games/mahjong/learn/tutorial" className={styles.secondary} style={{ justifySelf: "start" }}>
            {allDone ? "Review the walkthrough" : started ? "Keep going" : "Start the walkthrough"}
          </Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.step}>02</span>
            {glyph([31, 31, 31])}
          </div>
          <h2>Guided hands</h2>
          <p>Two hands dealt for teaching: a closed hand that wins with riichi, and an open one that wins with a pon. The table says which move to make and why.</p>
          <div className={styles.buttons}>
            <button type="button" className={styles.secondary} onClick={() => table.lesson("riichi")} disabled={table.disabled}>
              {table.busy === "riichi" ? "Dealing…" : "Riichi hand"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => table.lesson("calls")} disabled={table.disabled}>
              {table.busy === "calls" ? "Dealing…" : "Calls hand"}
            </button>
          </div>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.step}>03</span>
            {glyph([27, 28, 29, 30])}
          </div>
          <h2>Practice vs bots</h2>
          <p>A full East-only game against three easy bots, no clock, nothing rated, nothing to lose. Do it a few times.</p>
          <div className={styles.buttons}>
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

      <h2 className={styles.headRow} id="lab">
        Try it: the hand lab
      </h2>
      <p className={styles.caption} style={{ margin: "0.5rem 0 0", fontSize: "0.9375rem", maxWidth: "62ch" }}>
        Each example is one tile from a complete shape. Guess the tile, try it, or show the waits. Tap a tile in the hand to swap it for another and build your own.
      </p>
      <HandLab />

      <h2 className={styles.headRow}>For reference</h2>
      <ul className={styles.refs}>
        <li>
          <Link href="/games/mahjong/learn/rules">
            {glyph([27])}
            <b>Rules</b>
            <span>The rule sheet this site plays by: calls, riichi, furiten, draws, scoring, clocks, rating and the money rules.</span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/easy-patterns">
            {glyph([31])}
            <b>Five easy patterns</b>
            <span>The five yaku to reach for first, each with a pictured hand and the one trap to avoid.</span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/yaku">
            {glyph([33])}
            <b>Yaku</b>
            <span>
              All {YAKU_LIST.length} scoring patterns with their han and a pictured hand. Search, or filter to closed-only and yakuman.
            </span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/glossary">
            {glyph([0])}
            <b>Glossary</b>
            <span>{MAHJONG_TERMS.length} Japanese terms in plain English, A to Z, searchable.</span>
          </Link>
        </li>
        <li>
          <Link href="/games/mahjong/learn/tips">
            {glyph([13], true)}
            <b>Tips</b>
            <span>First games, getting better, and table sense: what to do, and what to stop doing.</span>
          </Link>
        </li>
      </ul>
    </LearnFrame>
  );
}
