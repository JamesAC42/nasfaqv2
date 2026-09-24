"use client";

import type { CSSProperties } from "react";
import { FaChevronLeft, FaChevronRight, FaPlus, FaXmark } from "react-icons/fa6";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import type { TalentCard as Card } from "@/app/lib/games/types";
import { SHOWCASE_SLOTS, type ShowcaseControls } from "@/app/components/games/collection/use-showcase";
import styles from "@/app/components/games/collection/showcase.module.scss";

type Props = {
  showcase: ShowcaseControls;
  cardFor: (key: string) => Card | undefined;
  /** Slot the binder is currently picking for, if any. */
  picking: number | null;
  onPick: (slot: number | null) => void;
  onOpen: (card: Card) => void;
};

/** Five pinned cards on a lit shelf. This is what shows on the profile and the locker. */
export function ShowcaseEditor({ showcase, cardFor, picking, onPick, onOpen }: Props) {
  const { keys, move, unpin, status, error } = showcase;
  const statusText = status === "saving" ? "Saving…" : status === "saved" ? "Saved to your profile" : status === "error" ? error : null;

  return (
    <section className={styles.wrap} id="showcase" aria-labelledby="showcase-title">
      <div className={styles.head}>
        <h2 id="showcase-title" className={styles.heading}>
          Showcase <small>{keys.length}/{SHOWCASE_SLOTS}</small>
        </h2>
        <span className={styles.status} data-state={status} aria-live="polite">
          {statusText ?? "Your best five, on your profile and locker"}
        </span>
      </div>

      <div className={styles.shelf}>
        <ol className={styles.slots}>
          {Array.from({ length: SHOWCASE_SLOTS }, (_, index) => {
            const key = keys[index];
            const card = key ? cardFor(key) : undefined;
            if (!card) {
              const next = index === keys.length;
              const active = next && picking !== null;
              return (
                <li key={`empty-${index}`} className={styles.slot}>
                  <button
                    type="button"
                    className={styles.empty}
                    data-active={active || undefined}
                    disabled={!next}
                    onClick={() => onPick(active ? null : index)}
                    aria-label={active ? "Cancel picking" : `Pick a card for slot ${index + 1}`}
                  >
                    {next ? (
                      <>
                        <FaPlus aria-hidden="true" />
                        <span>{active ? "Pick below" : "Pin a card"}</span>
                      </>
                    ) : (
                      <span className={styles.slotNo}>{index + 1}</span>
                    )}
                  </button>
                  <span className={styles.plate} aria-hidden="true" />
                </li>
              );
            }
            return (
              <li key={card.key} className={styles.slot} data-rarity={card.rarity} style={{ "--i": index } as CSSProperties}>
                <span className={styles.spot} aria-hidden="true" />
                <TalentCard card={card} width={168} onClick={() => onOpen(card)} className={styles.card} />
                <span className={styles.controls}>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${card.name} left`}>
                    <FaChevronLeft aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => unpin(card.key)} aria-label={`Remove ${card.name} from showcase`}>
                    <FaXmark aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index >= keys.length - 1} aria-label={`Move ${card.name} right`}>
                    <FaChevronRight aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <span className={styles.ledge} aria-hidden="true" />
      </div>
    </section>
  );
}
