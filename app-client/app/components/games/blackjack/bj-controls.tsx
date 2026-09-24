"use client";

import { useState } from "react";
import { FaArrowRotateLeft, FaXmark } from "react-icons/fa6";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fmtNumber } from "@/app/lib/format";
import type { BlackjackSeat, BlackjackTable } from "@/app/lib/games/types";
import { Chip } from "@/app/components/games/blackjack/bj-parts";
import { BJ_IDLE_KICK, chipsFor, netOf, usePhone, valueText } from "@/app/components/games/blackjack/bj-utils";
import styles from "@/app/components/games/blackjack/bj-controls.module.scss";

export type BjAction = "sit" | "bet" | "hit" | "stand" | "double" | "leave";

type Props = {
  table: BlackjackTable;
  mySeat: NonNullable<BlackjackSeat> | null;
  myIndex: number;
  signedIn: boolean;
  busy: BjAction | null;
  error: string | null;
  cash: number | null;
  lastBet: number | null;
  skipped: number;
  kicked: boolean;
  onSit: (seat?: number) => void;
  onBet: (amount: number) => void;
  onAct: (action: "hit" | "stand" | "double") => void;
  onLeave: () => void;
};

export function BlackjackControls(props: Props) {
  const { table, mySeat, signedIn, busy, error, kicked, onSit } = props;
  const open = table.seats.filter((seat) => !seat).length;

  let body: React.ReactNode;
  if (!signedIn) {
    body = (
      <div className={styles.row}>
        <SignInToPlay what="take a seat" />
      </div>
    );
  } else if (!mySeat) {
    body = (
      <div className={styles.row}>
        <p className={styles.note}>
          {kicked ? "The dealer gave your seat away after three rounds without a bet. Pull up a chair again whenever." : open ? "Watching. Tap an open seat on the felt, or grab the first one." : "Table's full. Watch a hand or two, or try another table."}
        </p>
        {open ? (
          <button type="button" className={styles.primary} onClick={() => onSit()} disabled={busy !== null}>
            {busy === "sit" ? "Sitting…" : "Sit down"}
          </button>
        ) : null}
      </div>
    );
  } else {
    body = <Seated {...props} mySeat={mySeat} />;
  }

  return (
    <section className={styles.controls} aria-label="Your seat">
      {body}
      <p className={styles.error} role="alert" aria-live="assertive">
        {error ?? ""}
      </p>
    </section>
  );
}

