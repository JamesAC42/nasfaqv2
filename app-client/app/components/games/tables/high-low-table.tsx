"use client";

import { useState } from "react";
import { FiArrowDown, FiArrowUp } from "react-icons/fi";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { PlayingCard } from "@/app/components/games/shared/playing-card";
import { TimerBar } from "@/app/components/games/shared/timer-bar";
import {
  ErrorLine,
  ForfeitControl,
  isDone,
  money,
  PlayerTag,
  primeTable,
  ResultMoment,
  StakeStrip,
  TableGone,
  useLiveTable,
  useMySeat,
  useSettleRefresh,
  WaitingRoom,
} from "@/app/components/games/tables/table-kit";
import { callNext, joinTable } from "@/app/lib/games/api";
import type { GameTable, HighLowCall, HighLowState, PlayingCard as Card } from "@/app/lib/games/types";
import { useGamesConnected } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/tables/high-low-table.module.scss";

// High-low duel (GAMES_DESIGN.md §5). One shared deck, nine calls. Both players call higher or
// lower on the next card in secret; a double makes one round worth +2 / −1.

const RANK_NAME: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const rankOf = (card: Card) => Number(card.rank);
const rankLabel = (card: Card) => RANK_NAME[rankOf(card)] ?? String(card.rank);
const SUIT: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function HighLowTable({ id }: { id: number }) {
  const { table, spectators, error } = useLiveTable(id);
  const mySeat = useMySeat(table);
  const connected = useGamesConnected();
  useSettleRefresh(table, mySeat);

  const names = table?.players.map((player) => player.username) ?? [];
  const title = names.length === 2 ? `${names[0]} vs ${names[1]}` : table ? `Table ${table.id}` : "High-low";

  return (
    <GamesFrame
      kicker={`High-low · Table ${Number.isFinite(id) ? id : "?"}${mySeat < 0 && table ? " · Spectating" : ""}`}
      title={title}
      live={connected && table?.status === "playing"}
      aside={table ? <StakeStrip table={table} spectators={spectators} /> : null}
    >
      {!table ? (
        error ? (
          <TableGone game="high-low" />
        ) : (
          <div className={styles.loading} aria-busy="true">
            Shuffling…
          </div>
        )
      ) : table.status === "cancelled" ? (
        <TableGone game="high-low" cancelled={table.result?.cancelled ?? "closed"} />
      ) : table.status === "open" ? (
        <WaitingRoom table={table} mySeat={mySeat} joinSlot={<JoinHighLow table={table} />} />
      ) : table.state ? (
        <HighLowBoard table={table as GameTable<HighLowState>} mySeat={mySeat} />
      ) : (
        <TableGone game="high-low" cancelled="closed" />
      )}
    </GamesFrame>
  );
}

