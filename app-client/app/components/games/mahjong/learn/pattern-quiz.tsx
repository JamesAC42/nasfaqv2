"use client";

import { useState } from "react";
import { TalentReaction } from "@/app/components/common/talent-reaction";
import { usePhone } from "@/app/components/games/arcade/use-media";
import { EASY_PATTERNS } from "@/app/components/games/mahjong/learn/easy-patterns";
import { TileRow, rowFromExample } from "@/app/components/games/mahjong/tile";
import { YAKU } from "@/app/lib/games/mahjong/yaku";
import type { YakuKey } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/learn/easy-patterns.module.scss";

// "Spot the pattern": each hand is a yaku.ts example (checked against the server's scorer), and its
// situation line rules out the other four easy patterns, so exactly one answer is right. The honitsu
// hand's West triplet scores nothing because the line seats you South in the East round.

const NAMES: Record<string, string> = { "yakuhai-white": "Value honors" };
const nameOf = (key: YakuKey) => NAMES[key] ?? YAKU[key].name;

const QUESTIONS: { key: YakuKey; situation: string }[] = [
  { key: "tanyao", situation: "Closed. You won on another player’s discard, without riichi." },
  { key: "yakuhai-white", situation: "You called the pon, then won on a discard." },
  { key: "menzen-tsumo", situation: "Closed, no riichi. You drew the winning tile yourself." },
  { key: "honitsu", situation: "Closed, no riichi. You’re South in the East round, and you won on a discard." },
  { key: "riichi", situation: "You declared riichi earlier, then won on a discard." },
];

function Question({ number, answer, situation }: { number: number; answer: YakuKey; situation: string }) {
  const phone = usePhone();
  const [tried, setTried] = useState<YakuKey[]>([]);
  const [solved, setSolved] = useState(false);
  const info = YAKU[answer];
  const choose = (key: YakuKey) => {
    if (solved) return;
    if (key === answer) setSolved(true);
    else setTried((current) => (current.includes(key) ? current : [...current, key]));
  };
  const last = tried[tried.length - 1];
  return (
    <li className={styles.quizItem} data-solved={solved ? "true" : undefined}>
      <span className={styles.quizNum}>Hand {number}</span>
      <div className={styles.hand}>
        <TileRow {...rowFromExample(info.example)} size={phone ? 20 : 24} />
      </div>
      <p className={styles.situation}>{situation}</p>
      <div className={styles.quizOptions} role="group" aria-label={`Hand ${number}: which pattern?`}>
        {EASY_PATTERNS.map((pattern) => (
          <button
            key={pattern.key}
            type="button"
            onClick={() => choose(pattern.key)}
            disabled={solved || tried.includes(pattern.key)}
            data-state={solved && pattern.key === answer ? "right" : tried.includes(pattern.key) ? "wrong" : undefined}
          >
            {nameOf(pattern.key)}
          </button>
        ))}
      </div>
      <div className={styles.quizFeedback} role="status" aria-live="polite">
        {solved ? (
          <>
            <TalentReaction pose="hype" size={phone ? 44 : 52} fresh />
            <p>
              <b>Right: {nameOf(answer).toLowerCase()}.</b> {info.example.caption}
            </p>
          </>
        ) : last ? (
          <p key={last} className={styles.miss}>
            <b>Not {nameOf(last).toLowerCase()}.</b> Look at the tiles again, and at how the hand was won.
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function PatternQuiz() {
  return (
    <ol className={styles.quizList} aria-label="Spot the pattern">
      {QUESTIONS.map((question, index) => (
        <Question key={question.key} number={index + 1} answer={question.key} situation={question.situation} />
      ))}
    </ol>
  );
}
