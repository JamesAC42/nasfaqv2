"use client";

import { useEffect, useRef, useState } from "react";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { VerificationRequiredNotice } from "@/app/components/common/verification-required-notice";
import { fmtCountdown, fmtPayout, nextRung } from "@/app/components/games/ticker-tap/board-math";
import { POINTS, PAYOUT_SPLIT } from "@/app/components/games/ticker-tap/engine";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import type { TickerTapBoard } from "@/app/lib/games/types";
import { isCalm } from "@/app/providers/motion-provider";
import styles from "@/app/components/games/ticker-tap/ticker-tap.module.scss";

type LobbyProps = {
  board: TickerTapBoard | null;
  boardError: string | null;
  signedIn: boolean;
  userId: string | number | null;
  needsVerification: boolean;
  fee: number;
  starting: boolean;
  startError: string | null;
  onPlay: () => void;
  /** Hide the play block (the results panel above has its own). */
  compactHero?: boolean;
};

function useClock(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return now;
}

/** Counts a hero number up when it first arrives or grows. Calm mode just shows it. */
function useCountUp(value: number | null, durationMs = 900) {
  const [shown, setShown] = useState<number | null>(value);
  const shownRef = useRef<number | null>(value);
  useEffect(() => {
    if (value === null) return;
    const from = shownRef.current ?? 0;
    const set = (next: number) => {
      shownRef.current = next;
      setShown(next);
    };
    if (isCalm() || from === value) {
      set(value);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - started) / durationMs);
      set(from + (value - from) * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return shown;
}

export function Lobby({ board, boardError, signedIn, userId, needsVerification, fee, starting, startError, onPlay, compactHero = false }: LobbyProps) {
  const now = useClock();
  const pool = board?.week.pool ?? null;
  const shownPool = useCountUp(pool);
  const endsAt = board ? new Date(board.week.ends_at).getTime() : null;
  const me = board?.me ?? null;
  const shareToPool = board ? board.week.share_bps / 100 : 90;
  const rung = nextRung(board, me?.score ?? null, userId);
  const top = board?.leaderboard.slice(0, 10) ?? [];
  const seats = Array.from({ length: 10 }, (_, index) => top[index] ?? null);
  // Alone on the board, the whole pool (plus your own entry's share) is yours.
  const firstPrize = board ? board.week.pool + (fee * shareToPool) / 100 : null;

  return (
    <div className={styles.lobby}>
      <section className={`${styles.hero} ${compactHero ? styles.heroCompact : ""}`} aria-labelledby="tt-pool">
        <div className={styles.poolBlock}>
          <h2 id="tt-pool" className={styles.poolLabel}>
            This week&apos;s pool
          </h2>
          <p className={styles.pool}>
            <span className={styles.poolDollar}>$</span>
            {shownPool === null ? "—" : fmtNumber(Math.floor(shownPool))}
          </p>
          <dl className={styles.poolFacts}>
            <div>
              <dt>Runs</dt>
              <dd>{board ? fmtInteger(board.week.runs) : "…"}</dd>
            </div>
            <div>
              <dt>Pays out in</dt>
              <dd>{endsAt ? fmtCountdown(endsAt - now) : "…"}</dd>
            </div>
            <div>
              <dt>Paid to</dt>
              <dd>Top 10</dd>
            </div>
            <div>
              <dt>Entry</dt>
              <dd>
                {fmtNumber(fee, "$")} <small>· {shareToPool}% to pool</small>
              </dd>
            </div>
          </dl>
          {boardError ? <p className={styles.inlineError}>{boardError}</p> : null}
        </div>

        {!compactHero ? (
          <div className={styles.playBlock}>
            {signedIn ? (
              <>
                <div className={styles.myBest}>
                  <span className={styles.myBestLabel}>Your best this week</span>
                  {me ? (
                    <p>
                      <b className={styles.myScore}>{fmtInteger(me.score)}</b>
                      <span className={styles.myRank}>#{me.rank}</span>
                      {me.rank <= 10 ? (
                        <span className={styles.myPay}>
                          proj. <b>{fmtPayout(board?.leaderboard.find((row) => row.rank === me.rank)?.projected_payout)}</b>
                        </span>
                      ) : (
                        <span className={styles.myPay}>outside the money</span>
                      )}
                    </p>
                  ) : (
                    <p className={styles.noRun}>No run on the board yet.</p>
                  )}
                  {rung ? (
                    <p className={styles.rung}>
                      Beat <b>{fmtInteger(rung.beat)}</b> ({rung.username}) to take <b>#{rung.rank}</b>
                    </p>
                  ) : board && (!me || me.rank === 1) ? (
                    <p className={styles.rung}>{me ? "You're on top. Defend it." : <>Board&apos;s empty. First run takes #1{firstPrize !== null ? <> and all <b>{fmtPayout(firstPrize)}</b></> : null}.</>}</p>
                  ) : null}
                </div>
                <button type="button" className={styles.playButton} onClick={onPlay} disabled={starting || !board}>
                  {starting ? "Opening the tape…" : `Play · ${fmtNumber(fee, "$")}`}
                </button>
                {startError ? (
                  <p className={styles.inlineError} role="alert">
                    {startError}
                  </p>
                ) : null}
                {needsVerification ? <VerificationRequiredNotice action="play for the pool" compact /> : null}
              </>
            ) : (
              <SignInToPlay what="chase the pool" />
            )}
          </div>
        ) : null}
      </section>

      <div className={styles.grid}>
        <section className={styles.board} aria-labelledby="tt-board">
          <h2 id="tt-board" className={styles.secHead}>
            Top 10 <small>projected payouts</small>
          </h2>
          <ol className={styles.ladder}>
            {seats.map((row, index) => {
              const rank = index + 1;
              const mine = row && String(row.user_id) === String(userId);
              return (
                <li key={rank} className={styles.rung10} data-rank={rank} data-mine={mine || undefined} data-open={!row || undefined}>
                  <span className={styles.rankNum}>{rank}</span>
                  {row ? (
                    <>
                      <span className={styles.who}>
                        <PlayerAvatar username={row.username} color={row.profile_color} size={22} />
                        <span>{row.username}</span>
                        {mine ? <em>you</em> : null}
                      </span>
                      <span className={styles.score}>{fmtInteger(row.score)}</span>
                      <span className={styles.payout}>{fmtPayout(row.projected_payout)}</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.openSeat}>Open seat</span>
                      <span className={styles.score}>—</span>
                      <span className={styles.share}>{PAYOUT_SPLIT[index]}%</span>
                    </>
                  )}
                  <i className={styles.shareBar} style={{ "--share": `${(PAYOUT_SPLIT[index] / PAYOUT_SPLIT[0]) * 100}%` } as React.CSSProperties} aria-hidden="true" />
                </li>
              );
            })}
          </ol>
          {me && me.rank > 10 ? (
            <p className={styles.meBelow}>
              You: <b>#{me.rank}</b> · {fmtInteger(me.score)}
            </p>
          ) : null}
          <p className={styles.fine}>Split 30/20/12/9/7/6/5/4/4/3. Fewer than ten on the board and the shares scale up. One entry per player: your best run counts.</p>
        </section>

        <div className={styles.side}>
          <section className={styles.legend} aria-labelledby="tt-legend">
            <h2 id="tt-legend" className={styles.secHead}>
              How it scores
            </h2>
            <ul className={styles.legendList}>
              <li data-kind="up">
                <span className={styles.chip}>▲</span>
                <span>Green: tap it</span>
                <b>+{POINTS.up}</b>
              </li>
              <li data-kind="gold">
                <span className={styles.chip}>★</span>
                <span>Gold: rare, grab it</span>
                <b>+{POINTS.gold}</b>
              </li>
              <li data-kind="down">
                <span className={styles.chip}>▼</span>
                <span>Red: hands off</span>
                <b>{POINTS.down}</b>
              </li>
              <li data-kind="miss">
                <span className={styles.chip}>·</span>
                <span>Tap an empty lane</span>
                <b>{POINTS.miss}</b>
              </li>
            </ul>
            <p className={styles.comboRule}>
              <b>Combo</b> every 5 in a row: <span>×1.5</span> → <span>×2</span> → <span>×2.5</span> → <span>×3</span>. A red, a whiff or a green that gets away resets it.
            </p>
            <p className={styles.keys}>
              45 seconds, five lanes, and it gets faster. Keys <kbd>1</kbd>–<kbd>5</kbd> or <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd>.
            </p>
          </section>

          <section className={styles.lastWeek} aria-labelledby="tt-last">
            <h2 id="tt-last" className={styles.secHead}>
              Last week&apos;s winners
            </h2>
            {board && board.last_week.length ? (
              <ol className={styles.winners}>
                {board.last_week.map((row) => (
                  <li key={`${row.week_start}-${row.rank}`}>
                    <span className={styles.rankNum} data-rank={row.rank}>
                      {row.rank}
                    </span>
                    <span className={styles.who}>
                      <PlayerAvatar username={row.username} color={row.profile_color} size={20} />
                      <span>{row.username}</span>
                    </span>
                    <span className={styles.score}>{fmtInteger(row.score)}</span>
                    <span className={styles.paid}>+{fmtPayout(row.payout)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.empty}>{board ? "Nobody's been paid yet. This week's pool is the first." : "…"}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
