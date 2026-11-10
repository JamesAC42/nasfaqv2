"use client";

import Link from "next/link";
import { lessonOf, type LessonInfo, type LessonMove } from "@/app/components/games/mahjong/table/lesson-texts";
import { signed } from "@/app/lib/games/mahjong/table-model";
import type { MahjongTable, WinResult } from "@/app/lib/games/mahjong/types";
import { scoreText, yakuName } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

/** The move the lesson wants next, or null when the hand has run out of steps (or the lesson is unknown). */
export function lessonMoveOf(table: MahjongTable): LessonMove | null {
  const lesson = table.lesson ? lessonOf(table.lesson.key) : null;
  if (!table.lesson || !lesson) return null;
  return lesson.steps[table.lesson.step]?.move ?? null;
}

/** The coach panel above your hand during a guided hand: what you see, what to do, and why. */
export function LessonCoach({ table, waiting }: { table: MahjongTable; waiting: boolean }) {
  const meta = table.lesson;
  if (!meta) return null;
  const lesson = lessonOf(meta.key);
  const step = lesson?.steps[meta.step] ?? null;
  const done = meta.step >= meta.steps;
  return (
    <aside className={styles.coach} aria-label="Lesson">
      <header>
        <small>{lesson?.name ?? "Lesson"}</small>
        <span className={styles.dots} aria-label={`Step ${Math.min(meta.step + 1, meta.steps)} of ${meta.steps}`}>
          {Array.from({ length: meta.steps }, (_, index) => (
            <i key={index} data-done={index < meta.step || undefined} data-now={index === meta.step || undefined} />
          ))}
        </span>
      </header>
      {meta.step === 0 && lesson ? <p className={styles.coachIntro}>{lesson.intro}</p> : null}
      {step ? (
        <>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          {waiting ? <p className={styles.fine}>The others are playing. Your move comes up in a moment.</p> : null}
        </>
      ) : done ? (
        <p>That’s the hand. Have a look at how it scored.</p>
      ) : (
        <p>Make the highlighted move. The table only takes the one the lesson asks for.</p>
      )}
    </aside>
  );
}

/** After a lesson hand: what just happened, and where to go next. */
export function LessonDone({
  lesson,
  result,
  signedIn,
  onNext,
  busy,
  error,
}: {
  lesson: LessonInfo;
  result: WinResult | null;
  signedIn: boolean;
  onNext: () => void;
  busy: boolean;
  error: string | null;
}) {
  const win = result?.wins[0] ?? null;
  const keys = win ? win.yaku.map((entry) => entry.key) : lesson.yaku;
  return (
    <section className={styles.over} aria-label="Lesson complete">
      <header>
        <small>Lesson complete</small>
        <h2>{lesson.name}</h2>
      </header>
      <div className={styles.recap}>
        <h3>What just happened</h3>
        {win ? (
          <p className={styles.recapScore}>
            <b>{scoreText(win)}</b> <span className={styles.delta} data-dir="up">{signed(win.gain)}</span>
          </p>
        ) : null}
        <ul className={styles.recapYaku}>
          {keys.map((key) => (
            <li key={key}>{yakuName(key)}</li>
          ))}
          {win && win.dora.dora ? <li>Dora ×{win.dora.dora}</li> : null}
        </ul>
        {lesson.recap.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.overLinks}>
        <button type="button" className={styles.next} onClick={onNext} disabled={busy}>
          {busy ? "Dealing…" : lesson.next.label}
        </button>
        {!signedIn ? (
          <Link href="/register" className={styles.plain}>
            Make an account
          </Link>
        ) : null}
        <Link href="/games/mahjong/learn" className={styles.plain}>
          Keep learning
        </Link>
        <Link href="/games/mahjong" className={styles.plain}>
          Lobby
        </Link>
      </div>
      {!signedIn ? <p className={styles.nudge}>Free to join. An account keeps your rating and unlocks matches against other people.</p> : null}
    </section>
  );
}
