"use client";

import { Tile } from "@/app/components/games/mahjong/tile";
import { copiesText, momentKind, momentText, OUTCOME_TEXT, OUTCOME_TITLE, type Who } from "@/app/lib/games/mahjong/coach-texts";
import { kindName } from "@/app/lib/games/mahjong/tiles";
import type { Review } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/table/coach.module.scss";

const nth = (n: number) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;

/** A look back at a finished hand: what happened, what you waited on and where every copy went, and up to two moments. */
export function ReviewCard({ review, who, title = "Look back at this hand" }: { review: Review; who: Who; title?: string }) {
  const outcome = OUTCOME_TEXT[review.outcome];
  const waits = review.final.waits;
  const improve = review.final.improve.slice(0, 4);
  const moments = review.moments.map((moment) => ({ moment, text: momentText(moment, who) })).filter((entry) => entry.text);
  const readyLine =
    review.ready_turn === null
      ? review.final.won
        ? null
        : "You didn’t get ready (tenpai) this hand. That’s normal while you’re learning: getting ready is the first goal."
      : review.ready_turn === 0
        ? "You were ready (tenpai) from the very first deal."
        : `You first became ready (tenpai) after your ${nth(review.ready_turn)} throw.`;

  return (
    <section className={styles.review} aria-label="Look back at this hand">
      <h3>{title}</h3>
      <h4>{OUTCOME_TITLE[review.outcome] ?? "The hand"}</h4>
      {outcome ? <p>{outcome}</p> : null}
      {readyLine ? <p>{readyLine}</p> : null}

      {waits.length ? (
        <>
          <p>
            <b>You were waiting on:</b>
          </p>
          <ul className={styles.reviewWaits}>
            {waits.map((wait) => (
              <li key={wait.kind}>
                <Tile kind={wait.kind} size={28} />
                <span>
                  <b>{kindName(wait.kind)}</b>
                  {wait.won_on ? " (the tile you won on)" : ""}: {copiesText(wait.copies)}.
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : improve.length ? (
        <>
          <p>
            <b>Tiles that would have moved you forward:</b>
          </p>
          <ul className={styles.reviewWaits}>
            {improve.map((entry) => (
              <li key={entry.kind}>
                <Tile kind={entry.kind} size={28} />
                <span>
                  <b>{kindName(entry.kind)}</b>: {copiesText(entry.copies)}.
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {moments.length ? (
        <ul className={styles.moments} aria-label="Moments from the hand">
          {moments.map(({ moment, text }) => {
            const kind = momentKind(moment);
            return (
              <li key={moment.code}>
                {kind !== null ? <Tile kind={kind} size={28} /> : null}
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
