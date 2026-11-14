"use client";

import Link from "next/link";
import { useState } from "react";
import { ExerciseView } from "@/app/components/games/mahjong/learn/exercises";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { LESSONS } from "@/app/components/games/mahjong/learn/lessons";
import { useWalkthroughProgress } from "@/app/components/games/mahjong/learn/progress";
import { useStartTable } from "@/app/components/games/mahjong/learn/start-table";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";
import styles from "@/app/components/games/mahjong/learn/tutorial.module.scss";

const PLAY = LESSONS.length; // the last step, after every lesson

export function PlayPanel() {
  const { user, initialized, busy, error, disabled: wait, lesson, practice } = useStartTable();

  return (
    <>
      <div className={learn.prose}>
        <p>
          Two short guided hands on a real table. You’re dealt a hand that was arranged for the lesson, three bots play along, and the table only accepts the move it’s teaching, with a line about why. Nothing is rated
          and nothing costs anything.
        </p>
      </div>
      <div className={styles.play}>
        <div>
          <h3>Guided hand: riichi</h3>
          <p>A closed hand. Throw the right tile, pass up a call you don’t want, declare riichi and win on your own draw.</p>
          <button type="button" className={learn.primary} onClick={() => lesson("riichi")} disabled={wait}>
            {busy === "riichi" ? "Dealing…" : "Start the riichi hand"}
          </button>
        </div>
        <div>
          <h3>Guided hand: calls</h3>
          <p>An open hand. Pon a white dragon for a yaku, then win on another player’s discard.</p>
          <button type="button" className={learn.primary} onClick={() => lesson("calls")} disabled={wait}>
            {busy === "calls" ? "Dealing…" : "Start the calls hand"}
          </button>
        </div>
      </div>
      {error ? <p className={learn.error}>{error}</p> : null}
      <div className={learn.prose}>
        <h3>Then play a real one</h3>
        <p>A full East-only game against three easy bots, no clock. Free, and it doesn’t touch your rating.</p>
      </div>
      <div className={styles.practice}>
        <button type="button" className={learn.primary} onClick={practice} disabled={wait}>
          {busy === "practice" ? "Dealing…" : "Practice vs bots"}
        </button>
        <Link href="/games/mahjong" className={learn.secondary}>
          More ways to play
        </Link>
      </div>
      {!user && initialized ? (
        <p className={learn.progressLine} style={{ marginTop: "0.8rem" }}>
          Signed out is fine for practice. <Link href="/login">Sign in</Link> to play friends and ranked games.
        </p>
      ) : null}
    </>
  );
}

export function Tutorial() {
  const { done, at, markDone, setAt, reset } = useWalkthroughProgress();
  const [epoch, setEpoch] = useState(0);
  const current = Math.min(Math.max(at, 0), PLAY);
  const lessonDone = (index: number) => LESSONS[index].exercises.every((exercise) => done.has(exercise.id));
  const finished = LESSONS.filter((_, index) => lessonDone(index)).length;
  const lesson = current < PLAY ? LESSONS[current] : null;

  const go = (index: number) => {
    setAt(index);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  return (
    <LearnFrame
      title="Walkthrough"
      blurb={
        <>
          From “what is a tile” to a first win. Ten short lessons with a question in each: <b>{finished}</b> of <b>{LESSONS.length}</b> done.
        </>
      }
    >
      <div className={styles.wrap}>
        <ol className={styles.chips} aria-label="Lessons">
          {LESSONS.map((entry, index) => (
            <li key={entry.id}>
              <button type="button" onClick={() => go(index)} aria-current={index === current ? "step" : undefined} data-done={lessonDone(index)} aria-label={`Lesson ${index + 1}: ${entry.title}${lessonDone(index) ? " (done)" : ""}`}>
                {lessonDone(index) ? "✓" : index + 1}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => go(PLAY)} aria-current={current === PLAY ? "step" : undefined} aria-label="Play">
              Play
            </button>
          </li>
        </ol>

        <article className={styles.lesson}>
          {lesson ? (
            <>
              <span className={styles.where}>
                Lesson {current + 1} of {LESSONS.length}
              </span>
              <h2>{lesson.title}</h2>
              <p className={styles.blurb}>{lesson.blurb}</p>
              <div className={learn.prose}>{lesson.body}</div>
              <div className={styles.exercises}>
                {lesson.exercises.map((exercise, index) => (
                  <div key={`${exercise.id}:${epoch}`}>
                    <span className={styles.exerciseHead}>
                      Try it{lesson.exercises.length > 1 ? ` ${index + 1} of ${lesson.exercises.length}` : ""}
                    </span>
                    <ExerciseView exercise={exercise} done={done.has(exercise.id)} onDone={() => markDone(exercise.id)} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <span className={styles.where}>Last step</span>
              <h2>Play it</h2>
              <PlayPanel />
            </>
          )}
          <div className={styles.nav}>
            {current > 0 ? (
              <button type="button" className={learn.secondary} onClick={() => go(current - 1)}>
                ← Back
              </button>
            ) : null}
            <span className={styles.spacer} />
            {current < PLAY ? (
              <button type="button" className={learn.primary} onClick={() => go(current + 1)}>
                {current === PLAY - 1 ? "Play it →" : "Next lesson →"}
              </button>
            ) : null}
          </div>
          {finished > 0 ? (
            <button type="button" className={styles.reset} onClick={() => {
                reset();
                setEpoch((value) => value + 1);
              }}>
              Start over
            </button>
          ) : null}
        </article>
      </div>
    </LearnFrame>
  );
}
