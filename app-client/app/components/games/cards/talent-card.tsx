"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { MAX_STARS, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { isCalm } from "@/app/providers/motion-provider";
import styles from "@/app/components/games/cards/talent-card.module.scss";

export type CardFace = {
  symbol: string;
  name: string;
  rarity: Rarity;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  stars?: number;
  power?: number | null;
};

type TalentCardProps = {
  card: CardFace;
  /** Rendered width in px. Everything inside scales with it. */
  width?: number;
  /** False draws the card as a locked silhouette (collection binder). */
  owned?: boolean;
  isNew?: boolean;
  selected?: boolean;
  /** Dims the card (used, unavailable). */
  muted?: boolean;
  /** Corner ribbon text, e.g. "FEATURED". */
  ribbon?: string | null;
  /** Extra content over the art (a craft cost, a count). */
  overlay?: ReactNode;
  /** Hide the unit line and stars for very small cards. */
  compact?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Pointer-tracked tilt and glare. Defaults on for SR and up. */
  tilt?: boolean;
};

/**
 * A talent card. Rarity drives the frame: steel (C), blue (R), violet (SR), gold foil (SSR),
 * animated holo (UR). Art comes from the art pipeline; until it exists, ArtSlot draws the
 * talent's colour wash and oshimark, so the card still reads as that talent.
 */
export function TalentCard({
  card,
  width = 168,
  owned = true,
  isNew = false,
  selected = false,
  muted = false,
  ribbon = null,
  overlay = null,
  compact = false,
  onClick,
  disabled = false,
  title,
  className,
  tilt,
}: TalentCardProps) {
  const ref = useRef<HTMLElement | null>(null);
  const stars = Math.max(0, Math.min(MAX_STARS, card.stars ?? 0));
  const canTilt = (tilt ?? (card.rarity === "SR" || card.rarity === "SSR" || card.rarity === "UR")) && owned;

  const style = {
    "--w": `${width}px`,
    "--tal": talentAccent(card.color),
  } as CSSProperties;

  const classes = [styles.card, owned ? "" : styles.locked, selected ? styles.selected : "", muted ? styles.muted : "", onClick ? styles.clickable : "", className]
    .filter(Boolean)
    .join(" ");

  function onMove(event: React.PointerEvent<HTMLElement>) {
    if (!canTilt || event.pointerType !== "mouse" || isCalm()) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    el.style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`);
    el.dataset.tilting = "true";
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    delete el.dataset.tilting;
  }

  const body = (
    <span className={styles.frame}>
      <span className={styles.face}>
        <ArtSlot
          kind="keyart"
          symbol={card.symbol}
          icon={card.icon}
          accent={talentAccent(card.color)}
          width={width * 2}
          className={styles.art}
          fallback={
            <span className={styles.placeholder}>
              <span className={styles.rays} />
              <span className={styles.ghost}>{card.symbol}</span>
              <span className={styles.halftone} />
              <Oshimark icon={card.icon} symbol={card.symbol} size={Math.round(width * 0.56)} className={styles.bigMark} />
            </span>
          }
        />
        <span className={styles.grain} aria-hidden="true" />
        <span className={styles.sheen} aria-hidden="true" />
        <span className={styles.glare} aria-hidden="true" />

        <span className={styles.top}>
          <span className={styles.rarity} title={RARITY_NAME[card.rarity]}>
            {card.rarity}
          </span>
          {card.power !== undefined && card.power !== null ? (
            <span className={styles.power} title="Duel power">
              <small>PWR</small>
              {card.power}
            </span>
          ) : null}
        </span>

        <span className={styles.plate}>
          <span className={styles.nameRow}>
            <Oshimark icon={card.icon} symbol={card.symbol} size={Math.max(12, Math.round(width * 0.1))} className={styles.mark} />
            <span className={styles.name}>{card.name}</span>
          </span>
          {compact ? null : (
            <span className={styles.meta}>
              <span>{card.symbol}</span>
              {card.unit ? <span className={styles.unit}>{unitLabel(card.unit)}</span> : null}
            </span>
          )}
          {owned && stars > 0 && !compact ? (
            <span className={styles.stars} aria-label={`${stars} of ${MAX_STARS} stars`}>
              {Array.from({ length: MAX_STARS }, (_, index) => (
                <i key={index} data-on={index < stars} />
              ))}
            </span>
          ) : null}
        </span>

        {isNew || ribbon ? (
          <span className={styles.tags}>
            {isNew ? <span className={styles.newTag}>NEW</span> : null}
            {ribbon ? <span className={styles.ribbon}>{ribbon}</span> : null}
          </span>
        ) : null}
        {!owned ? <span className={styles.lock} aria-hidden="true" /> : null}
        {overlay ? <span className={styles.overlay}>{overlay}</span> : null}
      </span>
    </span>
  );

  const label = title ?? `${card.name} ${RARITY_NAME[card.rarity]} (${card.rarity})${owned ? "" : ", not owned"}`;

  if (onClick) {
    return (
      <button
        ref={(node) => {
          ref.current = node;
        }}
        type="button"
        className={classes}
        style={style}
        data-rarity={card.rarity}
        onClick={onClick}
        disabled={disabled}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        aria-label={label}
        aria-pressed={selected || undefined}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      ref={(node) => {
        ref.current = node;
      }}
      className={classes}
      style={style}
      data-rarity={card.rarity}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      role="img"
      aria-label={label}
    >
      {body}
    </div>
  );
}

/** The back of a card. `glow` hints the rarity before a reveal flips it. */
export function CardBack({ width = 168, glow = null, className }: { width?: number; glow?: Rarity | null; className?: string }) {
  return (
    <div className={[styles.back, className].filter(Boolean).join(" ")} style={{ "--w": `${width}px` } as CSSProperties} data-glow={glow ?? undefined} aria-hidden="true">
      <span className={styles.backInner}>
        <span className={styles.backMark}>
          <b>NASFAQ</b>
          <small>TALENT CARD</small>
        </span>
      </span>
    </div>
  );
}