function JoinHighLow({ table }: { table: GameTable }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!user) return <SignInToPlay what="take this seat" />;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { table: joined } = await joinTable(table.id);
      primeTable(joined);
      void useProfileStore.getState().fetchPortfolio();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.join}>
      <button type="button" className={styles.primary} onClick={() => void join()} disabled={busy}>
        {busy ? "Sitting down…" : table.stake > 0 ? `Take the seat · ${money(table.stake)}` : "Take the seat · free"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

/** Exact odds on the next card from what's been seen (the opening card plus every flip). */
function oddsFor(state: HighLowState) {
  const seen = new Map<number, number>();
  const note = (card: Card) => seen.set(rankOf(card), (seen.get(rankOf(card)) ?? 0) + 1);
  if (state.history.length) note(state.history[0].from);
  else note(state.current);
  state.history.forEach((round) => note(round.to));
  const current = rankOf(state.current);
  let higher = 0;
  let lower = 0;
  let same = 0;
  for (let rank = 2; rank <= 14; rank += 1) {
    const left = 4 - (seen.get(rank) ?? 0);
    if (rank > current) higher += left;
    else if (rank < current) lower += left;
    else same += left;
  }
  return { higher, lower, same, total: higher + lower + same };
}

type MyCall = { round: number; call: NonNullable<HighLowCall> };

function HighLowBoard({ table, mySeat }: { table: GameTable<HighLowState>; mySeat: number }) {
  const state = table.state as HighLowState;
  const playing = mySeat >= 0;
  const left = playing ? mySeat : 0;
  const right = left === 0 ? 1 : 0;
  const done = isDone(table) || state.phase === "done";
  const [myCall, setMyCall] = useState<MyCall | null>(null);
  const [double, setDouble] = useState(false);
  const [pending, setPending] = useState<"higher" | "lower" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const calling = state.phase === "calling" && !done;
  const last = state.history.length ? state.history[state.history.length - 1] : null;
  const reveal = last && (state.phase === "reveal" || done) ? last : null;
  const iCalled = playing && state.called[mySeat];
  const canCall = playing && calling && !iCalled && pending === null;
  const doubleUsed = playing && state.doubles_used[mySeat];
  const lockedCall = calling && myCall && myCall.round === state.round ? myCall.call : null;
  const odds = calling || state.phase === "starting" ? oddsFor(state) : null;
  const shownFrom = reveal ? reveal.from : state.current;

  const player = (seat: number) => table.players.find((entry) => entry.seat === seat) ?? null;

  async function call(dir: "higher" | "lower") {
    if (!canCall) return;
    setPending(dir);
    setError(null);
    const round = state.round;
    const useDouble = double && !doubleUsed;
    try {
      const { table: next } = await callNext(table.id, dir, useDouble);
      setMyCall({ round, call: next.my_call ?? { dir, double: useDouble } });
      setDouble(false);
      primeTable(next);
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(null);
    }
  }

  function renderSeat(seat: number, side: "left" | "right") {
    const you = seat === mySeat;
    const revealCall = reveal ? reveal.calls[seat] : null;
    const delta = reveal ? reveal.deltas[seat] : null;
    let status: string;
    let tone: string;
    if (done) {
      status = state.winner === seat ? "Winner" : state.winner === null ? "Draw" : "";
      tone = state.winner === seat ? "won" : "idle";
    } else if (reveal) {
      status = callText(revealCall);
      tone = "idle";
    } else if (state.phase === "starting") {
      status = "Ready";
      tone = "idle";
    } else if (you) {
      status = lockedCall ? `Called ${callText(lockedCall)}` : state.called[seat] ? "Called" : "Your call";
      tone = state.called[seat] ? "called" : "turn";
    } else {
      status = state.called[seat] ? "Called" : "Thinking…";
      tone = state.called[seat] ? "called" : "thinking";
    }
    return (
      <div className={styles.seat} data-side={side}>
        <PlayerTag player={player(seat)} size={34} sub={you ? "you" : playing ? "opponent" : `seat ${seat + 1}`} />
        <div className={styles.scoreRow}>
          <span className={styles.score} aria-label={`${player(seat)?.username} score ${state.scores[seat]}`}>
            {state.scores[seat]}
          </span>
          {reveal && delta !== null ? (
            <span className={styles.delta} data-tone={delta > 0 ? "up" : delta < 0 ? "down" : "flat"} key={`${reveal.round}-${seat}`}>
              {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : "±0"}
            </span>
          ) : null}
        </div>
        <div className={styles.seatMeta}>
          <span className={styles.status} data-tone={tone}>
            {status}
          </span>
          <span className={styles.doubleTag} data-used={state.doubles_used[seat] || undefined} title={state.doubles_used[seat] ? "Double used" : "Double still available"}>
            ×2 {state.doubles_used[seat] ? "used" : "ready"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.board} data-phase={done ? "done" : state.phase}>
        <div className={styles.top}>
          {renderSeat(left, "left")}
          <div className={styles.roundBox}>
            <span className={styles.roundLabel}>
              Round <b>{Math.max(1, state.round)}</b> of {state.rounds ?? 9}
            </span>
            <RoundClock state={state} done={done} />
          </div>
          {renderSeat(right, "right")}
        </div>

        <div className={styles.felt}>
          <div className={styles.cardSlot}>
            <span className={styles.cardLabel}>{reveal ? "Was" : "Now"}</span>
            <PlayingCard card={shownFrom} width={140} key={`from-${shownFrom.rank}${shownFrom.suit}-${reveal ? "r" : "c"}`} />
          </div>
          <div className={styles.between} aria-hidden="true">
            {reveal ? (
              rankOf(reveal.to) > rankOf(reveal.from) ? (
                <FiArrowUp className={styles.up} />
              ) : rankOf(reveal.to) < rankOf(reveal.from) ? (
                <FiArrowDown className={styles.down} />
              ) : (
                <span className={styles.same}>=</span>
              )
            ) : (
              <span className={styles.q}>?</span>
            )}
          </div>
          <div className={styles.cardSlot}>
            <span className={styles.cardLabel}>{reveal ? "Flipped" : "Next"}</span>
            {reveal ? <PlayingCard card={reveal.to} width={140} deal key={`to-${reveal.round}`} /> : <PlayingCard card={null} width={140} />}
          </div>
        </div>

        {odds && !done ? (
          <p className={styles.odds}>
            <span>
              <FiArrowUp aria-hidden="true" /> <b>{odds.higher}</b> higher
            </span>
            <span>
              <FiArrowDown aria-hidden="true" /> <b>{odds.lower}</b> lower
            </span>
            <span>
              <b>{odds.same}</b> push
            </span>
            <span className={styles.oddsLeft}>of {odds.total} unseen</span>
          </p>
        ) : null}

        {playing && !done ? (
          <div className={styles.controls}>
            <button type="button" className={styles.higher} onClick={() => void call("higher")} disabled={!canCall} aria-pressed={lockedCall?.dir === "higher" || undefined}>
              <FiArrowUp aria-hidden="true" />
              {pending === "higher" ? "Calling…" : "Higher"}
            </button>
            <button
              type="button"
              className={styles.double}
              aria-pressed={double}
              onClick={() => setDouble((value) => !value)}
              disabled={doubleUsed || !calling || iCalled}
              title={doubleUsed ? "You already doubled this game" : "Once per game: +2 if right, −1 if wrong"}
            >
              <b>×2</b>
              <small>{doubleUsed ? "Used" : double ? "On" : "Double"}</small>
            </button>
            <button type="button" className={styles.lower} onClick={() => void call("lower")} disabled={!canCall} aria-pressed={lockedCall?.dir === "lower" || undefined}>
              <FiArrowDown aria-hidden="true" />
              {pending === "lower" ? "Calling…" : "Lower"}
            </button>
          </div>
        ) : null}
        {playing && !done ? (
          <p className={styles.controlNote} data-turn={canCall || undefined}>
            {state.phase === "starting"
              ? "First card's up. Calls open in a moment."
              : state.phase === "reveal"
                ? "Next card coming."
                : lockedCall
                  ? `You called ${callText(lockedCall)}. Waiting on ${player(right)?.username ?? "them"}.`
                  : iCalled
                    ? "Called. Waiting on the flip."
                    : double
                      ? "Doubled: +2 if right, −1 if wrong."
                      : "Same rank pushes. Right call +1."}
          </p>
        ) : null}

        {error ? (
          <div className={styles.boardError}>
            <ErrorLine error={error} />
          </div>
        ) : null}

        <p className={styles.srOnly} aria-live="polite">
          {reveal && !done ? `Round ${reveal.round}: ${rankLabel(reveal.from)} to ${rankLabel(reveal.to)}. ${player(0)?.username} ${fmtDelta(reveal.deltas[0])}, ${player(1)?.username} ${fmtDelta(reveal.deltas[1])}.` : ""}
        </p>

        {done ? (
          <div className={styles.momentLayer}>
            <ResultMoment
              table={table}
              mySeat={mySeat}
              detail={
                <span className={styles.finalScore}>
                  Final {state.scores[0]}–{state.scores[1]}
                </span>
              }
            />
          </div>
        ) : null}
      </div>

      <section className={styles.historyBlock} aria-labelledby="hl-history">
        <div className={styles.historyHead}>
          <h2 id="hl-history" className={styles.heading}>
            Calls
          </h2>
          {playing && !done ? <ForfeitControl table={table} /> : null}
        </div>
        <History state={state} names={[player(0)?.username ?? "Seat 1", player(1)?.username ?? "Seat 2"]} />
      </section>
    </div>
  );
}

function fmtDelta(value: number) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "±0";
}

function callText(call: HighLowCall | undefined) {
  if (!call) return "—";
  if (call.dir === "pass") return "No call";
  return `${call.dir === "higher" ? "Higher" : "Lower"}${call.double ? " ×2" : ""}`;
}

function RoundClock({ state, done }: { state: HighLowState; done: boolean }) {
  const left = useRemaining(state.deadline, 250);
  if (done) return <span className={styles.clockNote}>Final</span>;
  if (state.phase === "calling") return <TimerBar deadline={state.deadline} totalMs={10_000} label="Call timer" />;
  if (state.phase === "starting")
    return (
      <span className={styles.clockNote}>
        Starts in <b>{left === null ? "…" : Math.ceil(left / 1000)}</b>
      </span>
    );
  return <span className={styles.clockNote}>Flip</span>;
}

function History({ state, names }: { state: HighLowState; names: string[] }) {
  const total = state.rounds ?? 9;
  return (
    <ol className={styles.history}>
      {Array.from({ length: total }, (_, index) => {
        const round = state.history[index];
        const current = !round && index + 1 === state.round && state.phase !== "done";
        if (!round) {
          return (
            <li key={index} className={styles.historyItem} data-empty="true" data-current={current || undefined}>
              <span className={styles.historyRound}>R{index + 1}</span>
              <span className={styles.historyBlank}>{current ? "live" : ""}</span>
            </li>
          );
        }
        const dir = rankOf(round.to) > rankOf(round.from) ? "up" : rankOf(round.to) < rankOf(round.from) ? "down" : "flat";
        return (
          <li key={index} className={styles.historyItem}>
            <span className={styles.historyRound}>R{round.round}</span>
            <span className={styles.historyCards}>
              <MiniCard card={round.from} />
              <span className={styles.historyArrow} data-tone={dir}>
                {dir === "up" ? "▲" : dir === "down" ? "▼" : "="}
              </span>
              <MiniCard card={round.to} />
            </span>
            {round.calls.map((call, seat) => (
              <span key={seat} className={styles.historyCall} title={`${names[seat]}: ${callText(call)}`}>
                <em>{names[seat]}</em>
                <span>
                  {call?.dir === "higher" ? "▲" : call?.dir === "lower" ? "▼" : "·"}
                  {call?.double ? "×2" : ""}
                </span>
                <b data-tone={round.deltas[seat] > 0 ? "up" : round.deltas[seat] < 0 ? "down" : "flat"}>{fmtDelta(round.deltas[seat])}</b>
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function MiniCard({ card }: { card: Card }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <span className={styles.mini} data-red={red || undefined}>
      {rankLabel(card)}
      <i>{SUIT[card.suit]}</i>
    </span>
  );
}
