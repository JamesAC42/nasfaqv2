"use client";

import type { CSSProperties } from "react";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { PlayingCard } from "@/app/components/games/shared/playing-card";
import { TimerBar } from "@/app/components/games/shared/timer-bar";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import type { BlackjackCard, BlackjackSeat, BlackjackTable } from "@/app/lib/games/types";
import { BJ_TURN_MS, CHIP_COLOR, chipLabel, chipStack, handValue, netOf, valueText, wagerOf } from "@/app/components/games/blackjack/bj-utils";
import styles from "@/app/components/games/blackjack/bj-parts.module.scss";

const chipStyle = (value: number) => {
  const color = CHIP_COLOR[value] ?? CHIP_COLOR[5];
  return { "--chip": color.face, "--chip-edge": color.edge, "--chip-ink": color.ink } as CSSProperties;
};

/** A round casino chip seen from above (the picker). */
export function Chip({ value, size = 44 }: { value: number; size?: number }) {
  return (
    <span className={styles.chip} style={{ ...chipStyle(value), "--size": `${size}px` } as CSSProperties} aria-hidden="true">
      <b>{chipLabel(value)}</b>
    </span>
  );
}

/** A bet as a leaning stack of chips, side-on, with the amount under it. */
export function ChipStack({ amount, doubled = false, size = 34 }: { amount: number; doubled?: boolean; size?: number }) {
  const chips = chipStack(amount, 6);
  const extra = doubled ? chipStack(amount, 6) : [];
  return (
    <span className={styles.stackWrap} style={{ "--size": `${size}px` } as CSSProperties}>
      <span className={styles.stacks}>
        <span className={styles.stack} aria-hidden="true">
          {chips.map((value, index) => (
            <i key={index} style={{ ...chipStyle(value), "--i": index } as CSSProperties} />
          ))}
        </span>
        {doubled ? (
          <span className={styles.stack} aria-hidden="true">
            {extra.map((value, index) => (
              <i key={index} style={{ ...chipStyle(value), "--i": index } as CSSProperties} />
            ))}
          </span>
        ) : null}
      </span>
      <b className={styles.stackAmount}>
        {fmtNumber(amount * (doubled ? 2 : 1), "$")}
        {doubled ? <em title="Doubled down">×2</em> : null}
      </b>
    </span>
  );
}

/** Fanned cards. New cards deal in; the first two stagger in dealing order. */
export function Hand({
  cards,
  width,
  step,
  order,
  players,
  highlight = false,
  animate = true,
  stagger = false,
}: {
  cards: BlackjackCard[];
  width: number;
  /** Horizontal offset per card after the first. */
  step: number;
  /** Position in the dealing order for the stagger (dealer goes last). */
  order: number;
  players: number;
  highlight?: boolean;
  animate?: boolean;
  /** Only while the opening deal is going out: later cards (hits, the hole card flip) land at once. */
  stagger?: boolean;
}) {
  const fanWidth = width + Math.max(0, cards.length - 1) * step;
  return (
    <span className={styles.hand} style={{ width: fanWidth, height: Math.round(width * 1.4) + Math.max(0, cards.length - 1) * 3 } as CSSProperties}>
      {cards.map((card, index) => {
        const delay = stagger && index < 2 ? (index * (players + 1) + order) * 80 : 0;
        // The hole card flips over with a fresh key so it deals in again face up.
        const key = card ? `${index}-${card.rank}${card.suit}` : `${index}-down`;
        return (
          <span key={key} className={styles.slot} style={{ left: index * step, top: Math.max(0, cards.length - 1 - index) * 3, "--delay": `${delay}ms` } as CSSProperties}>
            <PlayingCard card={card} width={width} deal={animate} highlight={highlight && index === cards.length - 1} />
          </span>
        );
      })}
    </span>
  );
}

export function Shoe({ remaining, size, compact = false }: { remaining: number; size: number; compact?: boolean }) {
  const left = Math.max(0, Math.min(1, remaining / size));
  const cut = 0.25;
  return (
    <div className={styles.shoe} data-compact={compact || undefined} title={`${remaining} of ${size} cards left. Reshuffles under ${Math.round(size * cut)}.`}>
      <span className={styles.shoeBox} aria-hidden="true">
        <PlayingCard card={null} width={compact ? 22 : 30} />
        <PlayingCard card={null} width={compact ? 22 : 30} />
        <PlayingCard card={null} width={compact ? 22 : 30} />
      </span>
      <span className={styles.shoeText}>
        <small>Shoe</small>
        <b>{fmtInteger(remaining)}</b>
        <span className={styles.shoeBar} aria-hidden="true">
          <i style={{ transform: `scaleX(${left})` }} />
          <em style={{ left: `${cut * 100}%` }} />
        </span>
      </span>
    </div>
  );
}

type SeatData = NonNullable<BlackjackSeat>;

