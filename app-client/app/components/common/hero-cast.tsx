"use client";

import type { CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { talentAccent } from "@/app/lib/talent-color";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/common/hero-cast.module.scss";

export type HeroTalent = { symbol: string; icon?: string | null; color?: string | null };

/**
 * A page header's cast: a few talents' key art standing at the right edge, behind the title row
 * and tinted by the first one's colour. Pages pass whoever the page is about right now (who's live,
 * who's in the news). Renders nothing without talents.
 */
export function HeroCast({ talents, max = 3, className }: { talents: HeroTalent[]; max?: number; className?: string }) {
  const { theme } = useTheme();
  const cast = talents.slice(0, max);
  if (!cast.length) return null;
  return (
    <div className={[styles.cast, className].filter(Boolean).join(" ")} style={{ "--tal": talentAccent(cast[0].color, theme) } as CSSProperties} aria-hidden="true">
      <div className={styles.row} data-count={cast.length}>
        {cast.map((talent, index) => (
          <ArtSlot
            key={talent.symbol}
            kind="keyart"
            symbol={talent.symbol}
            icon={talent.icon}
            accent={talentAccent(talent.color, theme)}
            width={360}
            priority={index === 0}
            className={styles.figure}
            fallback={<span />}
          />
        ))}
      </div>
    </div>
  );
}
