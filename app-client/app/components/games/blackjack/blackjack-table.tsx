"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaEye } from "react-icons/fa6";
import { GamesFrame, useGamesWallet } from "@/app/components/games/shell/games-frame";
import { TimerBar } from "@/app/components/games/shared/timer-bar";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { actBlackjack, betBlackjack, fetchBlackjackTable, leaveBlackjack, sitBlackjack } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { BlackjackTable } from "@/app/lib/games/types";
import { primeChannel, useGamesChannel, useGamesConnected, useSeedChannel } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import { Hand, Seat, Shoe } from "@/app/components/games/blackjack/bj-parts";
import { BlackjackControls, type BjAction } from "@/app/components/games/blackjack/bj-controls";
import { BJ_BET_MS, BJ_TURN_MS, HOUSE_RULES, handValue, momentOf, netOf, usePhone, wagerOf, withLiveDeadline } from "@/app/components/games/blackjack/bj-utils";
import styles from "@/app/components/games/blackjack/blackjack-table.module.scss";

type Payload = { type: "blackjack"; table: BlackjackTable; server_time?: number };

const TABLE_KEYS = [
  { key: "low", label: "Low" },
  { key: "mid", label: "Mid" },
  { key: "high", label: "High" },
];

// Seats curve along the rail: the ends sit closer to the dealer.
const ARC = [0, 0.7, 1, 0.7, 0];

type Tally = { net: number; hands: number; wins: number; losses: number; pushes: number };
const EMPTY_TALLY: Tally = { net: 0, hands: 0, wins: 0, losses: 0, pushes: 0 };

