"use client";

import { useEffect, useState } from "react";
import { fmtPayout, placementFor } from "@/app/components/games/ticker-tap/board-math";
import type { RunEnd } from "@/app/components/games/ticker-tap/run-stage";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import type { TickerTapBoard, TickerTapSubmitResponse } from "@/app/lib/games/types";
import styles from "@/app/components/games/ticker-tap/ticker-tap.module.scss";

export type PostedRun = {
  sessionId: number;
  /** performance.now() when the session was created; the server wants 42 s before a submit. */
  createdAt: number;
  end: RunEnd;
  status: "waiting" | "posting" | "done" | "error";
  submitAt: number;
  response?: TickerTapSubmitResponse;
  error?: string;
};

type ResultsProps = {
  run: PostedRun;
  board: TickerTapBoard | null;
  userId: string | number | null;
  fee: number;
  starting: boolean;
  startError: string | null;
  onPlay: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

function useSecondsUntil(at: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [at]);
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function RunResults({ run, board, userId, fee, starting, startError, onPlay, onRetry, onDismiss }: ResultsProps) {
  const waitSeconds = useSecondsUntil(run.submitAt);
  const posted = run.status === "done" && run.response;
  const replay = posted ? run.response!.result.replay : run.end.local;
  const score = posted ? run.response!.session.score : run.end.local.score;
  const personalBest = posted ? run.response!.result.personal_best : false;
  const previousBest = posted ? run.response!.result.previous_best : null;
  const placement = placementFor(board, score, userId);
  const me = board?.me ?? null;
  const thisRunIsBest = !me || me.score <= score;
  const cut = board ? board.leaderboard.filter((row) => String(row.user_id) !== String(userId))[9] : undefined;

  const headline = run.end.quit ? "Bailed" : personalBest ? "New personal best" : score === 0 ? "Wiped out" : "Closing bell";
  const kicker = run.status === "done" ? (run.end.quit ? "Run quit · posted" : "Run posted") : run.status === "error" ? "Not posted" : run.status === "waiting" ? "Waiting on the clock" : "Posting";

  return (
    <section className={styles.results} data-pb={personalBest || undefined} aria-labelledby="tt-result-title">
      <div className={styles.resultsMain} aria-live="polite">
        <p className={styles.resKicker}>{kicker}</p>
        <h2 id="tt-result-title" className={styles.resTitle}>
          {headline}
        </h2>
        <p className={styles.resScore} data-pending={!posted || undefined}>
          {fmtInteger(score)}
          {personalBest ? <span className={styles.pbBadge}>PB</span> : null}
        </p>
        {run.status === "waiting" ? (
          <p className={styles.resNote}>
            The {fmtNumber(fee, "$")} is spent either way. Posting this score in <b>{waitSeconds}s</b>, when the run clock would have run out.
          </p>
        ) : run.status === "posting" ? (
          <p className={styles.resNote}>Checking the tape…</p>
        ) : run.status === "error" ? (
          <p className={styles.inlineError} role="alert">
            {run.error}{" "}
            <button type="button" className={styles.linkButton} onClick={onRetry}>
              Try again
            </button>
          </p>
        ) : (
          <p className={styles.resNote}>
            {thisRunIsBest ? (
              placement.inMoney ? (
                <>
                  Sits <b>#{placement.rank}</b> this week · projected <b className={styles.gain}>{fmtPayout(placement.payout)}</b> if it holds to Monday.
                </>
              ) : (
                <>
                  <b>#{placement.rank}</b> this week, outside the money.{cut ? <> The cut is <b>{fmtInteger(cut.score)}</b>.</> : null}
                </>
              )
            ) : me ? (
              <>
                Your best this week still stands: <b>{fmtInteger(me.score)}</b> at <b>#{me.rank}</b>
                {me.rank <= 10 ? (
                  <>
                    {" "}
                    · projected <b className={styles.gain}>{fmtPayout(board?.leaderboard.find((row) => row.rank === me.rank)?.projected_payout)}</b>
                  </>
                ) : null}
                .
              </>
            ) : null}
            {previousBest !== null && !personalBest ? <> All-time best: {fmtInteger(previousBest)}.</> : null}
          </p>
        )}
        {run.end.wasHidden ? <p className={styles.resHint}>The tab was hidden for part of that run; the tape kept going.</p> : null}
      </div>

      <dl className={styles.stats}>
        <div data-kind="up">
          <dt>Greens</dt>
          <dd>{replay.greens}</dd>
        </div>
        <div data-kind="gold">
          <dt>Golds</dt>
          <dd>{replay.golds}</dd>
        </div>
        <div data-kind="down">
          <dt>Reds hit</dt>
          <dd>{replay.reds}</dd>
        </div>
        <div>
          <dt>Whiffs</dt>
          <dd>{replay.misses}</dd>
        </div>
        <div>
          <dt>Got away</dt>
          <dd>{replay.escaped}</dd>
        </div>
        <div>
          <dt>Max combo</dt>
          <dd>{replay.max_combo}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{Math.round(replay.accuracy * 100)}%</dd>
        </div>
      </dl>

      <div className={styles.resActions}>
        <button type="button" className={styles.playButton} onClick={onPlay} disabled={starting || run.status === "waiting" || run.status === "posting"}>
          {starting ? "Opening the tape…" : `Play again · ${fmtNumber(fee, "$")}`}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onDismiss} disabled={run.status === "waiting" || run.status === "posting"}>
          Board
        </button>
        {startError ? (
          <p className={styles.inlineError} role="alert">
            {startError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
