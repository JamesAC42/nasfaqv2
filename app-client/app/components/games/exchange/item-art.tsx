"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type CSSProperties } from "react";
import { FaCommentDots, FaCrown, FaGem, FaHatWizard, FaPalette, FaVectorSquare } from "react-icons/fa6";
import { Medal } from "@/app/components/common/medal";
import { COSMETIC_COLOR, typeLabel } from "@/app/components/games/locker/cosmetics";
import type { ExchangeItem } from "@/app/lib/games/exchange";
import styles from "@/app/components/games/exchange/item-art.module.scss";

const TYPE_ICON: Record<string, React.ReactNode> = {
  hat: <FaHatWizard />,
  profile_frame: <FaVectorSquare />,
  profile_badge: <Medal />,
  chat_flair: <FaCommentDots />,
  portfolio_theme: <FaPalette />,
  item: <FaGem />,
};

/**
 * A capsule item on the exchange, in a card-shaped frame so it sits in the same grids as talent
 * cards: its picture on the rarity's colour, the rarity and type, and its name. `width` in px, like
 * TalentCard (it shrinks to fit a narrower column).
 */
export function ItemArt({ item, width = 150, compact = false }: { item: ExchangeItem; width?: number; compact?: boolean }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(item.image_url) && !broken;
  return (
    <span
      className={styles.art}
      data-rarity={item.rarity}
      data-compact={compact || undefined}
      style={{ "--w": `${width}px`, "--cc": COSMETIC_COLOR[item.rarity] ?? COSMETIC_COLOR.common } as CSSProperties}
    >
      <span className={styles.stage} aria-hidden="true">
        {showImage ? <img src={item.image_url ?? ""} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className={styles.glyph}>{TYPE_ICON[item.type ?? ""] ?? <FaCrown />}</span>}
        <span className={styles.rarity}>{item.rarity}</span>
      </span>
      <span className={styles.caption}>
        <b title={item.name}>{item.name}</b>
        {item.type ? <small>{typeLabel(item.type)}</small> : null}
      </span>
    </span>
  );
}
