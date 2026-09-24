"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GamesFrame, SignInToPlay, useGamesWallet } from "@/app/components/games/shell/games-frame";
import { DuelDeckBuilder, useDuelDeck } from "@/app/components/games/tables/duel-deck";
import {
  ErrorLine,
  ExpiresIn,
  GAME_NAME,
  GAME_PATH,
  money,
  PlayerTag,
  primeTable,
  sameId,
  SpectatorCount,
} from "@/app/components/games/tables/table-kit";
import { cancelTable, createTable, fetchCatalog, fetchMyTables, fetchTables, joinTable } from "@/app/lib/games/api";
import type { DuelState, GameTable, HighLowState, LobbyMessage, RecentMatch, TableGame } from "@/app/lib/games/types";
import { useGamesChannel, useGamesConnected } from "@/app/lib/games/use-games-socket";
import { fmtInteger } from "@/app/lib/format";
import { timeAgo } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/tables/table-lobby.module.scss";

// Lobby for the two-player staked games. Open tables to join, live matches to watch, recent
// results, and the create form. Live over `lobby:{game}`; `recent` comes from the HTTP list and
// is re-fetched whenever a live match drops off (it just finished).

const PRESETS = [0, 100, 500, 1000, 5000];

const COPY: Record<TableGame, { kicker: string; blurb: string }> = {
  "oshi-duel": {
    kicker: "PvP · Staked",
    blurb: "Five cards each, five market rounds, first to three takes the pot.",
  },
  "high-low": {
    kicker: "PvP · Staked",
    blurb: "One deck, nine cards. Call higher or lower. Best read takes the pot.",
  },
};

type LobbyState = { tables: GameTable[]; recent: RecentMatch[] };

function scoreOf(table: GameTable) {
  if (!table.state) return null;
  if (table.game === "oshi-duel") {
    const state = table.state as Partial<DuelState>;
    return { a: state.wins?.[0] ?? 0, b: state.wins?.[1] ?? 0, round: state.round ?? 0, of: 5 };
  }
  const state = table.state as Partial<HighLowState>;
  return { a: state.scores?.[0] ?? 0, b: state.scores?.[1] ?? 0, round: state.round ?? 0, of: 9 };
}

