"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { FaPlus } from "react-icons/fa6";
import { Oshimark } from "@/app/components/common/oshimark";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { MAX_STARS, RARITY_NAME } from "@/app/lib/games/rarity";
import type { TalentCard as Card } from "@/app/lib/games/types";
import styles from "@/app/components/games/locker/trophy-shelf.module.scss";

const SLOTS = 5;

type Props = {
  cards: Card[];
  /** Your own shelf: empty slots link to the collection to pin something. */
  editable?: boolean;
  owner?: string;
};

/**
 * The showcase as a trophy case: slot 1 (the ace) in the middle and biggest, the rest flanking
 * it, each under its own rarity-tinted spotlight with a plaque.
 */
export function TrophyShelf({ cards, editable = false, owner }: Props) {
  const filled = cards.slice(0, SLOTS);
  const empties = editable ? SLOTS - filled.length : 0;

  if (!filled.length && !editable) {
    return (
      <section className={styles.case} data-empty aria-label="Showcase">
        <p className={styles.emptyNote}>{owner ? `${owner} hasn't pinned any cards yet.` : "No cards pinned yet."}</p>
      </section>
    );
  }

  return (
    <section className={styles.case} aria-label="Showcase">
      <span className={styles.wall} aria-hidden="true" />
      <ol className={styles.row}>
        {filled.map((card, index) => (
          <li key={card.key} className={styles.slot} data-slot={index + 1} data-rarity={card.rarity} style={{ "--i": index } as CSSProperties}>
            <span className={styles.beam} aria-hidden="true" />
            <div className={styles.cardWrap}>
              <TalentCard card={card} width={index === 0 ? 236 : 188} className={styles.card} />
            </div>
            <span className={styles.plaque}>
              <Oshimark icon={card.icon} symbol={card.symbol} size={14} />
              <b>{card.rarity}</b>
              <span>{RARITY_NAME[card.rarity]}</span>
              <span className={styles.stars} aria-label={`${card.stars} of ${MAX_STARS} stars`}>
                {"★".repeat(Math.max(0, Math.min(MAX_STARS, card.stars)))}
              </span>
            </span>
          </li>
        ))}
        {Array.from({ length: empties }, (_, index) => (
          <li key={`empty-${index}`} className={styles.slot} data-slot={filled.length + index + 1} data-empty>
            <Link href="/games/collection#showcase" className={styles.emptySlot} aria-label="Pin a card to your showcase">
              <FaPlus aria-hidden="true" />
              <span>Pin a card</span>
            </Link>
            <span className={styles.plaque} data-blank aria-hidden="true">
              —
            </span>
          </li>
        ))}
      </ol>
      <span className={styles.ledge} aria-hidden="true" />
    </section>
  );
}
