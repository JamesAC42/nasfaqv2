"use client";

/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { useArtImage } from "@/app/components/common/use-art-image";
import { artId, resolveArtUrl } from "@/app/lib/art-manifest";
import { DEALER_FALLBACK_POSE, type DealerState, type TableDealer } from "@/app/lib/games/dealers";
import { talentAccent } from "@/app/lib/talent-color";
import styles from "@/app/components/games/blackjack/bj-dealer.module.scss";

const STATE_LABEL: Record<DealerState, string> = {
  idle: "waiting on bets",
  shuffle: "shuffling",
  deal: "dealing",
  reveal: "showing the hole card",
  house: "the house wins",
  bust: "dealer busts",
  blackjack: "applauding the winners",
  push: "a push",
};

/** The dealer's picture for this moment: their dealer art when it exists, else their reaction set. */
export function DealerArt({ symbol, state, size }: { symbol: string; state: DealerState; size: number }) {
  const art = useArtImage(artId(symbol, "dealer", state));
  if (!art) return <ReactionFace symbol={symbol} pose={DEALER_FALLBACK_POSE[state]} size={size} crop="full" className={styles.art} />;
  const want = size * 2;
  const sizes = Object.entries(art.srcset ?? {})
    .map(([width, path]) => [Number(width), path] as const)
    .filter(([width]) => Number.isFinite(width))
    .sort((a, b) => a[0] - b[0]);
  const path = sizes.find(([width]) => width >= want)?.[1] ?? sizes[sizes.length - 1]?.[1] ?? art.src;
  return (
    <span className={styles.art} data-art-id={artId(symbol, "dealer", state)}>
      <img src={resolveArtUrl(path) ?? undefined} alt="" decoding="async" draggable={false} />
    </span>
  );
}

/** "Today's dealer": the table's talent of the day, reacting to the round. */
export function TableDealerCard({ dealer, state, compact = false }: { dealer: TableDealer; state: DealerState; compact?: boolean }) {
  const size = compact ? 58 : 104;
  const accent = talentAccent(dealer.color, "dark");
  return (
    <figure className={styles.host} data-compact={compact || undefined} style={{ "--size": `${size}px`, "--tal": accent } as CSSProperties}>
      <span className={styles.portrait} key={state} data-state={state}>
        {dealer.symbol ? <DealerArt symbol={dealer.symbol} state={state} size={size} /> : null}
      </span>
      <figcaption>
        <small>Today&apos;s dealer</small>
        <b>{dealer.name ?? dealer.symbol}</b>
        <span className={styles.srOnly}>{`, ${STATE_LABEL[state]}`}</span>
      </figcaption>
    </figure>
  );
}

/** One line for a lobby tile: the table's dealer today, face and name. */
export function LobbyDealer({ dealer }: { dealer: TableDealer }) {
  const accent = talentAccent(dealer.color, "dark");
  return (
    <p className={styles.lobby} style={{ "--size": "30px", "--tal": accent } as CSSProperties}>
      <span className={styles.portrait}>{dealer.symbol ? <DealerArt symbol={dealer.symbol} state="idle" size={30} /> : null}</span>
      <span>
        Today&apos;s dealer <b>{dealer.name ?? dealer.symbol}</b>
      </span>
    </p>
  );
}