export function BlackjackTablePage({ tableKey }: { tableKey: string }) {
  const channel = `blackjack:${tableKey}`;
  const { user } = useAuth();
  const wallet = useGamesWallet();
  const connected = useGamesConnected();
  const phone = usePhone();

  const [seed, setSeed] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBlackjackTable(tableKey)
      .then((response) => {
        if (!cancelled) setSeed({ type: "blackjack", table: response.table, server_time: response.table.server_time });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(gameErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [tableKey]);
  useSeedChannel(channel, seed);
  const live = useGamesChannel<Payload>(channel);
  const rawTable = live?.table ?? seed?.table ?? null;
  const table = useMemo(() => (rawTable ? withLiveDeadline(rawTable) : null), [rawTable]);

  const myIndex = table && user ? table.seats.findIndex((seat) => seat && String(seat.user_id) === String(user.id)) : -1;
  const mySeat = table && myIndex >= 0 ? table.seats[myIndex] : null;

  // ── Actions ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState<BjAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastBet, setLastBet] = useState<number | null>(null);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [skipped, setSkipped] = useState(0);
  const [kicked, setKicked] = useState(false);
  const tableRef = useRef(table);
  useEffect(() => {
    tableRef.current = table;
  }, [table]);
  const leftOnPurpose = useRef(false);

  const apply = useCallback(
    (next: BlackjackTable) => {
      const current = tableRef.current;
      if (current && current.server_time > next.server_time) return;
      primeChannel(channel, { type: "blackjack", table: next, server_time: next.server_time });
    },
    [channel],
  );

  const run = useCallback(
    async (action: BjAction, call: () => Promise<{ table: BlackjackTable }>, movesCash = false) => {
      setBusy(action);
      setError(null);
      try {
        const response = await call();
        apply(response.table);
        return true;
      } catch (caught) {
        setError(gameErrorText(caught));
        return false;
      } finally {
        setBusy(null);
        if (movesCash) void useProfileStore.getState().fetchPortfolio();
      }
    },
    [apply],
  );

  const onSit = useCallback(
    (seat?: number) => {
      leftOnPurpose.current = false;
      setKicked(false);
      setSkipped(0);
      void run("sit", () => sitBlackjack(tableKey, seat));
    },
    [run, tableKey],
  );
  const onBet = useCallback(
    (amount: number) => {
      void run("bet", () => betBlackjack(tableKey, amount), true).then((ok) => {
        if (ok) {
          setLastBet(amount);
          setSkipped(0);
        }
      });
    },
    [run, tableKey],
  );
  const onAct = useCallback((action: "hit" | "stand" | "double") => void run(action, () => actBlackjack(tableKey, action), action === "double"), [run, tableKey]);
  const onLeave = useCallback(() => {
    leftOnPurpose.current = true;
    void run("leave", () => leaveBlackjack(tableKey));
  }, [run, tableKey]);

  // Clear a stale error when the table moves on to a new phase.
  const phaseKey = table ? `${table.phase}:${table.round_id}:${table.turn}` : "";
  useEffect(() => {
    setError(null);
  }, [phaseKey]);

  // ── Session tally, idle notices, cash refresh ─────────────────────────────
  const counted = useRef(new Set<number>());
  const prev = useRef<{ phase: BlackjackTable["phase"]; seated: boolean } | null>(null);

  useEffect(() => {
    if (!table) return;
    const before = prev.current;
    prev.current = { phase: table.phase, seated: Boolean(mySeat) };

    // Settled hand: count it once, and pick up the payout.
    if (table.phase === "results" && table.round_id && mySeat?.outcome && mySeat.bet > 0 && !counted.current.has(table.round_id)) {
      counted.current.add(table.round_id);
      const net = netOf(mySeat);
      setTally((current) => ({
        net: Math.round((current.net + net) * 100) / 100,
        hands: current.hands + 1,
        wins: current.wins + (net > 0 ? 1 : 0),
        losses: current.losses + (net < 0 ? 1 : 0),
        pushes: current.pushes + (net === 0 ? 1 : 0),
      }));
      void useProfileStore.getState().fetchPortfolio();
    }

    if (!before) return;
    // Cards went out and we had no chips down: the server counts that as a skipped round.
    if (before.phase === "betting" && table.phase === "playing") {
      if (mySeat && mySeat.bet === 0) setSkipped((count) => count + 1);
      if (before.seated && !mySeat && !leftOnPurpose.current) {
        setKicked(true);
        setSkipped(0);
      }
    }
  }, [table, mySeat]);

  const players = useMemo(() => (table ? table.seats.filter((seat) => seat && seat.bet > 0 && seat.hand.length > 0).length : 0), [table]);

  if (!table) {
    return (
      <GamesFrame kicker="Blackjack" title="Blackjack">
        {loadError ? (
          <p className={styles.empty}>
            {loadError} <Link href="/games/blackjack">Back to the tables</Link>
          </p>
        ) : (
          <div className={styles.feltSkeleton} aria-busy="true" />
        )}
      </GamesFrame>
    );
  }

  const canSit = Boolean(user) && !mySeat;
  const orderOf = (index: number) =>
    table.seats.slice(0, index).filter((seat) => seat && seat.bet > 0 && seat.hand.length > 0).length;
  const dealerTotal = table.dealer.hand.length ? handValue(table.dealer.hand).total : null;
  const dealerDone = !table.dealer.hidden && table.dealer.hand.length > 0;

  return (
    <GamesFrame
      kicker="Blackjack"
      title={table.name}
      live={connected}
      blurb={
        <>
          <b>{fmtNumber(table.min_bet, "$")}</b>–<b>{fmtNumber(table.max_bet, "$")}</b> a hand. Blackjack pays <b>3:2</b>.
        </>
      }
      aside={
        <>
          <Link href="/games/blackjack" className={styles.back}>
            <FaArrowLeft aria-hidden="true" /> Tables
          </Link>
          <nav className={styles.switcher} aria-label="Tables">
            {TABLE_KEYS.map((entry) => (
              <Link key={entry.key} href={`/games/blackjack/${entry.key}`} aria-current={entry.key === table.key ? "page" : undefined}>
                {entry.label}
              </Link>
            ))}
          </nav>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.felt} data-phase={table.phase} aria-label={`${table.name} felt`}>
            <div className={styles.feltTop}>
              <Shoe remaining={table.shoe_remaining} size={table.shoe_size} compact={phone} />
              <div className={styles.dealer}>
                <span className={styles.dealerLabel}>Dealer</span>
                <div className={styles.dealerCards}>
                  {table.dealer.hand.length ? (
                    <Hand cards={table.dealer.hand} width={phone ? 42 : 66} step={phone ? 20 : 30} order={players} players={players} stagger={table.phase === "playing" && table.turn === null && table.dealer.hidden} />
                  ) : (
                    <span className={styles.dealerEmpty} aria-hidden="true" />
                  )}
                </div>
                {dealerTotal !== null ? (
                  <span className={styles.dealerValue} data-bust={(dealerDone && dealerTotal > 21) || undefined}>
                    {table.dealer.hidden ? `${dealerTotal} + ?` : dealerDone && dealerTotal > 21 ? `Bust ${dealerTotal}` : dealerTotal}
                  </span>
                ) : (
                  <span className={styles.dealerRule}>Stands on 17</span>
                )}
              </div>
              <div className={styles.feltInfo}>
                {table.round_id ? <span>Round #{table.round_id}</span> : <span>Between rounds</span>}
                <span>
                  <FaEye aria-hidden="true" /> {fmtInteger(table.spectators)} watching
                </span>
              </div>
            </div>

            <PhaseBanner table={table} myIndex={myIndex} />


            <div className={styles.seats}>
              <svg className={styles.print} viewBox="0 0 800 120" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <path id={`bj-arc-a-${table.key}`} d="M 110 20 Q 400 120 690 20" />
                  <path id={`bj-arc-b-${table.key}`} d="M 170 52 Q 400 142 630 52" />
                </defs>
                <text className={styles.printBig}>
                  <textPath href={`#bj-arc-a-${table.key}`} startOffset="50%" textAnchor="middle">
                    BLACKJACK PAYS 3 TO 2
                  </textPath>
                </text>
                <text className={styles.printSmall}>
                  <textPath href={`#bj-arc-b-${table.key}`} startOffset="50%" textAnchor="middle">
                    DEALER STANDS ON ALL 17s · DOUBLE ON ANY TWO
                  </textPath>
                </text>
              </svg>
              {table.seats.map((seat, index) => (
                <div key={index} className={styles.seatWrap} style={{ "--arc": ARC[index] } as React.CSSProperties}>
                  <Seat
                    seat={seat}
                    index={index}
                    table={table}
                    isMe={index === myIndex}
                    canSit={canSit}
                    sitting={busy === "sit"}
                    onSit={onSit}
                    compact={phone}
                    players={players}
                    playerOrder={orderOf(index)}
                  />
                </div>
              ))}
            </div>
          </section>

          <BlackjackControls
            table={table}
            mySeat={mySeat}
            myIndex={myIndex}
            signedIn={Boolean(user)}
            busy={busy}
            error={error}
            cash={wallet.cash}
            lastBet={lastBet}
            skipped={skipped}
            kicked={kicked}
            onSit={onSit}
            onBet={onBet}
            onAct={onAct}
            onLeave={onLeave}
          />
        </div>

        <aside className={styles.rail}>
          <section className={styles.block} aria-label="Your session">
            <h2 className={styles.secHead}>This session</h2>
            <div className={styles.tally}>
              <b className={tally.net > 0 ? styles.up : tally.net < 0 ? styles.down : undefined}>
                {tally.net > 0 ? "+" : tally.net < 0 ? "−" : ""}
                {fmtNumber(Math.abs(tally.net), "$")}
              </b>
              <span>
                {tally.hands ? (
                  <>
                    <em>{tally.hands}</em> {tally.hands === 1 ? "hand" : "hands"} · <em>{tally.wins}</em>W <em>{tally.losses}</em>L <em>{tally.pushes}</em>P
                  </>
                ) : user ? (
                  "No hands yet. Up or down starts with your first bet."
                ) : (
                  "Spectating."
                )}
              </span>
            </div>
          </section>

          <section className={styles.block} aria-label="Recent rounds">
            <h2 className={styles.secHead}>
              Last rounds <small>{table.history.length ? table.history.length : ""}</small>
            </h2>
            {table.history.length ? (
              <ol className={styles.history}>
                {table.history.map((round) => {
                  const mine = user ? round.results.find((result) => result.username === user.username) : undefined;
                  const net = mine ? Math.round((mine.payout - mine.bet) * 100) / 100 : null;
                  return (
                    <li key={round.round_id}>
                      <span className={styles.histRound}>#{round.round_id}</span>
                      <span className={styles.histDealer} data-bust={round.dealer > 21 || undefined}>
                        <small>D</small>
                        {round.dealer > 21 ? "bust" : round.dealer}
                      </span>
                      <span className={styles.histSeats}>
                        {round.results.map((result, index) => (
                          <span key={index} data-outcome={result.outcome} data-me={(user && result.username === user.username) || undefined} title={`${result.username}: ${result.outcome}`}>
                            {result.username}
                          </span>
                        ))}
                      </span>
                      <span className={`${styles.histNet} ${net === null ? "" : net > 0 ? styles.up : net < 0 ? styles.down : ""}`}>
                        {net === null ? "" : net > 0 ? `+${fmtNumber(net, "$")}` : net < 0 ? `−${fmtNumber(-net, "$")}` : "push"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={styles.quiet}>No hands dealt here since the last restart.</p>
            )}
          </section>

          <section className={styles.block} aria-label="House rules">
            <h2 className={styles.secHead}>House rules</h2>
            <ul className={styles.rules}>
              {HOUSE_RULES.map((rule) => (
                <li key={rule.big}>
                  <b>{rule.big}</b>
                  <span>{rule.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </GamesFrame>
  );
}

function PhaseBanner({ table, myIndex }: { table: BlackjackTable; myIndex: number }) {
  const moment = momentOf(table);
  const left = useRemaining(table.deadline, 250);
  const secs = left === null ? null : Math.ceil(left / 1000);
  const seated = table.seats.filter(Boolean);
  const mySeat = myIndex >= 0 ? table.seats[myIndex] : null;

  let head: React.ReactNode;
  let sub: React.ReactNode = null;
  let tone: "blue" | "up" | "down" | "gold" | undefined;
  let timer: React.ReactNode = null;

  if (moment.kind === "idle") {
    head = mySeat ? "Place your bets" : seated.length ? "Waiting on a bet" : "Table's open";
    sub = "First chip down starts a 15s clock";
  } else if (moment.kind === "betting") {
    const inCount = seated.filter((seat) => seat && seat.bet > 0).length;
    head = secs !== null ? `Bets close in ${secs}s` : "Bets are open";
    sub = `${inCount} in · ${seated.length - inCount} deciding`;
    tone = "blue";
    timer = <TimerBar deadline={table.deadline} totalMs={BJ_BET_MS} label="Betting closes" />;
  } else if (moment.kind === "dealing") {
    head = "Dealing";
    sub = "Cards coming out";
  } else if (moment.kind === "turn") {
    const seat = table.seats[moment.seat];
    const mine = moment.seat === myIndex;
    head = mine ? "Your turn" : `${seat?.username ?? "Seat"}'s turn`;
    sub = mine ? "Hit, stand or double" : `Seat ${moment.seat + 1}`;
    tone = "blue";
    timer = <TimerBar deadline={table.deadline} totalMs={BJ_TURN_MS} label={mine ? "Your turn" : "Turn"} />;
  } else if (moment.kind === "dealer") {
    head = "Dealer's turn";
    sub = "Draws to 17";
  } else {
    const dealer = handValue(table.dealer.hand).total;
    const dealerBj = table.dealer.hand.length === 2 && dealer === 21;
    const dealerLine = dealerBj ? "Dealer blackjack" : dealer > 21 ? "Dealer busts" : `Dealer stands on ${dealer}`;
    if (mySeat && mySeat.outcome && mySeat.bet > 0) {
      const net = netOf(mySeat);
      if (mySeat.outcome === "blackjack") {
        head = `Blackjack! +${fmtNumber(net, "$")}`;
        tone = "gold";
      } else if (net > 0) {
        head = `You win +${fmtNumber(net, "$")}`;
        tone = "up";
      } else if (net < 0) {
        head = mySeat.outcome === "bust" ? `Bust −${fmtNumber(wagerOf(mySeat), "$")}` : `House wins −${fmtNumber(wagerOf(mySeat), "$")}`;
        tone = "down";
      } else {
        head = "Push. Bet back";
      }
      sub = dealerLine;
    } else {
      head = dealerLine;
      const winners = table.seats.filter((seat) => seat && seat.bet > 0 && seat.payout > wagerOf(seat)).length;
      const hands = table.seats.filter((seat) => seat && seat.bet > 0).length;
      sub = hands ? `${winners} of ${hands} ${hands === 1 ? "hand beats" : "hands beat"} the house` : null;
    }
    if (secs !== null) sub = sub ? `${sub} · next round in ${secs}s` : `Next round in ${secs}s`;
  }

  const announce = moment.kind === "betting" ? "Bets are open" : typeof head === "string" ? head : "";

  return (
    <div className={styles.banner} data-tone={tone} data-kind={moment.kind}>
      <span className={styles.srOnly} aria-live="polite">
        {announce}
      </span>
      <strong aria-hidden="true" key={`${moment.kind}-${table.round_id}-${moment.kind === "turn" ? moment.seat : ""}`}>{head}</strong>
      {sub ? <span>{sub}</span> : null}
      {timer ? <div className={styles.bannerTimer}>{timer}</div> : null}
    </div>
  );
}
