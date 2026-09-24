"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { CardBack, TalentCard } from "@/app/components/games/cards/talent-card";
import { claimReward } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { TalentCard as Card } from "@/app/lib/games/types";
import { useGamesStore } from "@/app/stores/games-store";
import styles from "@/app/components/games/collection/starter-pack.module.scss";

/** The one-time free pack: five C cards, enough to build a duel deck. */
export function StarterPack({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<(Card & { was_new?: boolean })[] | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const result = await claimReward("starter");
      setCards(result.reward.cards ?? []);
      useGamesStore.getState().setShards(result.shards);
      void useGamesStore.getState().loadCollection({ quiet: true });
    } catch (err) {
      const code = String((err as Error).message);
      if (code === "reward_already_claimed") {
        void useGamesStore.getState().loadCollection({ quiet: true });
        onDone();
        return;
      }
      setError(gameErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (cards) {
    return (
      <section className={`${styles.pack} ${styles.opened}`} aria-labelledby="starter-title">
        <div className={styles.copy}>
          <span className={styles.kicker}>Starter pack</span>
          <h2 id="starter-title" className={styles.title}>
            Five in the binder
          </h2>
          <p aria-live="polite">
            {cards.map((card) => card.name).join(", ")}. That&apos;s a duel deck.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/games/duel">
              Take them to a duel
            </Link>
            <button type="button" className={styles.secondary} onClick={onDone}>
              To the binder
            </button>
          </div>
        </div>
        <div className={styles.reveal}>
          {cards.map((card, index) => (
            <div key={card.key} className={styles.flip} style={{ "--i": index } as CSSProperties}>
              <div className={styles.flipInner}>
                <div className={styles.flipBack}>
                  <CardBack width={132} />
                </div>
                <div className={styles.flipFace}>
                  <TalentCard card={card} width={132} isNew={card.was_new !== false} compact />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.pack} aria-labelledby="starter-title">
      <div className={styles.copy}>
        <span className={styles.kicker}>Free · once per account</span>
        <h2 id="starter-title" className={styles.title}>
          Starter pack
        </h2>
        <p>5 free cards, enough for a duel deck. No pull, no catch.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void claim()} disabled={busy}>
            {busy ? "Opening…" : "Claim 5 free cards"}
          </button>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.fan} aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} style={{ "--i": index - 2 } as CSSProperties}>
            <CardBack width={104} glow={index === 2 ? "R" : null} />
          </span>
        ))}
      </div>
    </section>
  );
}
