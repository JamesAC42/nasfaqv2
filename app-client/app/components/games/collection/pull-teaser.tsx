"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { fetchPullFeed } from "@/app/lib/games/api";
import { rarityRank } from "@/app/lib/games/rarity";
import type { FeedPull } from "@/app/lib/games/types";
import styles from "@/app/components/games/collection/pull-teaser.module.scss";

/** Signed-out teaser: the best recent pulls on the floor, fanned out. */
export function PullTeaser({ children }: { children?: React.ReactNode }) {
  const [pulls, setPulls] = useState<FeedPull[]>([]);

  useEffect(() => {
    let alive = true;
    fetchPullFeed(40)
      .then((result) => {
        if (!alive) return;
        const seen = new Set<string>();
        const best = [...result.pulls]
          .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))
          .filter((pull) => (seen.has(pull.card_key) ? false : (seen.add(pull.card_key), true)))
          .slice(0, 5);
        // Best card in the middle of the fan.
        setPulls([best[3], best[1], best[0], best[2], best[4]].filter(Boolean));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className={styles.teaser}>
      <div className={styles.copy}>{children}</div>
      {pulls.length ? (
        <div className={styles.fan} aria-label="Recent pulls">
          {pulls.map((pull, index) => (
            <span key={pull.card_key} style={{ "--i": index - (pulls.length - 1) / 2 } as CSSProperties} className={styles.slot}>
              <TalentCard card={{ ...pull, stars: 1 }} width={150} compact />
              <small>@{pull.username}</small>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
