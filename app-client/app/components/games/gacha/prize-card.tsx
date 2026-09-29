"use client";

import { useId, useState, type CSSProperties } from "react";
import { FaCrown, FaHatCowboy, FaIdBadge, FaRegCircle, FaStar } from "react-icons/fa6";
import { Medal } from "@/app/components/common/medal";
import { CardOrnament } from "@/app/components/games/cards/card-drawn";
import type { Rarity } from "@/app/lib/games/types";
import { SceneArt } from "@/app/components/common/scene-art";
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
  if (prize.type === "profile_badge") return <Medal className={styles.medalGlyph} />;
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

const ORNAMENT: Record<CapsuleRarity, Rarity> = { common: "C", rare: "R", epic: "SR", legendary: "SSR" };

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
        {/* Same drawn frame ladder as talent cards: common steel → legendary gold. */}
        <span className={styles.ornament}>
          <CardOrnament rarity={ORNAMENT[prize.rarity]} />
        </span>
      </span>
    </div>
  );
}

/**
 * A capsule in SVG: a cream base, a tinted see-through lid with the folded prize slip inside, the
 * seam and latch, and a diamond sticker in the rarity colour. Colours come from --r-* on the parent.
 */
export function CapsuleShell({ detail = true }: { detail?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const base = `cap-base-${uid}`;
  const lid = `cap-lid-${uid}`;
  return (
    <svg className={styles.shell} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={base} cx="0.4" cy="0.78" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#dde2eb" />
          <stop offset="1" stopColor="#8f98ab" />
        </radialGradient>
        <radialGradient id={lid} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" style={{ stopColor: "var(--r-c)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--r-b)" }} />
          <stop offset="1" style={{ stopColor: "var(--r-a)" }} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${base})`} />
      {detail ? (
        <g transform="rotate(-14 50 30)" opacity="0.9">
          <rect x="34" y="18" width="32" height="22" rx="2" fill="#fbfcff" />
          <path d="M 34 29 H 66" stroke="rgba(0,0,0,0.18)" strokeWidth="1.2" />
        </g>
      ) : null}
      <path d="M 2 50 A 48 48 0 0 1 98 50 Z" fill={`url(#${lid})`} opacity={detail ? 0.66 : 1} />
      <rect x="1.5" y="46.5" width="97" height="7" fill="#20252f" />
      <rect x="1.5" y="46.5" width="97" height="2" fill="rgba(255,255,255,0.18)" />
      {detail ? <rect x="84" y="44" width="9" height="12" rx="2" fill="#3a4050" stroke="rgba(0,0,0,0.4)" strokeWidth="0.8" /> : null}
      {detail ? <path d="M 50 62 L 57 71 L 50 80 L 43 71 Z" style={{ fill: "var(--r-b)" }} stroke="rgba(0,0,0,0.3)" strokeWidth="1" /> : null}
      <ellipse cx="32" cy="22" rx="14" ry="7" transform="rotate(-32 32 22)" fill="rgba(255,255,255,0.62)" />
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth="1.5" />
    </svg>
  );
}

/** A sealed capsule. Its lid colour hints the rarity, like a real capsule machine. */
export function CapsuleBack({ rarity, width = 168 }: { rarity: CapsuleRarity; width?: number }) {
  return (
    <div className={styles.back} data-rarity={rarity} style={{ "--w": `${width}px` } as CSSProperties} aria-hidden="true">
      <span className={styles.ball}>
        <SceneArt slot={`games-capsule-${rarity}`} fill width={width} className={styles.shellArt} fallback={<CapsuleShell />} />
      </span>
      <span className={styles.shadow} />
    </div>
  );
}

/** A small capsule ball for the machine globe. */
export function CapsuleBall({ rarity, size, style }: { rarity: CapsuleRarity; size: number; style?: CSSProperties }) {
  return (
    <span className={styles.miniBall} data-rarity={rarity} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <CapsuleShell detail={false} />
    </span>
  );
}
