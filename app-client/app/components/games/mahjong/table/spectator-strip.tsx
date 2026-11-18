"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { FaEye } from "react-icons/fa6";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { gameErrorText } from "@/app/lib/games/errors";
import { pickGameWinner } from "@/app/lib/games/mahjong/api";
import { seatLabel, seatsBySide, SIDES } from "@/app/lib/games/mahjong/table-model";
import type { MahjongTable, SeatIndex } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

/** For people at the rail: who is watching, a free pick for the winner, and a nudge to sign up. */
export function SpectatorStrip({
  table,
  seatStyles,
  bottom,
  signedIn,
  verified,
  myPick,
  onPick,
}: {
  table: MahjongTable;
  seatStyles: SeatStyle[];
  bottom: SeatIndex;
  signedIn: boolean;
  verified: boolean;
  myPick: number | null;
  onPick: (seat: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sides = seatsBySide(bottom);
  const total = table.picks.reduce((sum, count) => sum + count, 0);

  const pick = async (seat: number) => {
    setBusy(true);
    setError(null);
    try {
      await pickGameWinner(table.id, seat);
      onPick(seat);
    } catch (caught) {
      setError(gameErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.strip} aria-label="Spectators">
      <p className={styles.stripHead}>
        <span className={styles.eye}>
          <FaEye aria-hidden="true" /> <b>{table.spectators}</b> watching
        </span>
        <span>You’re watching: every hand but yours is face down.</span>
      </p>
      {table.picks_open ? (
        <div className={styles.picks}>
          <h3>Who wins this game?</h3>
          <div className={styles.pickRow}>
            {SIDES.map((side) => {
              const seat = sides[side];
              const entry = table.seats[seat];
              if (!entry) return null;
              const share = total ? Math.round((table.picks[seat] / total) * 100) : 0;
              return (
                <button
                  key={seat}
                  type="button"
                  className={styles.pick}
                  data-on={myPick === seat || undefined}
                  style={{ "--tal": seatStyles[seat]?.color, "--share": `${share}%` } as CSSProperties}
                  disabled={!signedIn || !verified || busy}
                  onClick={() => pick(seat)}
                >
                  <span>{seatLabel(entry)}</span>
                  <b>{table.picks[seat]}</b>
                </button>
              );
            })}
          </div>
          <p className={styles.fine}>Free and for bragging rights. Picks close when the second hand starts, and they never pay.</p>
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {!signedIn ? (
        <p className={styles.nudge}>
          <Link href="/register">Make an account</Link> to pick a winner, send reactions and cheer a seat, or <Link href="/games/mahjong">play a practice game</Link>.
        </p>
      ) : !verified ? (
        <p className={styles.nudge}>Verify your email to pick, react and cheer.</p>
      ) : null}
    </section>
  );
}
