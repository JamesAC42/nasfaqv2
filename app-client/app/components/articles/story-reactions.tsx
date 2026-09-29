"use client";

import { ReactionFace } from "@/app/components/common/reaction-face";
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
 * The talents in a HoloNews headline reacting to it, each in the mood read from the headline for
 * her. `overlay` stacks small faces on a thumbnail's corner (feed cards); `strip` sets them quietly
 * under an article's headline, faded at the edges.
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

  // The article page: her face (or theirs) softly faded into the page under the headline. No
  // labels or frames: it's a bit of color, not a control. The mood is in the alt text for screen
  // readers.
  return (
    <div className={styles.faces} role="img" aria-label={shown.map((entry) => `${entry.symbol} ${MOOD_LABEL[entry.mood].toLowerCase()}`).join(", ")}>
      {shown.map((entry) => (
        <span key={entry.symbol} className={styles.face} style={{ width: size, height: size }} data-mood={entry.mood}>
          <ReactionFace symbol={entry.symbol} pose={entry.mood} size={size} />
        </span>
      ))}
    </div>
  );
}
