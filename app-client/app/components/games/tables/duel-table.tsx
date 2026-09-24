"use client";

import { useState, type CSSProperties } from "react";
import { CardBack, TalentCard } from "@/app/components/games/cards/talent-card";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { TimerBar } from "@/app/components/games/shared/timer-bar";
import { DuelDeckBuilder, MomentumChip, useDuelDeck } from "@/app/components/games/tables/duel-deck";
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
  WinPips,
} from "@/app/components/games/tables/table-kit";
import { joinTable, pickCard } from "@/app/lib/games/api";
import type { DuelCard, DuelCondition, DuelState, GameTable, PowerBreakdown } from "@/app/lib/games/types";
import { useGamesConnected } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { talentAccent } from "@/app/lib/talent-color";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/tables/duel-table.module.scss";

// Oshi Card Duel table (GAMES_DESIGN.md §3). Opponent's deck across the top, yours across the
// bottom (spectators: seat 0 bottom, seat 1 top), the round's market condition and the two
// played cards in the middle. Picks stay hidden until both are in; the server reveals them.

export function DuelTable({ id }: { id: number }) {
  const { table, spectators, error } = useLiveTable(id);
  const mySeat = useMySeat(table);
  const connected = useGamesConnected();
  useSettleRefresh(table, mySeat);

  const names = table?.players.map((player) => player.username) ?? [];
  const title = names.length === 2 ? `${names[0]} vs ${names[1]}` : table ? `Table ${table.id}` : "Oshi Card Duel";

  return (
    <GamesFrame
      kicker={`Oshi Card Duel · Table ${Number.isFinite(id) ? id : "?"}${mySeat < 0 && table ? " · Spectating" : ""}`}
      title={title}
      live={connected && table?.status === "playing"}
      aside={table ? <StakeStrip table={table} spectators={spectators} /> : null}
    >
      {!table ? (
        error ? (
          <TableGone game="oshi-duel" />
        ) : (
          <div className={styles.loading} aria-busy="true">
            Pulling up a chair…
          </div>
        )
      ) : table.status === "cancelled" ? (
        <TableGone game="oshi-duel" cancelled={table.result?.cancelled ?? "closed"} />
      ) : table.status === "open" ? (
        <WaitingRoom table={table} mySeat={mySeat} joinSlot={<JoinDuel table={table} />} />
      ) : table.state ? (
        <DuelBoard table={table as GameTable<DuelState>} mySeat={mySeat} />
      ) : (
        <TableGone game="oshi-duel" cancelled="closed" />
      )}
    </GamesFrame>
  );
}

function JoinDuel({ table }: { table: GameTable }) {
  const { user } = useAuth();
  const { deck, setDeck, autoPick, ready } = useDuelDeck();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!user) return <SignInToPlay what="take this seat" />;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { table: joined } = await joinTable(table.id, deck);
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
      <button type="button" className={styles.primary} onClick={() => void join()} disabled={busy || !ready}>
        {busy ? "Sitting down…" : !ready ? "Pick five cards first" : table.stake > 0 ? `Take the seat · ${money(table.stake)}` : "Take the seat · free"}
      </button>
      <ErrorLine error={error} />
      <DuelDeckBuilder deck={deck} setDeck={setDeck} autoPick={autoPick} heading="Bring five" />
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────
const CONDITION_ICON: Record<string, string> = {
  bull: "▲",
  bear: "▼",
  unit: "★",
  underdog: "↯",
  whale: "◆",
  volatility: "≋",
  quiet: "—",
  rookie: "✦",
};

/** What the round's condition does for `card`, before knowing the other pick. */
function conditionEdge(card: DuelCard, condition: DuelCondition | null, other: DuelCard[]): string | null {
  if (!condition) return null;
  const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  switch (condition.key) {
    case "bull":
      return (card.move_pct ?? 0) > 0 ? "+5" : null;
    case "bear":
      return (card.move_pct ?? 0) < 0 ? "+5" : null;
    case "unit":
      return condition.unit && card.unit === condition.unit ? "+6" : null;
    case "rookie":
      return card.rarity === "C" || card.rarity === "R" ? "+5" : null;
    case "volatility":
      return card.momentum > 0 ? `+${card.momentum}` : null;
    case "quiet":
      return card.momentum < 0 ? `+${-card.momentum}` : null;
    case "underdog":
      return other.length && card.base < avg(other.map((entry) => entry.base)) ? "+7" : null;
    case "whale":
      return other.length && (card.price ?? 0) > avg(other.map((entry) => entry.price ?? 0)) ? "+4" : null;
    default:
      return null;
  }
}

