"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { fmtNumber } from "@/app/lib/format";
import { points, seatLabel, sha256Hex, signed } from "@/app/lib/games/mahjong/table-model";
import type { MahjongTable, SeatIndex } from "@/app/lib/games/mahjong/types";
import { scoreText } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];

function Seed({ seed, hash }: { seed: string; hash: string }) {
  const [state, setState] = useState<"checking" | "match" | "differs" | "unknown">("checking");
  useEffect(() => {
    let cancelled = false;
    void sha256Hex(seed).then((digest) => {
      if (!cancelled) setState(digest === null ? "unknown" : digest === hash ? "match" : "differs");
    });
    return () => {
      cancelled = true;
    };
  }, [seed, hash]);
  return (
    <details className={styles.seed}>
      <summary>
        The shuffle, revealed <small>{state === "match" ? "matches the hash published before the first deal" : state === "differs" ? "does not match the published hash" : state === "checking" ? "checking…" : "open to compare"}</small>
      </summary>
      <p>Every wall in this game came from one secret seed. Its hash was published when the game started; now the seed is out, and anyone can check it hashes to the same value.</p>
      <dl>
        <dt>Seed</dt>
        <dd>{seed}</dd>
        <dt>SHA-256 published at the start</dt>
        <dd>{hash}</dd>
      </dl>
    </details>
  );
}

export type GameOverProps = {
  table: MahjongTable;
  seatStyles: SeatStyle[];
  me: SeatIndex | null;
  onAgain: (() => void) | null;
  againBusy: boolean;
  signedIn: boolean;
};

/** The end of a game: standings, rating and prizes, the revealed seed, and where to go next. */
export function GameOver({ table, seatStyles, me, onAgain, againBusy, signedIn }: GameOverProps) {
  const result = table.result;
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  if ("cancelled" in result) {
    const why: Record<string, string> = { empty: "Everyone left before it started.", not_started: "It couldn’t start.", maintenance: "Tables closed for maintenance.", left: "You left the table.", restart: "The server restarted." };
    return (
      <section className={styles.over} aria-label="Table closed">
        <h2>Table closed</h2>
        <p>{why[result.cancelled] ?? "This table was closed."} Any entry fee went back to your Credit.</p>
        <div className={styles.overLinks}>
          <Link href="/games/mahjong" className={styles.next}>
            Back to the lobby
          </Link>
        </div>
      </section>
    );
  }
  const mine = me !== null ? result.standings.find((line) => line.seat === me) : null;
  const replayHref = result.replay ? `/games/mahjong/replay/${result.replay}` : null;
  const share = async () => {
    const url = replayHref ? `${window.location.origin}${replayHref}` : window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "Mahjong on NASFAQ", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <section className={styles.over} aria-label="Game over">
      <header>
        <small>Game over</small>
        <h2>{mine ? `You finished ${ORDINAL[mine.place]}` : `${seatLabel(table.seats[result.standings[0].seat])} wins`}</h2>
      </header>
      <ol className={styles.standings}>
        {result.standings.map((line) => {
          const seat = table.seats[line.seat];
          const delta = line.rating_before !== null && line.rating_after !== null ? line.rating_after - line.rating_before : null;
          return (
            <li key={line.seat} data-me={me === line.seat || undefined} style={{ "--tal": seatStyles[line.seat]?.color } as CSSProperties}>
              <b className={styles.place}>{line.place}</b>
              <span className={styles.who}>
                {seatLabel(seat)}
                {seat?.bot ? <small> bot</small> : null}
              </span>
              <span className={styles.final} title="Final points">
                {points(line.points)}
              </span>
              <b className={styles.delta} data-dir={line.score > 0 ? "up" : line.score < 0 ? "down" : undefined} title="Game score: (points − 30,000) / 1,000 plus the placement bonus">
                {line.score > 0 ? "+" : line.score < 0 ? "−" : ""}
                {Math.abs(line.score).toFixed(1)}
              </b>
              {delta !== null ? (
                <span className={styles.rating} title={`Rating ${line.rating_before} to ${line.rating_after}`}>
                  <small>rating</small>{" "}
                  <b data-dir={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>{signed(delta)}</b>
                </span>
              ) : null}
              {line.payout > 0 ? (
                <span className={styles.prize}>
                  <small>prize</small> <b>{fmtNumber(line.payout, "$")}</b>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {table.game?.history.length ? (
        <details className={styles.history}>
          <summary>The hands</summary>
          <ol>
            {table.game.history.map((entry) => (
              <li key={entry.index}>
                <b>{entry.label}</b>
                <span>
                  {entry.result.type === "win"
                    ? entry.result.wins.map((win) => `${seatLabel(table.seats[win.seat])} ${win.from === null ? "tsumo" : "ron"} ${scoreText(win)}`).join(", ")
                    : "Draw"}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <Seed seed={result.seed} hash={result.seed_hash} />
      <div className={styles.overLinks}>
        {onAgain ? (
          <button type="button" className={styles.next} onClick={onAgain} disabled={againBusy}>
            {againBusy ? "Dealing…" : "Play again"}
          </button>
        ) : null}
        {replayHref ? (
          <Link href={replayHref} className={styles.plain}>
            Watch the replay
          </Link>
        ) : null}
        <button type="button" className={styles.plain} onClick={share}>
          {copied ? "Link copied" : "Share"}
        </button>
        <Link href="/games/mahjong" className={styles.plain}>
          Lobby
        </Link>
      </div>
      {!signedIn ? (
        <p className={styles.nudge}>
          Like it? <Link href="/register">Make an account</Link> to keep a rating, climb the ladder and play real people.
        </p>
      ) : null}
    </section>
  );
}
