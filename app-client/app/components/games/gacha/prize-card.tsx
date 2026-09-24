"use client";

import { useState, type CSSProperties } from "react";
import { FaCrown, FaHatCowboy, FaIdBadge, FaMedal, FaRegCircle, FaStar } from "react-icons/fa6";
import { TYPE_LABEL, type CapsuleRarity } from "@/app/components/games/gacha/capsule-types";
import styles from "@/app/components/games/gacha/prize-card.module.scss";

export type PrizeFace = {
  key: string;
  type: string;
  rarity: CapsuleRarity;
  display_name: string;
  image_url: string | null;
};

function fallbackGlyph(prize: Pick<PrizeFace, "key" | "type">) {
  const key = prize.key.toLowerCase();
  if (key.includes("crown")) return <FaCrown />;
  if (key.includes("halo")) return <FaRegCircle />;
  if (key.includes("star")) return <FaStar />;
  if (prize.type === "profile_frame") return <FaIdBadge />;
  if (prize.type === "profile_badge") return <FaMedal />;
  if (prize.type === "chat_flair") return <FaStar />;
  return <FaHatCowboy />;
}

/** The prize image, or a drawn glyph for its type while the CDN image is missing. */
export function PrizeArt({ prize, className }: { prize: Pick<PrizeFace, "key" | "type" | "image_url">; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (prize.image_url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={className} src={prize.image_url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    );
  }
  return (
    <span className={[className, styles.glyph].filter(Boolean).join(" ")} aria-hidden="true">
      {fallbackGlyph(prize)}
    </span>
  );
}

/** A capsule prize as a card: same 5:7 shape as talent cards so the reveal grid is shared. */
export function PrizeCard({ prize, width = 168, isNew = false }: { prize: PrizeFace; width?: number; isNew?: boolean }) {
  return (
    <div
      className={styles.card}
      data-rarity={prize.rarity}
      style={{ "--w": `${width}px` } as CSSProperties}
      role="img"
      aria-label={`${prize.display_name}, ${prize.rarity} ${TYPE_LABEL[prize.type] ?? prize.type}`}
    >
      <span className={styles.frame}>
        <span className={styles.face}>
          <span className={styles.rays} aria-hidden="true" />
          <span className={styles.sheen} aria-hidden="true" />
          <PrizeArt prize={prize} className={styles.art} />
          <span className={styles.rarity}>{prize.rarity}</span>
          {isNew ? <span className={styles.newTag}>NEW</span> : null}
          <span className={styles.plate}>
            <span className={styles.name}>{prize.display_name}</span>
            <span className={styles.type}>{TYPE_LABEL[prize.type] ?? prize.type.replace(/_/g, " ")}</span>
          </span>
        </span>
      </span>
    </div>
  );
}

/** A sealed capsule. Its shell colour hints the rarity, like a real capsule machine. */
export function CapsuleBack({ rarity, width = 168 }: { rarity: CapsuleRarity; width?: number }) {
  return (
    <div className={styles.back} data-rarity={rarity} style={{ "--w": `${width}px` } as CSSProperties} aria-hidden="true">
      <span className={styles.ball}>
        <span className={styles.top} />
        <span className={styles.seam} />
        <span className={styles.shine} />
      </span>
      <span className={styles.shadow} />
    </div>
  );
}

/** A small capsule ball for the machine globe. */
export function CapsuleBall({ rarity, size, style }: { rarity: CapsuleRarity; size: number; style?: CSSProperties }) {
  return (
    <span className={styles.miniBall} data-rarity={rarity} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <span className={styles.top} />
      <span className={styles.shine} />
    </span>
  );
}