function Outcome({ seat }: { seat: SeatData }) {
  if (!seat.outcome) return null;
  const net = netOf(seat);
  if (seat.outcome === "blackjack") {
    return (
      <span className={styles.badge} data-kind="bj">
        <strong>Blackjack</strong>
        <em>+{fmtNumber(net, "$")}</em>
      </span>
    );
  }
  if (seat.outcome === "win") {
    return (
      <span className={styles.badge} data-kind="win">
        <strong>Win</strong>
        <em>+{fmtNumber(net, "$")}</em>
      </span>
    );
  }
  if (seat.outcome === "push") {
    return (
      <span className={styles.badge} data-kind="push">
        <strong>Push</strong>
      </span>
    );
  }
  return (
    <span className={styles.badge} data-kind="loss">
      <strong>{seat.outcome === "bust" ? "Bust" : "Loss"}</strong>
      <em>−{fmtNumber(wagerOf(seat), "$")}</em>
    </span>
  );
}

function LiveStatus({ seat, phase }: { seat: SeatData; phase: BlackjackTable["phase"] }) {
  // After the reset the last outcome lingers with bet 0: don't show a stale badge.
  if (seat.bet === 0) return null;
  if (phase === "results") return <Outcome seat={seat} />;
  if (seat.status === "bust")
    return (
      <span className={styles.badge} data-kind="loss">
        <strong>Bust</strong>
      </span>
    );
  if (seat.status === "blackjack")
    return (
      <span className={styles.badge} data-kind="bj">
        <strong>Blackjack</strong>
      </span>
    );
  if (seat.status === "stood" && seat.doubled) return <span className={styles.tag}>Doubled</span>;
  if (seat.status === "stood") return <span className={styles.tag}>Stand</span>;
  return null;
}

export function Seat({
  seat,
  index,
  table,
  isMe,
  canSit,
  sitting,
  onSit,
  compact,
  players,
  playerOrder,
}: {
  seat: BlackjackSeat;
  index: number;
  table: BlackjackTable;
  isMe: boolean;
  canSit: boolean;
  sitting: boolean;
  onSit: (index: number) => void;
  compact: boolean;
  players: number;
  playerOrder: number;
}) {
  if (!seat) {
    return (
      <div className={styles.seat} data-empty="true">
        <div className={styles.cards} />
        {canSit ? (
          <button type="button" className={styles.spot} data-open="true" onClick={() => onSit(index)} disabled={sitting} aria-label={`Sit in seat ${index + 1}`}>
            <span>{sitting ? "…" : "Sit"}</span>
          </button>
        ) : (
          <span className={styles.spot} aria-hidden="true" />
        )}
        <span className={styles.who} data-empty="true">
          <span className={styles.name}>Seat {index + 1}</span>
        </span>
      </div>
    );
  }

  const isTurn = table.phase === "playing" && table.turn === index;
  const dealing = table.phase === "playing" && table.turn === null && table.dealer.hidden;
  const inHand = seat.bet > 0 && seat.hand.length > 0;
  const live = table.phase === "playing" && (seat.status === "playing" || seat.status === "betting");
  const value = inHand ? valueText(seat.hand, live) : null;
  const total = handValue(seat.hand).total;
  const sittingOut = seat.bet === 0 && (table.phase === "playing" || table.phase === "results");
  const width = compact ? 30 : 50;
  const step = compact ? Math.min(12, seat.hand.length > 1 ? 34 / (seat.hand.length - 1) : 12) : 22;

  return (
    <div className={styles.seat} data-turn={isTurn || undefined} data-me={isMe || undefined} data-out={sittingOut || undefined} data-outcome={table.phase === "results" ? seat.outcome ?? undefined : undefined}>
      <div className={styles.cards}>
        {inHand ? <Hand cards={seat.hand} width={width} step={step} order={playerOrder} players={players} highlight={isTurn} stagger={dealing} /> : null}
      </div>
      <div className={styles.meta}>
        {value ? (
          <span className={styles.value} data-bust={total > 21 || undefined} aria-label={`Hand value ${value}`}>
            {value}
          </span>
        ) : null}
        <span aria-live={isMe ? "polite" : undefined}>
          <LiveStatus seat={seat} phase={table.phase} />
        </span>
      </div>
      <span className={styles.spot} data-bet={seat.bet > 0 || undefined}>
        {seat.bet > 0 ? <ChipStack amount={seat.bet} doubled={seat.doubled} size={compact ? 24 : 38} /> : <small>{sittingOut ? "Out" : table.phase === "betting" ? "…" : ""}</small>}
      </span>
      <span className={styles.who}>
        <PlayerAvatar username={seat.username} color={seat.profile_color} size={compact ? 18 : 24} />
        <span className={styles.name} title={seat.username}>
          {seat.username}
        </span>
        {isMe ? <span className={styles.you}>You</span> : null}
      </span>
      {isTurn ? (
        <div className={styles.turnTimer}>
          <TimerBar deadline={table.deadline} totalMs={BJ_TURN_MS} label={`${seat.username}'s turn`} />
        </div>
      ) : null}
    </div>
  );
}
