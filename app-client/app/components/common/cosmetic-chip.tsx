"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type CSSProperties } from "react";
import { FaGem, FaHatWizard, FaStar, FaVectorSquare } from "react-icons/fa6";
import { Medal } from "@/app/components/common/medal";
import type { EquippedCosmetic } from "@/app/lib/types";
import styles from "@/app/components/common/cosmetic-chip.module.scss";

/** Capsule rarity ladder (same as the locker): steel, blue, violet, gold. */
export const COSMETIC_TINT: Record<string, string> = {
  common: "#8d95a8",
  rare: "#3fb8f5",
  epic: "#b28cff",
  legendary: "#f5c542",
};

function Glyph({ cosmetic }: { cosmetic: EquippedCosmetic }) {
  if (cosmetic.type === "profile_badge") return <Medal color={COSMETIC_TINT[cosmetic.rarity]} size={16} />;
  if (cosmetic.type === "hat") return <FaHatWizard />;
  if (cosmetic.type === "profile_frame") return <FaVectorSquare />;
  if (cosmetic.type === "item") return <FaGem />;
  return <FaStar />;
}

/**
 * An equipped cosmetic next to a name: its image (or a glyph for its type) on a rarity-tinted
 * chip. `named` adds its name (profile header); without it the name is the tooltip (chat rows).
 */
export function CosmeticChip({ cosmetic, size = 18, named = false, className }: { cosmetic: EquippedCosmetic | null | undefined; size?: number; named?: boolean; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!cosmetic) return null;
  // A prize image that isn't on the CDN (yet) falls back to the drawn glyph.
  const image = cosmetic.image_url && broken !== cosmetic.image_url ? cosmetic.image_url : null;
  return (
    <span
      className={[styles.chip, named ? styles.named : null, className].filter(Boolean).join(" ")}
      style={{ "--tint": COSMETIC_TINT[cosmetic.rarity] ?? COSMETIC_TINT.common, "--sz": `${size}px` } as CSSProperties}
      data-rarity={cosmetic.rarity}
      title={cosmetic.display_name}
    >
      <span className={styles.icon}>{image ? <img src={image} alt="" loading="lazy" onError={() => setBroken(image)} /> : <Glyph cosmetic={cosmetic} />}</span>
      {named ? <span className={styles.name}>{cosmetic.display_name}</span> : <span className={styles.sr}>{cosmetic.display_name}</span>}
    </span>
  );
}