function Seated({ table, mySeat, busy, cash, lastBet, skipped, onBet, onAct, onLeave, myIndex }: Props & { mySeat: NonNullable<BlackjackSeat> }) {
  const canBet = (table.phase === "idle" || table.phase === "betting") && mySeat.bet === 0;
  const myTurn = table.phase === "playing" && table.turn === myIndex;
  const canLeave = mySeat.bet === 0 || table.phase === "idle";
  const inflight = busy !== null;

  const leave = canLeave ? (
    <button type="button" className={styles.leave} onClick={onLeave} disabled={inflight}>
      <FaXmark aria-hidden="true" /> {busy === "leave" ? "Leaving…" : "Leave seat"}
    </button>
  ) : null;

  if (canBet) {
    return (
      <>
        <BetPicker key={table.key} table={table} cash={cash} lastBet={lastBet} busy={busy} onBet={onBet} leave={leave} />
        {skipped > 0 ? (
          <p className={styles.idle}>
            {skipped >= BJ_IDLE_KICK - 1
              ? "You've sat out two rounds. Skip one more and the dealer gives your seat away."
              : "You sat out a round. Three in a row and you lose the seat."}
          </p>
        ) : null}
      </>
    );
  }

  const hand = mySeat.hand;
  const value = hand.length ? valueText(hand, table.phase === "playing" && mySeat.status === "playing") : null;

  if (myTurn) {
    const canDouble = hand.length === 2 && !mySeat.doubled;
    return (
      <div className={styles.turn}>
        <div className={styles.turnHead}>
          <span className={styles.turnLabel}>Your move</span>
          <span className={styles.turnValue}>
            <small>You have</small>
            <b>{value}</b>
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.hit} onClick={() => onAct("hit")} disabled={inflight}>
            {busy === "hit" ? "…" : "Hit"}
          </button>
          <button type="button" className={styles.stand} onClick={() => onAct("stand")} disabled={inflight}>
            {busy === "stand" ? "…" : "Stand"}
          </button>
          {canDouble ? (
            <button type="button" className={styles.double} onClick={() => onAct("double")} disabled={inflight || (cash !== null && cash < mySeat.bet)} title="Double your bet, take exactly one more card">
              {busy === "double" ? "…" : <>Double · {fmtNumber(mySeat.bet, "$")}</>}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  let line: React.ReactNode;
  if (table.phase === "results" && mySeat.outcome) {
    const net = netOf(mySeat);
    line = (
      <>
        <b className={net > 0 ? styles.up : net < 0 ? styles.down : undefined}>{net > 0 ? `+${fmtNumber(net, "$")}` : net < 0 ? `−${fmtNumber(-net, "$")}` : "Push"}</b>
        <span>this hand. Next round opens in a moment.</span>
      </>
    );
  } else if (mySeat.bet > 0 && table.phase === "betting") {
    line = (
      <>
        <b>{fmtNumber(mySeat.bet, "$")}</b>
        <span>down. Cards come out when the clock runs out or everyone&apos;s in.</span>
      </>
    );
  } else if (mySeat.bet > 0 && table.phase === "playing") {
    const waitingOn = table.turn !== null ? table.seats[table.turn] : null;
    line = (
      <>
        {value ? <b>{value}</b> : null}
        <span>
          {mySeat.status === "bust"
            ? "Busted. Better luck next shoe."
            : mySeat.status === "blackjack"
              ? "Blackjack! Waiting on the dealer."
              : waitingOn
                ? `Waiting on ${waitingOn.username}.`
                : table.dealer.hidden
                  ? "Dealing…"
                  : "Dealer's drawing."}
        </span>
      </>
    );
  } else {
    line = <span>Sitting this one out. Bet when the next round opens.</span>;
  }

  return (
    <div className={styles.row}>
      <p className={styles.status} aria-live="polite">
        {line}
      </p>
      {leave}
    </div>
  );
}

function BetPicker({
  table,
  cash,
  lastBet,
  busy,
  onBet,
  leave,
}: {
  table: BlackjackTable;
  cash: number | null;
  lastBet: number | null;
  busy: BjAction | null;
  onBet: (amount: number) => void;
  leave: React.ReactNode;
}) {
  const min = table.min_bet;
  const max = table.max_bet;
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
  const [text, setText] = useState(() => String(clamp(lastBet ?? min)));
  const amount = Number(text);
  const valid = Number.isFinite(amount) && amount >= min && amount <= max;
  const short = cash !== null && valid && amount > cash;
  const chips = chipsFor(min, max);
  const phone = usePhone();

  const add = (value: number) => {
    const base = Number.isFinite(amount) && amount >= min ? amount : 0;
    setText(String(Math.min(max, base + value)));
  };

  return (
    <div className={styles.bet}>
      <div className={styles.chipRow} role="group" aria-label="Add chips">
        {chips.map((value) => (
          <button key={value} type="button" className={styles.chipButton} onClick={() => add(value)} aria-label={`Add ${fmtNumber(value, "$")}`} disabled={busy !== null}>
            <Chip value={value} size={phone ? 36 : 42} />
          </button>
        ))}
        <button type="button" className={styles.mini} onClick={() => setText(String(min))} disabled={busy !== null}>
          Min
        </button>
        <button type="button" className={styles.mini} onClick={() => setText(String(max))} disabled={busy !== null}>
          Max
        </button>
        {lastBet ? (
          <button type="button" className={styles.mini} onClick={() => setText(String(clamp(lastBet)))} disabled={busy !== null} title="Same bet as last time">
            <FaArrowRotateLeft aria-hidden="true" /> {fmtNumber(lastBet, "$")}
          </button>
        ) : null}
      </div>
      <form
        className={styles.betRow}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !short && busy === null) onBet(amount);
        }}
      >
        <label className={styles.amount}>
          <span className={styles.srOnly}>Bet amount</span>
          <i aria-hidden="true">$</i>
          <input
            inputMode="numeric"
            value={text}
            onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))}
            aria-invalid={!valid || undefined}
            aria-describedby="bj-limits"
          />
          <small id="bj-limits">
            {fmtNumber(min, "$")}–{fmtNumber(max, "$")}
          </small>
        </label>
        <button type="submit" className={styles.primary} disabled={!valid || short || busy !== null}>
          {busy === "bet" ? "Betting…" : valid ? `Bet ${fmtNumber(amount, "$")}` : "Bet"}
        </button>
        {leave}
      </form>
      {short ? <p className={styles.hint}>Not enough cash for that. You have {fmtNumber(cash, "$")}.</p> : !valid && text ? <p className={styles.hint}>Table limits are {fmtNumber(min, "$")} to {fmtNumber(max, "$")}.</p> : null}
    </div>
  );
}
