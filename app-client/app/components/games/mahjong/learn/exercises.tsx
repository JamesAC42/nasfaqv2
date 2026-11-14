"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Tile, TileRow } from "@/app/components/games/mahjong/tile";
import { isRedFive, kindOf, tileName, tilesFrom } from "@/app/lib/games/mahjong/tiles";
import styles from "@/app/components/games/mahjong/learn/tutorial.module.scss";

// The small checked exercises in the walkthrough. Answers are fixed and live in lessons.tsx; checking
// happens here, in the browser. A tile's identity for checking is its kind, and "red" for a red five,
// so two copies of the same tile are interchangeable.

export type PickExercise = {
  id: string;
  kind: "pick";
  prompt: ReactNode;
  /** A hand or discard row shown above for reference (not tappable). */
  context?: { label: string; notation: string; gaps?: number[] };
  /** The tappable row, in notation. */
  tiles: string;
  /** How many to tap. */
  count: number;
  /** Indexes into `tiles` that are right. Copies of the same tile count the same. */
  answer: number[];
  explain: ReactNode;
  /** Said when a wrong tile at this index is among the taps. */
  hints?: Record<number, string>;
};

export type ChoiceExercise = {
  id: string;
  kind: "choice";
  prompt: ReactNode;
  /** A picture shown with the question. */
  picture?: ReactNode;
  options: string[];
  answer: number;
  explain: ReactNode;
  /** Said when this wrong option is picked. */
  hints?: Record<number, string>;
};

export type Exercise = PickExercise | ChoiceExercise;

const identity = (id: number) => (isRedFive(id) ? `r${kindOf(id)}` : String(kindOf(id)));

function Status({ children, tone }: { children: ReactNode; tone: "ok" | "no" | "idle" }) {
  return (
    <p className={styles.feedback} data-tone={tone} role="status" aria-live="polite">
      {children}
    </p>
  );
}

function Pick({ exercise, done, onDone }: { exercise: PickExercise; done: boolean; onDone: () => void }) {
  const ids = useMemo(() => tilesFrom(exercise.tiles), [exercise.tiles]);
  const [picked, setPicked] = useState<number[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [shown, setShown] = useState(false);
  const solved = done || shown;
  const answer = exercise.answer;
  const selection = solved ? answer : picked;

  const toggle = (index: number) => {
    if (solved) return;
    setWrong(null);
    setPicked((current) => {
      if (current.includes(index)) return current.filter((value) => value !== index);
      if (exercise.count === 1) return [index];
      return current.length >= exercise.count ? current : [...current, index];
    });
  };

  const check = () => {
    const want = answer.map((index) => identity(ids[index])).sort();
    const have = picked.map((index) => identity(ids[index])).sort();
    if (want.length === have.length && want.every((value, at) => value === have[at])) {
      setWrong(null);
      onDone();
      return;
    }
    const hint = picked.map((index) => exercise.hints?.[index]).find(Boolean);
    setWrong(hint ?? "Not quite. Look again and change your taps.");
    setMisses((count) => count + 1);
  };

  const show = () => {
    setShown(true);
    onDone();
  };

  return (
    <div className={styles.exercise}>
      <p className={styles.prompt}>{exercise.prompt}</p>
      {exercise.context ? (
        <div className={styles.context}>
          <span>{exercise.context.label}</span>
          <TileRow notation={exercise.context.notation} size={26} gapAfter={exercise.context.gaps} />
        </div>
      ) : null}
      <div className={styles.choices} role="group" aria-label="Tap the tiles">
        {ids.map((id, index) => (
          <Tile key={index} id={id} size={38} onClick={() => toggle(index)} selected={selection.includes(index)} title={tileName(id)} disabled={solved} />
        ))}
      </div>
      {solved ? (
        <Status tone="ok">
          <b>{shown ? "Here it is. " : "Right. "}</b>
          {exercise.explain}
        </Status>
      ) : (
        <>
          <div className={styles.actions}>
            <button type="button" className={styles.check} onClick={check} disabled={picked.length !== exercise.count}>
              Check
            </button>
            {misses >= 2 ? (
              <button type="button" className={styles.ghost} onClick={show}>
                Show me
              </button>
            ) : null}
            <span className={styles.count}>
              {picked.length} of {exercise.count} tapped
            </span>
          </div>
          {wrong ? <Status tone="no">{wrong}</Status> : null}
        </>
      )}
    </div>
  );
}

function Choice({ exercise, done, onDone }: { exercise: ChoiceExercise; done: boolean; onDone: () => void }) {
  const [tried, setTried] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const choose = (index: number) => {
    if (done) return;
    if (index === exercise.answer) {
      setMessage(null);
      onDone();
      return;
    }
    setTried((current) => (current.includes(index) ? current : [...current, index]));
    setMessage(exercise.hints?.[index] ?? "Not that one.");
  };

  return (
    <div className={styles.exercise}>
      <p className={styles.prompt}>{exercise.prompt}</p>
      {exercise.picture ? <div className={styles.context}>{exercise.picture}</div> : null}
      <div className={styles.options} role="group" aria-label="Answers">
        {exercise.options.map((option, index) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            data-state={done && index === exercise.answer ? "right" : tried.includes(index) ? "wrong" : undefined}
            onClick={() => choose(index)}
            disabled={done || tried.includes(index)}
          >
            {option}
          </button>
        ))}
      </div>
      {done ? (
        <Status tone="ok">
          <b>Right. </b>
          {exercise.explain}
        </Status>
      ) : message ? (
        <Status tone="no">{message}</Status>
      ) : null}
    </div>
  );
}

export function ExerciseView({ exercise, done, onDone }: { exercise: Exercise; done: boolean; onDone: () => void }) {
  return exercise.kind === "pick" ? <Pick exercise={exercise} done={done} onDone={onDone} /> : <Choice exercise={exercise} done={done} onDone={onDone} />;
}
