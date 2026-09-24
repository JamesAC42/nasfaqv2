"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { FiCheck, FiCopy, FiEye } from "react-icons/fi";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { isVerificationRequiredError, VerificationRequiredNotice } from "@/app/components/common/verification-required-notice";
import { cancelTable, fetchTable, forfeitTable } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { GameTable, TableGame, TablePlayer } from "@/app/lib/games/types";
import { primeChannel, useGamesChannel } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { fmtNumber } from "@/app/lib/format";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/tables/table-kit.module.scss";

// Shared pieces for the two-player staked tables (Oshi Card Duel, High-low): the live table
// hook, seats, the waiting room, forfeit, and the end-of-match moment.

export const GAME_PATH: Record<TableGame, string> = { "oshi-duel": "/games/duel", "high-low": "/games/high-low" };
export const GAME_NAME: Record<TableGame, string> = { "oshi-duel": "Oshi Card Duel", "high-low": "High-low" };

export const money = (value: number | null | undefined) => fmtNumber(Number(value ?? 0), "$");

export const sameId = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

export function toMs(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isDone(table: GameTable | null | undefined) {
  const status = table?.status as string | undefined;
  return status === "done" || status === "completed";
}

export function fmtClock(ms: number | null) {
  if (ms === null) return "—";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type TableMessage = { type?: string; table?: GameTable; spectators?: number };

/**
 * Live state for `table:{id}`: seeded from GET /tables/:id, then pushed by the socket. The channel
 * also carries `{type: "spectators"}` pings, so the last full table is kept here and pushes older
 * than what we hold (by the table's server_time) are ignored.
 */
export function useLiveTable(id: number) {
  const valid = Number.isInteger(id) && id > 0;
  const channel = valid ? `table:${id}` : null;
  const live = useGamesChannel<TableMessage>(channel);
  const [table, setTable] = useState<GameTable | null>(null);
  const [spectators, setSpectators] = useState(0);
  const [error, setError] = useState<string | null>(valid ? null : "table_not_found");
  const [seen, setSeen] = useState<TableMessage | null>(null);

  if (live !== seen) {
    setSeen(live);
    if (live?.type === "table" && live.table && Number(live.table.id) === id) {
      if (!table || (live.table.server_time ?? 0) >= (table.server_time ?? 0)) {
        setTable(live.table);
        setSpectators(live.table.spectators ?? 0);
      }
    } else if (live?.type === "spectators" && typeof live.spectators === "number") {
      setSpectators(live.spectators);
    }
  }

  useEffect(() => {
    if (!channel) return;
    let alive = true;
    fetchTable(id)
      .then(({ table: fetched }) => {
        if (alive) primeChannel(channel, { type: "table", table: fetched, server_time: fetched.server_time });
      })
      .catch((reason) => {
        if (alive) setError(String((reason as Error).message || reason));
      });
    return () => {
      alive = false;
    };
  }, [channel, id]);

  return { table, spectators, error, channel };
}

/** Feed an action response into the table channel so the board moves before the push lands. */
export function primeTable(table: GameTable) {
  primeChannel(`table:${table.id}`, { type: "table", table, server_time: table.server_time });
}

/** Which seat the signed-in user holds at this table (-1 when spectating). */
export function useMySeat(table: GameTable | null) {
  const { user } = useAuth();
  if (!table || !user) return -1;
  const player = table.players.find((entry) => sameId(entry.user_id, user.id));
  return player ? player.seat : -1;
}

/** Refresh cash once when a table this player sat at finishes or is cancelled. */
export function useSettleRefresh(table: GameTable | null, mySeat: number) {
  const status = table?.status;
  useEffect(() => {
    if (mySeat < 0) return;
    if (status === "cancelled" || status === ("done" as string) || status === "completed") {
      void useProfileStore.getState().fetchPortfolio();
    }
  }, [status, mySeat]);
}

export function ErrorLine({ error, action = "play for money" }: { error: unknown; action?: string }) {
  if (!error) return null;
  if (isVerificationRequiredError(error)) return <VerificationRequiredNotice action={action} compact />;
  return (
    <p className={styles.error} role="alert">
      {gameErrorText(error)}
    </p>
  );
}

export function PlayerTag({ player, size = 26, sub }: { player: TablePlayer | null | undefined; size?: number; sub?: ReactNode }) {
  if (!player) {
    return (
      <span className={styles.player} data-empty="true">
        <span className={styles.emptySeat} style={{ width: size, height: size }} aria-hidden="true" />
        <span className={styles.playerText}>
          <b>Open seat</b>
          {sub ? <small>{sub}</small> : null}
        </span>
      </span>
    );
  }
  return (
    <span className={styles.player}>
      <PlayerAvatar username={player.username} pictureUrl={player.profile_picture_url} color={player.profile_color} size={size} />
      <span className={styles.playerText}>
        <Link href={`/profile/${encodeURIComponent(player.username)}`} className={styles.playerName}>
          {player.username}
        </Link>
        {sub ? <small>{sub}</small> : null}
      </span>
    </span>
  );
}

export function SpectatorCount({ count }: { count: number }) {
  return (
    <span className={styles.watchers} title="Watching now">
      <FiEye aria-hidden="true" />
      <b>{count}</b>
      <span className={styles.srOnly}>watching</span>
    </span>
  );
}

/** Stake / pot / winner-takes strip for a table header. */
export function StakeStrip({ table, spectators }: { table: GameTable; spectators: number }) {
  return (
    <dl className={styles.stakeStrip}>
      <div>
        <dt>Stake</dt>
        <dd>{table.stake > 0 ? money(table.stake) : "Friendly"}</dd>
      </div>
      <div>
        <dt>Winner takes</dt>
        <dd>{table.stake > 0 ? money(table.payout_if_win) : "Bragging rights"}</dd>
      </div>
      <div>
        <dt>Watching</dt>
        <dd>
          <SpectatorCount count={spectators} />
        </dd>
      </div>
    </dl>
  );
}

function ShareLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // window is only known after mount; the share link needs the real origin.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const url = `${origin}${path}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={styles.share}>
      <label htmlFor="table-share">Share this table</label>
      <div>
        <input id="table-share" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" onClick={() => void copy()} aria-label="Copy table link">
          {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function ExpiresIn({ at, prefix = "Closes in" }: { at: string | number | null | undefined; prefix?: string }) {
  const left = useRemaining(toMs(at), 1000);
  if (left === null) return null;
  return (
    <span className={styles.expires} data-urgent={left < 60_000 || undefined}>
      {prefix} <b>{fmtClock(left)}</b>
    </span>
  );
}

/**
 * The waiting room: an open table with one seat filled. The host can cancel (refund); anyone
 * else gets `joinSlot` (the join button, plus a deck picker for the duel).
 */
export function WaitingRoom({ table, mySeat, joinSlot }: { table: GameTable; mySeat: number; joinSlot?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const host = table.players[0];
  const path = `${GAME_PATH[table.game]}/${table.id}`;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelTable(table.id);
      void useProfileStore.getState().fetchPortfolio();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.waiting} aria-labelledby="waiting-title">
      <div className={styles.waitingSeats}>
        <PlayerTag player={host} size={40} sub={mySeat === 0 ? "you, stake in" : "waiting"} />
        <span className={styles.vs} aria-hidden="true">
          VS
        </span>
        <PlayerTag player={null} size={40} sub={table.stake > 0 ? `puts up ${money(table.stake)}` : "friendly"} />
      </div>
      <div className={styles.waitingBody}>
        <h2 id="waiting-title" className={styles.waitingTitle}>
          {mySeat === 0 ? "Waiting for a challenger" : `${host?.username ?? "Someone"} wants a match`}
          <span className={styles.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </h2>
        <p className={styles.waitingLine}>
          {table.stake > 0 ? (
            <>
              Both put up <b>{money(table.stake)}</b>. Winner takes <b>{money(table.payout_if_win)}</b>.
            </>
          ) : (
            <>Friendly match. No money on it.</>
          )}{" "}
          <ExpiresIn at={table.expires_at} />
        </p>
        {mySeat === 0 ? (
          <>
            <ShareLink path={path} />
            <div className={styles.waitingActions}>
              <button type="button" className={styles.secondary} onClick={() => void cancel()} disabled={busy}>
                {busy ? "Cancelling…" : table.stake > 0 ? `Cancel · refund ${money(table.stake)}` : "Cancel table"}
              </button>
            </div>
            <ErrorLine error={error} />
          </>
        ) : (
          joinSlot
        )}
      </div>
    </section>
  );
}

/** Two-step forfeit: no confirm() popups. */
export function ForfeitControl({ table, disabled }: { table: GameTable; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function forfeit() {
    setBusy(true);
    setError(null);
    try {
      const { table: next } = await forfeitTable(table.id);
      primeTable(next);
      setArmed(false);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.forfeit}>
      {armed ? (
        <div className={styles.forfeitConfirm} role="group" aria-label="Confirm forfeit">
          <span>{table.stake > 0 ? `Walk away and lose ${money(table.stake)}?` : "Concede the match?"}</span>
          <button type="button" className={styles.danger} onClick={() => void forfeit()} disabled={busy || disabled}>
            {busy ? "…" : "Yes, forfeit"}
          </button>
          <button type="button" className={styles.linkish} onClick={() => setArmed(false)} disabled={busy}>
            Keep playing
          </button>
        </div>
      ) : (
        <button type="button" className={styles.linkish} onClick={() => setArmed(true)} disabled={disabled}>
          Forfeit
        </button>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** The end-of-match moment. Players see their own result; spectators see who won. */
export function ResultMoment({ table, mySeat, detail }: { table: GameTable; mySeat: number; detail?: ReactNode }) {
  const result = table.result ?? {};
  const winnerSeat = result.winner_seat ?? (table.state as { winner?: number | null } | null)?.winner ?? null;
  const reason = result.reason ?? (table.state as { done_reason?: string | null } | null)?.done_reason ?? null;
  const payout = Number(result.payout ?? (winnerSeat === null ? 0 : table.payout_if_win));
  const winner = winnerSeat === null ? null : table.players.find((player) => player.seat === winnerSeat) ?? null;
  const loser = winnerSeat === null ? null : table.players.find((player) => player.seat !== winnerSeat) ?? null;
  const staked = table.stake > 0;

  let tone: "win" | "lose" | "draw" | "watch" = "watch";
  let headline = "";
  let amount: string | null = null;
  let line: ReactNode = null;

  if (winnerSeat === null) {
    tone = "draw";
    headline = "DRAW";
    line = staked ? <>Stakes refunded. {money(table.stake)} back to each.</> : "Dead even.";
  } else if (mySeat >= 0) {
    const won = mySeat === winnerSeat;
    tone = won ? "win" : "lose";
    headline = won ? "YOU WIN" : "YOU LOSE";
    if (staked) amount = won ? `+${money(payout)}` : `−${money(table.stake)}`;
    line =
      reason === "forfeit"
        ? won
          ? `${loser?.username ?? "They"} forfeited.`
          : "You forfeited."
        : won
          ? staked
            ? <>Pot {money(table.stake * 2)}, 5% to the house.</>
            : "Friendly win. Nothing on it but pride."
          : `${winner?.username ?? "They"} took it.`;
  } else {
    headline = `${winner?.username ?? "Seat " + (winnerSeat + 1)} WINS`;
    if (staked) amount = money(payout);
    line = reason === "forfeit" ? `${loser?.username ?? "The other side"} forfeited.` : `Over ${loser?.username ?? "the other side"}.`;
  }

  return (
    <div className={styles.moment} data-tone={tone} role="status" aria-live="polite">
      <span className={styles.momentKicker}>Match over</span>
      <strong className={styles.momentHead}>{headline}</strong>
      {amount ? <span className={styles.momentAmount}>{amount}</span> : null}
      {line ? <p className={styles.momentLine}>{line}</p> : null}
      {detail}
      <div className={styles.momentActions}>
        <Link href={GAME_PATH[table.game]} className={styles.primary}>
          {mySeat >= 0 ? "New table" : "Back to lobby"}
        </Link>
        {mySeat >= 0 ? (
          <Link href={GAME_PATH[table.game]} className={styles.secondary}>
            Lobby
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** A cancelled or missing table. */
export function TableGone({ game, cancelled }: { game: TableGame; cancelled?: string | null }) {
  const copy =
    cancelled === "expired"
      ? "Nobody took the seat in time. The stake went back to the host."
      : cancelled === "host_cancelled"
        ? "The host pulled the table. Stake refunded."
        : cancelled === "server_restart"
          ? "The server restarted mid-match. Everyone got their stake back."
          : cancelled
            ? "This table closed. Any stakes were refunded."
            : "No table here. It might have finished a while ago.";
  return (
    <div className={styles.gone}>
      <strong>{cancelled ? "Table closed" : "Table not found"}</strong>
      <p>{copy}</p>
      <Link href={GAME_PATH[game]} className={styles.primary}>
        Back to the lobby
      </Link>
    </div>
  );
}

/** Pips for "first to N". */
export function WinPips({ wins, needed, label }: { wins: number; needed: number; label: string }) {
  return (
    <span className={styles.pips} role="img" aria-label={`${label}: ${wins} of ${needed} round wins`}>
      {Array.from({ length: needed }, (_, index) => (
        <i key={index} data-on={index < wins || undefined} />
      ))}
    </span>
  );
}

export { styles as kitStyles };
