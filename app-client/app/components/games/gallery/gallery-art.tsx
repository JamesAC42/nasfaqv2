"use client";

import type { CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity, Talent } from "@/app/lib/games/types";
import { talentAccent } from "@/app/lib/talent-color";
import type { ReactionPose } from "@/app/components/games/gallery/gallery-model";
import styles from "@/app/components/games/gallery/gallery-art.module.scss";

// The gallery's art pieces. Each is an <ArtSlot> keyed by ID, so real art drops in by ID with no
// code change. Until then the placeholder escalates with rarity (plain C up to holo UR) so the
// five pieces of a set already read as a set.

type TalentLike = Pick<Talent, "symbol" | "name" | "icon" | "color">;

type PlaceholderProps = {
  talent: TalentLike;
  /** Rarity tint; null for key art tiles. */
  rarity?: Rarity | null;
  wide?: boolean;
  /** Oshimark size in px. */
  mark: number;
};

export function ArtPlaceholder({ talent, rarity = null, wide = false, mark }: PlaceholderProps) {
  return (
    <span className={styles.placeholder} data-rarity={rarity ?? undefined} data-wide={wide || undefined}>
      <span className={styles.rays} />
      <span className={styles.ghost}>{talent.symbol}</span>
      <span className={styles.halftone} />
      <Oshimark icon={talent.icon} symbol={talent.symbol} size={mark} className={styles.mark} />
    </span>
  );
}

const accentOf = (talent: TalentLike) => talentAccent(talent.color);

export function CardIllustration({ talent, rarity, width, className, priority }: { talent: TalentLike; rarity: Rarity; width: number; className?: string; priority?: boolean }) {
  return (
    <ArtSlot
      slot={`card-${rarity.toLowerCase()}`}
      symbol={talent.symbol}
      icon={talent.icon}
      accent={accentOf(talent)}
      width={width}
      fit="cover"
      priority={priority}
      alt={`${talent.name}, ${rarity} card illustration`}
      className={[styles.card, className].filter(Boolean).join(" ")}
      fallback={<ArtPlaceholder talent={talent} rarity={rarity} mark={Math.round(width * 0.42)} />}
    />
  );
}

export function BannerIllustration({ talent, width, className, priority }: { talent: TalentLike; width: number; className?: string; priority?: boolean }) {
  return (
    <ArtSlot
      slot="banner"
      symbol={talent.symbol}
      icon={talent.icon}
      accent={accentOf(talent)}
      width={width}
      fit="cover"
      priority={priority}
      alt={`${talent.name}, banner illustration`}
      className={[styles.banner, className].filter(Boolean).join(" ")}
      fallback={<ArtPlaceholder talent={talent} rarity="SSR" wide mark={Math.round(width * 0.16)} />}
    />
  );
}

export function KeyArt({ talent, width, className, priority, plain = false }: { talent: TalentLike; width: number; className?: string; priority?: boolean; plain?: boolean }) {
  return (
    <ArtSlot
      kind="keyart"
      symbol={talent.symbol}
      icon={talent.icon}
      accent={accentOf(talent)}
      width={width}
      priority={priority}
      alt={plain ? undefined : `${talent.name}, key art`}
      className={[styles.keyart, className].filter(Boolean).join(" ")}
      fallback={<ArtPlaceholder talent={talent} mark={Math.round(width * 0.46)} />}
    />
  );
}

export function Reaction({ talent, pose, width, className }: { talent: TalentLike; pose: ReactionPose; width: number; className?: string }) {
  return (
    <ArtSlot
      kind="reaction"
      pose={pose}
      symbol={talent.symbol}
      icon={talent.icon}
      accent={accentOf(talent)}
      width={width}
      className={[styles.reaction, className].filter(Boolean).join(" ")}
      fallback={
        <span className={styles.reactionPlaceholder} style={{ "--tal": accentOf(talent) } as CSSProperties}>
          <Oshimark icon={talent.icon} symbol={talent.symbol} size={Math.round(width * 0.5)} className={styles.mark} />
        </span>
      }
    />
  );
}

/** Five diamonds in rarity colours: which of a talent's illustrations are unlocked. */
export function RarityPips({ owned, size = "sm", className }: { owned: Partial<Record<Rarity, unknown>>; size?: "sm" | "md"; className?: string }) {
  const have = RARITIES.filter((rarity) => owned[rarity]);
  return (
    <span className={[styles.pips, className].filter(Boolean).join(" ")} data-size={size} role="img" aria-label={`${have.length} of 5 unlocked${have.length ? `: ${have.join(", ")}` : ""}`}>
      {RARITIES.map((rarity) => (
        <i key={rarity} data-rarity={rarity} data-on={Boolean(owned[rarity]) || undefined} style={{ "--rc": RARITY_COLOR[rarity] } as CSSProperties} title={`${rarity} ${RARITY_NAME[rarity]}`} />
      ))}
    </span>
  );
}
