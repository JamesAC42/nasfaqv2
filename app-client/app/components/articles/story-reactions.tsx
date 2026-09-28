"use client";

import { ReactionFace } from "@/app/components/common/reaction-face";
import { Tip } from "@/app/components/common/tip";
import type { NewsMood } from "@/app/lib/types";
import { talentAccent } from "@/app/lib/talent-color";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/story-reactions.module.scss";

export const MOOD_LABEL: Record<NewsMood["mood"], string> = {
  hype: "HYPE",
  moon: "TO THE MOON",
  smug: "SMUG",
  shock: "SHOOK",
  cope: "COPING",
  idle: "UNBOTHERED",
};

/**
 * The talents in a HoloNews headline reacting to it: each one's reaction face in the mood Jev read
 * from the headline for her. `overlay` stacks small faces on a thumbnail's corner (feed cards);
 * `strip` lays them out large with names under an article's headline.
 */
export function StoryReactions({ reactions, variant, size }: { reactions: NewsMood[]; variant: "overlay" | "strip"; size: number }) {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  if (!reactions.length) return null;
  const shown = reactions.slice(0, variant === "overlay" ? 3 : 6);

  if (variant === "overlay") {
    return (
      <span className={styles.overlay} aria-label={shown.map((entry) => `${entry.symbol}: ${MOOD_LABEL[entry.mood]}`).join(", ")}>
        {shown.map((entry) => {
          const asset = assets.find((row) => row.symbol === entry.symbol);
          return (
            <span key={entry.symbol} className={styles.bubble} style={{ "--tal": talentAccent(asset?.color, theme), width: size, height: size } as React.CSSProperties} data-mood={entry.mood}>
              <ReactionFace symbol={entry.symbol} pose={entry.mood} size={size} />
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <div className={styles.strip}>
      <span className={styles.kicker}>
        <Tip content="Each talent in the headline, reacting the way the headline lands for her. The read comes from Jev (or keywords when it's unsure), never from anything she said.">
          REACTIONS
        </Tip>
      </span>
      <div className={styles.faces}>
        {shown.map((entry) => {
          const asset = assets.find((row) => row.symbol === entry.symbol);
          const first = (asset?.display_name ?? entry.symbol).split(" ").pop();
          return (
            <figure key={entry.symbol} className={styles.face} style={{ "--tal": talentAccent(asset?.color, theme) } as React.CSSProperties} data-mood={entry.mood}>
              <span className={styles.ring} style={{ width: size, height: size }}>
                <ReactionFace symbol={entry.symbol} pose={entry.mood} size={size} />
              </span>
              <figcaption>
                <b>{first}</b>
                <small>{MOOD_LABEL[entry.mood]}</small>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
