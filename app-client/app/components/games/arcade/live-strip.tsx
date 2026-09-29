"use client";

import Link from "next/link";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { fmtAgo, fmtCash, fmtLeft, fmtStake } from "@/app/components/games/arcade/arcade-format";
import type { BlackjackLobbyRow, GameTable, RecentMatch, TableGame } from "@/app/lib/games/types";
import { useGamesConnected } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import styles from "@/app/components/games/arcade/arcade.module.scss";

const GAME_NAME: Record<TableGame, string> = { "oshi-duel": "Oshi duel", "high-low": "High-low" };
const GAME_PATH: Record<TableGame, string> = { "oshi-duel": "/games/duel", "high-low": "/games/high-low" };

type Props = {
  duel: GameTable[] | null;
  highLow: GameTable[] | null;
  blackjack: BlackjackLobbyRow[] | null;
  recent: (RecentMatch & { game: TableGame })[];
  me: string | null;
  signedIn: boolean;
};

export function LiveStrip({ duel, highLow, blackjack, recent, me, signedIn }: Props) {
  const connected = useGamesConnected();
  const tables = [...(duel ?? []), ...(highLow ?? [])];
  const playing = tables.filter((table) => table.status === "playing");
  const open = tables.filter((table) => table.status === "open");
  const bj = [...(blackjack ?? [])].sort((a, b) => b.seated - a.seated);
  const seatedBj = bj.reduce((sum, row) => sum + row.seated, 0);
  const players = playing.length * 2 + open.length + seatedBj;
  const loading = duel === null || highLow === null || blackjack === null;

  return (
    <section className={styles.live} aria-labelledby="arcade-live">
      <h2 id="arcade-live" className={styles.liveHead}>
        <span className={styles.liveTag} data-on={connected || undefined}>
          <i aria-hidden="true" />
          Live
        </span>
        <span className={styles.liveCount} aria-live="polite">
          {loading ? (
            "checking the floor…"
          ) : (
            <>
              <b>{players}</b> {players === 1 ? "player" : "players"} at <b>{playing.length + open.length + bj.filter((row) => row.seated > 0).length}</b> tables
            </>
          )}
        </span>
      </h2>

      <div className={styles.strip} role="list">
        {playing.map((table) => (
          <PlayingItem key={`p${table.id}`} table={table} me={me} />
        ))}
        {open.map((table) => (
          <OpenItem key={`o${table.id}`} table={table} me={me} signedIn={signedIn} />
        ))}
        {!loading && !open.length ? (
          <div className={`${styles.item} ${styles.itemHost}`} role="listitem">
            <span className={styles.itemKind}>No open tables</span>
            <span className={styles.itemMain}>Nobody&apos;s hosting. Be the one.</span>
            <span className={styles.itemLinks}>
              <Link href={signedIn ? "/games/duel" : "/login?next=/games/duel"}>Host a duel</Link>
              <Link href={signedIn ? "/games/high-low" : "/login?next=/games/high-low"}>Host high-low</Link>
            </span>
          </div>
        ) : null}
        {bj.map((row) => (
          <BlackjackItem key={row.key} row={row} />
        ))}
        {recent.slice(0, 4).map((match) => (
          <RecentItem key={`r${match.game}${match.id}`} match={match} />
        ))}
        {loading ? (
          <>
            <div className={`${styles.item} ${styles.itemSkel}`} aria-hidden="true" />
            <div className={`${styles.item} ${styles.itemSkel}`} aria-hidden="true" />
            <div className={`${styles.item} ${styles.itemSkel}`} aria-hidden="true" />
          </>
        ) : null}
      </div>
    </section>
  );
}

function PlayingItem({ table, me }: { table: GameTable; me: string | null }) {
  const [a, b] = [...table.players].sort((x, y) => x.seat - y.seat);
  const state = table.state as { round?: number; wins?: number[]; scores?: number[] } | null;
  const score = state?.wins ?? state?.scores ?? null;
  const mine = me !== null && table.players.some((player) => String(player.user_id) === me);
  return (
    <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={`${styles.item} ${styles.itemLive}`} role="listitem">
      <span className={styles.itemKind}>
        <em className={styles.onAir}>Live</em>
        {GAME_NAME[table.game]} · {fmtStake(table.stake)}
        {state?.round ? <> · R{state.round}</> : null}
      </span>
      <span className={styles.versus}>
        <Who name={a?.username} color={a?.profile_color} />
        <b className={styles.score}>{score?.[0] ?? 0}</b>
        <Who name={b?.username} color={b?.profile_color} />
        <b className={styles.score}>{score?.[1] ?? 0}</b>
      </span>
      <span className={styles.itemFoot}>
        <span>{table.stake > 0 ? `Pot ${fmtCash(table.pot)}` : "For bragging rights"}</span>
        <span className={styles.cta}>{mine ? "Back in" : table.spectators ? `Watch · ${table.spectators} in` : "Watch"}</span>
      </span>
    </Link>
  );
}

