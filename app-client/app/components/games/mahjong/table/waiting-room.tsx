"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { SeatPortrait, type SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { fmtNumber } from "@/app/lib/format";
import { RANK_NAMES, seatLabel } from "@/app/lib/games/mahjong/table-model";
import { seatsFilled, type MahjongTable } from "@/app/lib/games/mahjong/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

const TITLE: Record<string, string> = { ranked: "Quick match", friend: "Friend room", stakes: "Stakes table", tournament: "Tournament table" };
const PLACES = ["1st", "2nd", "3rd", "4th"];

const clock = (ms: number | null) => {
  if (ms === null) return null;
  const total = Math.ceil(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}` : `${total}s`;
};

export type WaitingRoomProps = {
  table: MahjongTable;
  seatStyles: SeatStyle[];
  mySeat: number | null;
  userId: number | null;
  signedIn: boolean;
  verified: boolean;
  busy: string | null;
  error: string | null;
  onSit: () => void;
  onLeave: () => void;
  onStart: () => void;
};

/** A table that hasn't dealt: who is here, when it starts, how to bring a friend, how to leave. */
export function WaitingRoom({ table, seatStyles, mySeat, userId, signedIn, verified, busy, error, onSit, onLeave, onStart }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const toStart = useRemaining(table.starts_at, 500);
  const toClose = useRemaining(table.expires_at, 1000);
  const filled = seatsFilled(table.seats);
  const isHost = userId !== null && table.host_user_id === userId;
  const seated = mySeat !== null;
  const open = table.seats.some((seat) => !seat);
  const canSit = !seated && open && (table.kind === "ranked" || table.kind === "friend" || table.kind === "stakes");
  const link = typeof window !== "undefined" && table.room_code ? `${window.location.origin}/games/mahjong/room/${table.room_code}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the link is selectable on the page */
    }
  };

  let startLine: string | null = null;
  if (table.kind === "ranked") startLine = toStart !== null ? (filled === 4 ? `Dealing in ${clock(toStart)}` : `Bots fill the empty seats in ${clock(toStart)}`) : "Waiting for the first player";
  else if (table.kind === "stakes") startLine = toStart !== null ? `All four seated: dealing in ${clock(toStart)}` : `Needs four players: ${4 - filled} more. Paid tables never use bots.`;
  else if (table.kind === "tournament") startLine = "Everyone is seated. The first hand deals in a few seconds.";
  else if (table.kind === "friend") startLine = isHost ? "Start when your friends are in. Empty seats are filled by bots." : "Waiting for the host to start.";

  return (
    <section className={styles.waiting} aria-label="Waiting room">
      <header>
        <small>{table.length === "south" ? "East-South" : "East-only"} · {table.speed}</small>
        <h2>{TITLE[table.kind] ?? "Table"}</h2>
        {startLine ? <p className={styles.startLine}>{startLine}</p> : null}
      </header>

      <ol className={styles.seatList}>
        {table.seats.map((seat, index) => (
          <li key={index} data-open={!seat || undefined} data-me={mySeat === index || undefined} style={{ "--tal": seatStyles[index]?.color } as CSSProperties}>
            {seat ? <SeatPortrait seat={seat} pose="idle" size={40} color={seatStyles[index]?.color} /> : <span className={styles.emptyDisc} aria-hidden="true" />}
            <span className={styles.seatWho}>
              <b>{seat ? seatLabel(seat) : "Open seat"}</b>
              <small>{seat ? [seat.rank ? RANK_NAMES[seat.rank] : null, seat.rating !== null ? `${seat.rating}` : null, table.host_user_id !== null && seat.user_id === table.host_user_id ? "host" : null].filter(Boolean).join(" · ") : "Waiting for a player"}</small>
            </span>
          </li>
        ))}
      </ol>

      {table.fee > 0 && table.prizes ? (
        <div className={styles.stakes}>
          <h3>Stakes: {fmtNumber(table.fee, "$")} to sit</h3>
          <ul>
            {table.prizes.map((prize, index) => (
              <li key={index}>
                <span>{PLACES[index]}</span>
                <b>{prize > 0 ? fmtNumber(prize, "$") : "nothing"}</b>
              </li>
            ))}
          </ul>
          <p className={styles.fine}>Prizes are fixed by where you finish, not by points. Leaving before it deals refunds your entry fee. Credit only, never Cash.</p>
        </div>
      ) : null}

      {table.kind === "friend" && table.room_code ? (
        <div className={styles.invite}>
          <h3>Bring a friend</h3>
          <div className={styles.linkRow}>
            <input readOnly value={link} aria-label="Room link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={styles.plain} onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className={styles.fine}>Room code <b>{table.room_code}</b>. Anyone with the link can watch; verified players can take an open seat.</p>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.overLinks}>
        {isHost && table.kind === "friend" ? (
          <button type="button" className={styles.next} onClick={onStart} disabled={busy !== null}>
            {busy === "start" ? "Dealing…" : "Start the game"}
          </button>
        ) : null}
        {canSit && signedIn && verified ? (
          <button type="button" className={styles.next} onClick={onSit} disabled={busy !== null}>
            {busy === "sit" ? "Sitting…" : table.fee > 0 ? `Sit down for ${fmtNumber(table.fee, "$")}` : "Sit down"}
          </button>
        ) : null}
        {seated ? (
          <button type="button" className={styles.plain} onClick={onLeave} disabled={busy !== null}>
            {table.fee > 0 ? "Leave and get your fee back" : "Leave"}
          </button>
        ) : null}
        <Link href="/games/mahjong" className={styles.plain}>
          Lobby
        </Link>
      </div>
      {!seated && canSit && !signedIn ? (
        <p className={styles.nudge}>
          <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to take a seat. You can watch from here.
        </p>
      ) : null}
      {!seated && canSit && signedIn && !verified ? <p className={styles.nudge}>Verify your email to sit at a table.</p> : null}
      {toClose !== null && toClose < 120_000 ? <p className={styles.fine}>This table closes in {clock(toClose)} if it doesn’t fill.</p> : null}
    </section>
  );
}