type Pick = { round: number; index: number };

function DuelBoard({ table, mySeat }: { table: GameTable<DuelState>; mySeat: number }) {
  const state = table.state as DuelState;
  const playing = mySeat >= 0;
  const bottom = playing ? mySeat : 0;
  const top = bottom === 0 ? 1 : 0;
  const done = isDone(table) || state.phase === "done";
  const [myPick, setMyPick] = useState<Pick | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const picking = state.phase === "picking" && !done;
  const last = state.history.length ? state.history[state.history.length - 1] : null;
  const showReveal = Boolean(last && (state.phase === "reveal" || done));
  const reveal = showReveal ? last : null;
  const lockedIndex = picking && myPick && myPick.round === state.round ? myPick.index : null;
  const iPicked = playing && state.picked[mySeat];
  const canPick = playing && picking && !iPicked && pending === null;

  const player = (seat: number) => table.players.find((entry) => entry.seat === seat) ?? null;
  const unused = (seat: number) => state.decks[seat].filter((_, index) => !state.used[seat][index]);

  async function pick(index: number) {
    if (!canPick) return;
    setPending(index);
    setError(null);
    const round = state.round;
    try {
      const { table: next } = await pickCard(table.id, index);
      if (typeof next.my_pick === "number") setMyPick({ round, index: next.my_pick });
      else setMyPick({ round, index });
      primeTable(next);
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(null);
    }
  }

  function statusFor(seat: number) {
    if (done) return state.winner === seat ? "Winner" : state.winner === null ? "Draw" : "";
    if (state.phase === "starting") return "Ready";
    if (state.phase === "reveal") return reveal?.winner === seat ? "Takes the round" : reveal?.winner === null ? "Tied round" : "";
    if (seat === mySeat) return state.picked[seat] ? "Locked in" : "Your pick";
    return state.picked[seat] ? "Picked" : "Thinking…";
  }

  function renderPlate(seat: number, place: "top" | "bottom") {
    const status = statusFor(seat);
    const tone =
      !done && state.phase === "picking" ? (state.picked[seat] ? "picked" : seat === mySeat ? "turn" : "thinking") : state.phase === "reveal" && reveal?.winner === seat ? "won" : done && state.winner === seat ? "won" : "idle";
    return (
      <div className={styles.plate} data-place={place}>
        <PlayerTag player={player(seat)} size={30} sub={seat === mySeat ? "you" : playing ? "opponent" : `seat ${seat + 1}`} />
        <WinPips wins={state.wins[seat] ?? 0} needed={state.wins_needed ?? 3} label={player(seat)?.username ?? `Seat ${seat + 1}`} />
        <span className={styles.status} data-tone={tone}>
          {status}
        </span>
      </div>
    );
  }

  function renderDeck(seat: number, place: "top" | "bottom") {
    const mine = seat === mySeat;
    const others = unused(seat === 0 ? 1 : 0);
    const playedIndex = reveal ? reveal.picks[seat] : null;
    return (
      <ol className={styles.deck} data-place={place} aria-label={`${player(seat)?.username ?? "Seat " + (seat + 1)}'s deck`}>
        {state.decks[seat].map((card, index) => {
          const used = state.used[seat][index];
          const locked = mine && lockedIndex === index;
          const played = playedIndex === index;
          const edge = !used && !done ? conditionEdge(card, state.condition, others) : null;
          const clickable = mine && canPick && !used;
          return (
            <li
              key={card.key}
              className={styles.deckSlot}
              data-used={(used && !played) || undefined}
              data-locked={locked || (pending === index && mine) || undefined}
              data-played={played || undefined}
              data-edge={edge ? "true" : undefined}
            >
              <TalentCard
                card={{ ...card, power: card.base }}
                width={place === "top" ? 92 : 112}
                compact
                tilt={false}
                muted={used && !played}
                selected={locked}
                onClick={clickable ? () => void pick(index) : undefined}
                disabled={!clickable}
                title={clickable ? `Play ${card.name} (${card.base} power)` : undefined}
                ribbon={locked ? "LOCKED" : null}
              />
              <span className={styles.chips}>
                <MomentumChip value={card.momentum} />
                {edge ? (
                  <span className={styles.edge} title={`${state.condition?.label}: ${state.condition?.text}`}>
                    {CONDITION_ICON[state.condition?.key ?? ""] ?? "+"} {edge}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  function renderStage(seat: number) {
    if (reveal) {
      const card = state.decks[seat][reveal.picks[seat]];
      const powers = reveal.powers[seat];
      const won = reveal.winner === seat;
      const lost = reveal.winner !== null && !won;
      return (
        <div className={styles.played} data-won={won || undefined} data-lost={lost || undefined} data-seat={seat === bottom ? "bottom" : "top"} key={`r${reveal.round}-${seat}`}>
          <div className={styles.flip}>
            <div className={styles.flipInner}>
              <div className={styles.flipFront}>
                <TalentCard card={{ ...card, power: card.base }} width={128} compact tilt={false} ribbon={reveal.auto[seat] ? "AUTO" : null} />
              </div>
              <div className={styles.flipBack} aria-hidden="true">
                <CardBack width={128} />
              </div>
            </div>
          </div>
          <Breakdown powers={powers} condition={reveal.condition} won={won} />
        </div>
      );
    }
    const mine = seat === mySeat;
    const hasPick = state.picked[seat];
    if (mine && lockedIndex !== null) {
      const card = state.decks[seat][lockedIndex];
      return (
        <div className={styles.played} data-seat="bottom">
          <div className={styles.lockIn}>
            <TalentCard card={{ ...card, power: card.base }} width={128} compact tilt={false} ribbon="LOCKED" />
          </div>
          <span className={styles.slotNote}>Locked in. Waiting on them.</span>
        </div>
      );
    }
    if (hasPick) {
      return (
        <div className={styles.played} data-seat={seat === bottom ? "bottom" : "top"}>
          <div className={styles.lockIn}>
            <CardBack width={128} />
          </div>
          <span className={styles.slotNote}>{mine ? "Locked in." : "Picked."}</span>
        </div>
      );
    }
    return (
      <div className={styles.played} data-seat={seat === bottom ? "bottom" : "top"}>
        <div className={styles.emptyStage}>{state.phase === "starting" ? "" : mine ? "Pick a card" : "Thinking…"}</div>
        <span className={styles.slotNote}>&nbsp;</span>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.board} data-phase={done ? "done" : state.phase}>
        <div className={styles.seatRow} data-place="top">
          {renderPlate(top, "top")}
          {renderDeck(top, "top")}
        </div>

        <div className={styles.stage}>
          <div className={styles.stageSide}>
            <RoundInfo state={state} />
          </div>
          <div className={styles.arena}>
            {renderStage(top)}
            <span className={styles.versus} aria-hidden="true">
              {reveal ? (reveal.winner === null ? "TIE" : "VS") : "VS"}
            </span>
            {renderStage(bottom)}
          </div>
          <div className={styles.stageSide} data-align="end">
            {reveal && !done ? (
              <div className={styles.roundCall} data-you={(playing && reveal.winner === mySeat) || undefined} key={`call-${reveal.round}`}>
                <small>Round {reveal.round}</small>
                <strong>
                  {reveal.winner === null ? "Dead even" : reveal.winner === mySeat ? "Yours" : `${player(reveal.winner)?.username ?? "They"} takes it`}
                </strong>
                <PhaseClock state={state} done={done} canPick={canPick} playing={playing} />
              </div>
            ) : (
              <PhaseClock state={state} done={done} canPick={canPick} playing={playing} />
            )}
          </div>
        </div>

        <div className={styles.seatRow} data-place="bottom">
          {renderPlate(bottom, "bottom")}
          {renderDeck(bottom, "bottom")}
        </div>

        {error ? (
          <div className={styles.boardError}>
            <ErrorLine error={error} />
          </div>
        ) : null}

        <p className={styles.srOnly} aria-live="polite">
          {reveal && !done
            ? `Round ${reveal.round}: ${reveal.winner === null ? "tied" : `${player(reveal.winner)?.username} takes it`}, ${reveal.powers[0].total} to ${reveal.powers[1].total}.`
            : ""}
        </p>

        {done ? (
          <div className={styles.momentLayer}>
            <ResultMoment
              table={table}
              mySeat={mySeat}
              detail={
                <span className={styles.finalScore}>
                  {state.wins[0]}–{state.wins[1]} in rounds
                </span>
              }
            />
          </div>
        ) : null}
      </div>

      <aside className={styles.side}>
        <section className={styles.sideBlock} aria-labelledby="duel-rounds">
          <h2 id="duel-rounds" className={styles.heading}>
            Rounds
          </h2>
          <History state={state} players={table.players.map((entry) => entry.username)} />
        </section>
        <section className={styles.sideBlock}>
          <h2 className={styles.heading}>How it scores</h2>
          <p className={styles.rules}>
            Power is base (rarity + stars) plus momentum (today&apos;s stock move, capped ±8) plus the round&apos;s market bonus. Higher total takes the round. First to 3.
          </p>
        </section>
        {playing && !done ? (
          <section className={styles.sideBlock}>
            <ForfeitControl table={table} />
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function RoundInfo({ state }: { state: DuelState }) {
  const condition = state.condition;
  return (
    <div className={styles.round}>
      <span className={styles.roundLabel}>
        Round <b>{Math.max(1, state.round)}</b> of {state.max_rounds ?? 5}
      </span>
      {condition ? (
        <div className={styles.condition} key={`${state.round}-${condition.key}`} data-key={condition.key}>
          <span className={styles.conditionIcon} aria-hidden="true">
            {CONDITION_ICON[condition.key] ?? "◆"}
          </span>
          <span className={styles.conditionText}>
            <small>Market</small>
            <strong>{condition.label}</strong>
            <em>{condition.text}</em>
          </span>
        </div>
      ) : (
        <div className={styles.condition} data-key="none">
          <span className={styles.conditionIcon} aria-hidden="true">
            ?
          </span>
          <span className={styles.conditionText}>
            <small>Market</small>
            <strong>Opening bell</strong>
            <em>First condition drops when the round starts.</em>
          </span>
        </div>
      )}
    </div>
  );
}

function PhaseClock({ state, done, canPick, playing }: { state: DuelState; done: boolean; canPick: boolean; playing: boolean }) {
  const left = useRemaining(state.deadline, 250);
  if (done) return <span className={styles.clockNote}>Final</span>;
  if (state.phase === "starting") {
    return (
      <div className={styles.clock}>
        <span className={styles.clockBig}>{left === null ? "…" : Math.ceil(left / 1000)}</span>
        <span className={styles.clockNote}>Opening bell</span>
      </div>
    );
  }
  if (state.phase === "reveal") {
    return (
      <div className={styles.clock}>
        <span className={styles.clockNote}>{state.round >= (state.max_rounds ?? 5) ? "Last round" : "Next round soon"}</span>
      </div>
    );
  }
  return (
    <div className={styles.clock}>
      <TimerBar deadline={state.deadline} totalMs={20_000} label="Pick timer" />
      <span className={styles.clockNote} data-turn={canPick || undefined}>
        {canPick ? "Your pick" : playing ? "Waiting on the reveal" : "Both picking"}
      </span>
    </div>
  );
}

function Breakdown({ powers, condition, won }: { powers: PowerBreakdown; condition: DuelCondition; won: boolean }) {
  const sign = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "+0");
  return (
    <div className={styles.breakdown} data-won={won || undefined} aria-label={`Base ${powers.base}, momentum ${powers.momentum}, ${condition.label} ${powers.bonus}, total ${powers.total}`}>
      <span>
        {powers.base}
        <small>base</small>
      </span>
      <span data-tone={powers.momentum > 0 ? "up" : powers.momentum < 0 ? "down" : undefined}>
        {sign(powers.momentum)}
        <small>mom</small>
      </span>
      <span data-bonus={powers.bonus > 0 || undefined}>
        {sign(powers.bonus)}
        <small>mkt</small>
      </span>
      <b>
        = {powers.total}
      </b>
    </div>
  );
}

function History({ state, players }: { state: DuelState; players: string[] }) {
  if (!state.history.length) return <p className={styles.historyEmpty}>No rounds yet.</p>;
  return (
    <ol className={styles.history}>
      {state.history.map((round) => {
        const cards = round.picks.map((index, seat) => state.decks[seat][index]);
        return (
          <li key={round.round} className={styles.historyRow}>
            <span className={styles.historyRound}>R{round.round}</span>
            <span className={styles.historyCondition}>{round.condition.label}</span>
            <span className={styles.historyPlays}>
              {cards.map((card, seat) => (
                <span
                  key={seat}
                  className={styles.historyPlay}
                  data-won={round.winner === seat || undefined}
                  style={{ "--tal": talentAccent(card.color) } as CSSProperties}
                  title={`${players[seat]}: ${card.name} ${card.rarity}${round.auto[seat] ? " (auto-pick)" : ""}`}
                >
                  <b>{card.symbol}</b>
                  <em>{round.powers[seat].total}</em>
                  {round.auto[seat] ? <small>auto</small> : null}
                </span>
              ))}
            </span>
            <span className={styles.historyWinner}>{round.winner === null ? "tie" : players[round.winner]}</span>
          </li>
        );
      })}
    </ol>
  );
}