function OpenItem({ table, me, signedIn }: { table: GameTable; me: string | null; signedIn: boolean }) {
  const host = table.players[0];
  const expires = table.expires_at ? Number(new Date(table.expires_at)) : null;
  const left = useRemaining(expires, 1000);
  const mine = me !== null && table.players.some((player) => String(player.user_id) === me);
  const href = `${GAME_PATH[table.game]}/${table.id}`;
  return (
    <Link href={signedIn || mine ? href : `/login?next=${encodeURIComponent(href)}`} className={`${styles.item} ${styles.itemOpen}`} role="listitem">
      <span className={styles.itemKind}>
        <em className={styles.openTag}>Open</em>
        {GAME_NAME[table.game]}
        {expires ? <span suppressHydrationWarning> · {fmtLeft(left)}</span> : null}
      </span>
      <span className={styles.itemMain}>
        <Who name={host?.username} color={host?.profile_color} />
        <span className={styles.waits}>wants a match</span>
      </span>
      <span className={styles.itemFoot}>
        <span>{table.stake > 0 ? `Win ${fmtCash(table.payout_if_win)}` : "No stake"}</span>
        <span className={styles.cta}>{mine ? "Your table" : table.stake > 0 ? `Join · ${fmtCash(table.stake)}` : "Join · free"}</span>
      </span>
    </Link>
  );
}

function BlackjackItem({ row }: { row: BlackjackLobbyRow }) {
  const busy = row.seated > 0;
  const phase = row.phase === "playing" ? "dealing" : row.phase === "betting" ? "bets open" : row.phase === "results" ? "paying out" : busy ? "idle" : "empty";
  return (
    <Link href={`/games/blackjack/${row.key}`} className={`${styles.item} ${busy ? styles.itemLive : ""}`} role="listitem">
      <span className={styles.itemKind}>
        {busy ? <em className={styles.onAir}>Live</em> : null}
        Blackjack · {phase}
      </span>
      <span className={styles.itemMain}>
        <span className={styles.bjName}>{row.name}</span>
        <span className={styles.pips} aria-label={`${row.seated} of ${row.seats} seats taken`}>
          {Array.from({ length: row.seats }, (_, index) => (
            <i key={index} data-on={index < row.seated || undefined} />
          ))}
        </span>
      </span>
      <span className={styles.itemFoot}>
        <span>
          {fmtCash(row.min_bet)}–{fmtCash(row.max_bet)}
        </span>
        <span className={styles.cta}>{row.seated >= row.seats ? `Watch${row.spectators ? ` · ${row.spectators} in` : ""}` : "Take a seat"}</span>
      </span>
    </Link>
  );
}

function RecentItem({ match }: { match: RecentMatch & { game: TableGame } }) {
  const players = [...match.players].sort((a, b) => a.seat - b.seat);
  const winner = players.find((player) => player.outcome === "win");
  const loser = players.find((player) => player.outcome === "loss");
  return (
    <Link href={`${GAME_PATH[match.game]}/${match.id}`} className={`${styles.item} ${styles.itemDone}`} role="listitem">
      <span className={styles.itemKind}>
        Settled · {GAME_NAME[match.game]} · <span suppressHydrationWarning>{fmtAgo(match.completed_at)}</span>
      </span>
      <span className={styles.itemMain}>
        {winner && loser ? (
          <>
            <Who name={winner.username} color={winner.profile_color} />
            <span className={styles.waits}>beat {loser.username}</span>
          </>
        ) : (
          <span className={styles.waits}>
            {players.map((player) => player.username).join(" and ")} drew
          </span>
        )}
      </span>
      <span className={styles.itemFoot}>
        <span>{fmtStake(match.stake)}</span>
        {winner && winner.payout > 0 ? <span className={styles.gain}>+{fmtCash(winner.payout - match.stake)}</span> : <span>Refunded</span>}
      </span>
    </Link>
  );
}

function Who({ name, color }: { name?: string; color?: string | null }) {
  if (!name) return <span className={styles.who}>…</span>;
  return (
    <span className={styles.who}>
      <PlayerAvatar username={name} color={color} size={20} />
      <span>{name}</span>
    </span>
  );
}