export function TableLobby({ game }: { game: TableGame }) {
  const router = useRouter();
  const { user, initialized } = useAuth();
  const wallet = useGamesWallet();
  const connected = useGamesConnected();
  const channel = `lobby:${game}`;
  const live = useGamesChannel<LobbyMessage>(channel);
  const [initial, setInitial] = useState<LobbyState | null>(null);
  const [recent, setRecent] = useState<RecentMatch[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [mineFetched, setMineFetched] = useState<GameTable[] | null>(null);
  const [limits, setLimits] = useState({ min: 0, max: 5000, rakeBps: 500 });
  const duelDeck = useDuelDeck();
  const isDuel = game === "oshi-duel";

  const loadList = useCallback(() => {
    fetchTables(game)
      .then((data) => {
        setInitial({ tables: data.tables ?? [], recent: data.recent ?? [] });
        setRecent(data.recent ?? []);
        setListError(null);
      })
      .catch((error) => setListError(String((error as Error).message || error)));
  }, [game]);

  useEffect(() => {
    loadList();
    fetchCatalog()
      .then(({ games }) => {
        const entry = games.find((item) => item.key === game);
        if (!entry) return;
        setLimits({
          min: Number(entry.min_stake_cash ?? 0),
          max: Number(entry.max_stake_cash ?? 5000),
          rakeBps: Number((entry.config as { rake_bps?: number })?.rake_bps ?? 500),
        });
      })
      .catch(() => {});
  }, [game, loadList]);

  useEffect(() => {
    if (!user) return;
    fetchMyTables()
      .then(({ tables }) => setMineFetched(tables.filter((table) => table.game === game)))
      .catch(() => setMineFetched([]));
  }, [user, game]);

  const tables = useMemo(() => live?.tables ?? initial?.tables ?? [], [live, initial]);
  const openTables = tables.filter((table) => table.status === "open");
  const liveTables = tables.filter((table) => table.status === "playing");
  const watching = liveTables.reduce((sum, table) => sum + (table.spectators ?? 0), 0);

  const mine = useMemo(() => {
    if (!user) return [];
    if (live || initial) return tables.filter((table) => table.players.some((player) => sameId(player.user_id, user.id)));
    return mineFetched ?? [];
  }, [user, live, initial, tables, mineFetched]);
  const myOpen = mine.find((table) => table.status === "open") ?? null;
  const myPlaying = mine.find((table) => table.status === "playing") ?? null;

  // A finished match drops off the live list: pull the recent results again.
  const playingKey = liveTables.map((table) => table.id).join(",");
  const lastPlaying = useRef<string>("");
  useEffect(() => {
    const before = lastPlaying.current ? lastPlaying.current.split(",") : [];
    const now = new Set(playingKey ? playingKey.split(",") : []);
    lastPlaying.current = playingKey;
    if (before.some((id) => !now.has(id))) loadList();
  }, [playingKey, loadList]);

  // Your open table got a challenger: go to it.
  const waitingOn = useRef<number | null>(null);
  useEffect(() => {
    if (myOpen) waitingOn.current = myOpen.id;
    else if (myPlaying && waitingOn.current === myPlaying.id) {
      waitingOn.current = null;
      void useProfileStore.getState().fetchPortfolio();
      router.push(`${GAME_PATH[game]}/${myPlaying.id}`);
    }
  }, [myOpen, myPlaying, game, router]);

  return (
    <GamesFrame
      kicker={COPY[game].kicker}
      title={GAME_NAME[game]}
      blurb={COPY[game].blurb}
      live={connected}
      aside={
        <dl className={styles.counts}>
          <div>
            <dt>Open</dt>
            <dd>{openTables.length}</dd>
          </div>
          <div>
            <dt>Live</dt>
            <dd>{liveTables.length}</dd>
          </div>
          <div>
            <dt>Watching</dt>
            <dd>{fmtInteger(watching)}</dd>
          </div>
        </dl>
      }
    >
      {myPlaying ? (
        <Link href={`${GAME_PATH[game]}/${myPlaying.id}`} className={styles.resume}>
          <span className={styles.liveDot} aria-hidden="true" />
          <span>
            <b>You&apos;re mid-match</b> vs {myPlaying.players.find((player) => !sameId(player.user_id, user?.id))?.username ?? "someone"}
            {myPlaying.stake > 0 ? <> · {money(myPlaying.pot)} pot</> : null}
          </span>
          <em>Back to the table →</em>
        </Link>
      ) : null}

      <div className={styles.layout} data-deck={isDuel && user ? "true" : undefined}>
        {isDuel && user ? (
          <div className={styles.deckRow}>
            <DuelDeckBuilder deck={duelDeck.deck} setDeck={duelDeck.setDeck} autoPick={duelDeck.autoPick} />
          </div>
        ) : null}
        <aside className={styles.side}>
          {!initialized ? null : !user ? (
            <section className={styles.block}>
              <h2 className={styles.heading}>Start a table</h2>
              <SignInToPlay what="put money on a match" />
              <p className={styles.note}>You can still watch any live match below.</p>
            </section>
          ) : myOpen ? (
            <YourTable table={myOpen} />
          ) : (
            <CreateTable
              game={game}
              limits={limits}
              cash={wallet.cash}
              deck={isDuel ? duelDeck.deck : undefined}
              deckReady={!isDuel || duelDeck.ready}
              busyElsewhere={Boolean(myPlaying)}
              onCreated={(table) => {
                primeTable(table);
                router.push(`${GAME_PATH[game]}/${table.id}`);
              }}
            />
          )}
        </aside>

        <div className={styles.main}>
          <section className={styles.block} aria-labelledby="open-tables">
            <div className={styles.headRow}>
              <h2 id="open-tables" className={styles.heading}>
                Open tables
              </h2>
              <span className={styles.count}>{openTables.length}</span>
            </div>
            {listError ? <p className={styles.errorLine}>Couldn&apos;t load tables. {listError.replace(/_/g, " ")}</p> : null}
            {openTables.length ? (
              <ul className={styles.rows}>
                {openTables.map((table) => (
                  <OpenRow
                    key={table.id}
                    table={table}
                    mine={Boolean(user && sameId(table.host_user_id, user.id))}
                    signedIn={Boolean(user)}
                    cash={wallet.cash}
                    deck={isDuel ? duelDeck.deck : undefined}
                    deckReady={!isDuel || duelDeck.ready}
                    busyElsewhere={Boolean(myOpen || myPlaying)}
                    onJoined={(joined) => {
                      primeTable(joined);
                      void useProfileStore.getState().fetchPortfolio();
                      router.push(`${GAME_PATH[game]}/${joined.id}`);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>{initial || live ? "No open tables. Open one and someone will bite." : "Loading tables…"}</p>
            )}
          </section>

          <section className={styles.block} aria-labelledby="live-tables">
            <div className={styles.headRow}>
              <h2 id="live-tables" className={styles.heading}>
                Live now
              </h2>
              <span className={styles.count}>{liveTables.length}</span>
            </div>
            {liveTables.length ? (
              <ul className={styles.rows}>
                {liveTables.map((table) => (
                  <LiveRow key={table.id} table={table} mine={Boolean(user && table.players.some((player) => sameId(player.user_id, user.id)))} />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Nobody&apos;s playing right now.</p>
            )}
          </section>

          <section className={styles.block} aria-labelledby="recent-results">
            <div className={styles.headRow}>
              <h2 id="recent-results" className={styles.heading}>
                Recent results
              </h2>
            </div>
            {recent?.length ? (
              <ul className={styles.recent}>
                {recent.map((match) => (
                  <RecentRow key={match.id} match={match} game={game} />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>{recent ? "No finished matches yet." : "Loading…"}</p>
            )}
          </section>
        </div>
      </div>
    </GamesFrame>
  );
}

function CreateTable({
  game,
  limits,
  cash,
  deck,
  deckReady,
  busyElsewhere,
  onCreated,
}: {
  game: TableGame;
  limits: { min: number; max: number; rakeBps: number };
  cash: number | null;
  deck?: string[];
  deckReady: boolean;
  busyElsewhere: boolean;
  onCreated: (table: GameTable) => void;
}) {
  const [raw, setRaw] = useState("500");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stake = raw.trim() === "" ? 0 : Math.round(Number(raw) * 100) / 100;
  const valid = Number.isFinite(stake) && stake >= limits.min && stake <= limits.max;
  const payout = Math.round(stake * 2 * (1 - limits.rakeBps / 10_000) * 100) / 100;
  const short = valid && cash !== null && stake > cash;
  const rakePct = limits.rakeBps / 100;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { table } = await createTable(game, stake, deck);
      void useProfileStore.getState().fetchPortfolio();
      onCreated(table);
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  }

  const label = !deckReady ? "Finish your deck first" : stake > 0 ? `Open table · ${money(stake)}` : "Open friendly table";

  return (
    <form className={styles.block} onSubmit={(event) => void submit(event)}>
      <h2 className={styles.heading}>Start a table</h2>
      <div className={styles.stakeField}>
        <label htmlFor={`stake-${game}`}>Your stake</label>
        <div className={styles.stakeInput}>
          <span aria-hidden="true">$</span>
          <input
            id={`stake-${game}`}
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(event) => setRaw(event.target.value.replace(/[^0-9.]/g, ""))}
            aria-describedby={`stake-line-${game}`}
            aria-invalid={!valid || undefined}
          />
        </div>
        <div className={styles.presets} role="group" aria-label="Stake presets">
          {PRESETS.filter((value) => value >= limits.min && value <= limits.max).map((value) => (
            <button key={value} type="button" aria-pressed={stake === value} onClick={() => setRaw(String(value))}>
              {value === 0 ? "Friendly" : `$${fmtInteger(value)}`}
            </button>
          ))}
        </div>
      </div>
      <p id={`stake-line-${game}`} className={styles.stakeLine} data-bad={!valid || short || undefined}>
        {!valid ? (
          <>
            Stakes run {money(limits.min)} to {money(limits.max)}.
          </>
        ) : short ? (
          <>You&apos;ve only got {money(cash)}.</>
        ) : stake > 0 ? (
          <>
            You put up <b>{money(stake)}</b>, winner takes <b>{money(payout)}</b> ({rakePct}% rake).
          </>
        ) : (
          <>Friendly match. Nothing on it but pride.</>
        )}
      </p>
      <button type="submit" className={styles.primary} disabled={!valid || short || busy || !deckReady || busyElsewhere}>
        {busy ? "Opening…" : busyElsewhere ? "Finish your match first" : label}
      </button>
      <ErrorLine error={error} />
      <p className={styles.note}>Tables close after 10 minutes with no challenger. Your stake comes back.</p>
    </form>
  );
}

function YourTable({ table }: { table: GameTable }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    <section className={`${styles.block} ${styles.yours}`} aria-labelledby="your-table">
      <h2 id="your-table" className={styles.heading}>
        Your table
      </h2>
      <p className={styles.yoursWait}>
        Waiting for a challenger
        <span className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
      <dl className={styles.yoursStats}>
        <div>
          <dt>Stake</dt>
          <dd>{table.stake > 0 ? money(table.stake) : "Friendly"}</dd>
        </div>
        <div>
          <dt>Winner takes</dt>
          <dd>{table.stake > 0 ? money(table.payout_if_win) : "—"}</dd>
        </div>
      </dl>
      <ExpiresIn at={table.expires_at} />
      <div className={styles.yoursActions}>
        <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={styles.primary}>
          Go to table
        </Link>
        <button type="button" className={styles.secondary} onClick={() => void cancel()} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      </div>
      <ErrorLine error={error} />
    </section>
  );
}

function OpenRow({
  table,
  mine,
  signedIn,
  cash,
  deck,
  deckReady,
  busyElsewhere,
  onJoined,
}: {
  table: GameTable;
  mine: boolean;
  signedIn: boolean;
  cash: number | null;
  deck?: string[];
  deckReady: boolean;
  busyElsewhere: boolean;
  onJoined: (table: GameTable) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const host = table.players[0];
  const short = cash !== null && table.stake > cash;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { table: joined } = await joinTable(table.id, deck);
      onJoined(joined);
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  }

  let action;
  if (mine) {
    action = (
      <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={styles.rowGhost}>
        Yours
      </Link>
    );
  } else if (!signedIn) {
    action = (
      <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={styles.rowGhost}>
        Look
      </Link>
    );
  } else {
    const reason = busyElsewhere ? "You're already at a table" : !deckReady ? "Build a deck first" : short ? "Not enough cash" : null;
    action = (
      <button type="button" className={styles.rowJoin} onClick={() => void join()} disabled={busy || Boolean(reason)} title={reason ?? undefined}>
        {busy ? "Joining…" : table.stake > 0 ? `Join · ${money(table.stake)}` : "Join free"}
      </button>
    );
  }

  return (
    <li className={styles.row} data-mine={mine || undefined}>
      <div className={styles.rowMain}>
        <PlayerTag player={host} sub={<ExpiresIn at={table.expires_at} prefix="closes" />} />
      </div>
      <div className={styles.rowMoney}>
        <span>
          <small>Stake</small>
          <b>{table.stake > 0 ? money(table.stake) : "Free"}</b>
        </span>
        <span>
          <small>Win</small>
          <b className={table.stake > 0 ? styles.win : undefined}>{table.stake > 0 ? money(table.payout_if_win) : "—"}</b>
        </span>
      </div>
      <div className={styles.rowAction}>{action}</div>
      {error ? (
        <div className={styles.rowError}>
          <ErrorLine error={error} />
        </div>
      ) : null}
    </li>
  );
}

function LiveRow({ table, mine }: { table: GameTable; mine: boolean }) {
  const [a, b] = [table.players.find((player) => player.seat === 0), table.players.find((player) => player.seat === 1)];
  const score = scoreOf(table);
  const phase = (table.state as { phase?: string } | null)?.phase;
  return (
    <li className={styles.row} data-mine={mine || undefined}>
      <div className={styles.rowMain}>
        <span className={styles.match}>
          <b>{a?.username ?? "?"}</b>
          <span className={styles.score}>
            {score ? (
              <>
                <em>{score.a}</em>–<em>{score.b}</em>
              </>
            ) : (
              "vs"
            )}
          </span>
          <b>{b?.username ?? "?"}</b>
        </span>
        <small className={styles.rowSub}>
          {phase === "starting" || !score?.round ? "Starting" : `Round ${score.round} of ${score.of}`}
          {table.game === "oshi-duel" ? " · first to 3" : null}
        </small>
      </div>
      <div className={styles.rowMoney}>
        <span>
          <small>Pot</small>
          <b>{table.stake > 0 ? money(table.pot) : "Free"}</b>
        </span>
        <span>
          <small>Watching</small>
          <SpectatorCount count={table.spectators ?? 0} />
        </span>
      </div>
      <div className={styles.rowAction}>
        <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={mine ? styles.rowJoin : styles.rowGhost}>
          {mine ? "Resume" : "Watch"}
        </Link>
      </div>
    </li>
  );
}

function RecentRow({ match, game }: { match: RecentMatch; game: TableGame }) {
  const winnerSeat = match.result?.winner_seat ?? null;
  const winner = match.players.find((player) => player.seat === winnerSeat);
  const loser = match.players.find((player) => player.seat !== winnerSeat);
  const payout = Number(match.result?.payout ?? winner?.payout ?? 0);
  const forfeit = match.result?.reason === "forfeit";
  return (
    <li className={styles.recentRow}>
      <Link href={`${GAME_PATH[game]}/${match.id}`} className={styles.recentLink}>
        {winner ? (
          <span className={styles.recentText}>
            <b>{winner.username}</b> {forfeit ? "won by forfeit over" : "beat"} <span>{loser?.username ?? "?"}</span>
          </span>
        ) : (
          <span className={styles.recentText}>
            <b>{match.players[0]?.username}</b> drew <span>{match.players[1]?.username}</span>
          </span>
        )}
        <span className={styles.recentAmount} data-tone={winner && match.stake > 0 ? "up" : undefined}>
          {!winner ? (match.stake > 0 ? "refunded" : "friendly") : match.stake > 0 ? `+${money(payout - match.stake)}` : "friendly"}
        </span>
        <time className={styles.recentTime} dateTime={match.completed_at}>
          {timeAgo(match.completed_at)}
        </time>
      </Link>
    </li>
  );
}
