"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { COSMETIC_COLOR } from "@/app/components/games/locker/cosmetics";
import type { ExchangeItem } from "@/app/lib/games/exchange";
import { RARITY_COLOR } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { money } from "@/app/lib/time";
import styles from "@/app/components/games/exchange/exchange.module.scss";

/** "2d 4h", "3h 12m", "12:04", or "0:07" in the last minute. */
export function formatLeft(ms: number) {
  const s = Math.ceil(ms / 1000);
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A live auction clock. Under five minutes it warms up; in the last minute it pulses. */
export function Countdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const left = useRemaining(Date.parse(endsAt), 250);
  if (left === null) return null;
  const phase = left <= 0 ? "done" : left < 60_000 ? "final" : left < 5 * 60_000 ? "close" : "open";
  return (
    <span className={[styles.clock, className].filter(Boolean).join(" ")} data-phase={phase} suppressHydrationWarning>
      {left <= 0 ? "closing…" : formatLeft(left)}
    </span>
  );
}

export function RarityTag({ rarity }: { rarity: Rarity }) {
  return (
    <span className={styles.rarityTag} style={{ "--r": RARITY_COLOR[rarity] } as CSSProperties}>
      {rarity}
    </span>
  );
}

/** A capsule item's rarity, in the locker's colours. */
export function ItemRarityTag({ rarity }: { rarity: string }) {
  return (
    <span className={styles.rarityTag} style={{ "--r": COSMETIC_COLOR[rarity] ?? COSMETIC_COLOR.common } as CSSProperties}>
      {rarity}
    </span>
  );
}

/** A capsule item's name line (the item counterpart of CardName). */
export function ItemName({ item, href }: { item: ExchangeItem; href?: string }) {
  const inner = (
    <>
      <span className={styles.itemDot} style={{ "--r": COSMETIC_COLOR[item.rarity] ?? COSMETIC_COLOR.common } as CSSProperties} aria-hidden="true" />
      <span>{item.name}</span>
      <ItemRarityTag rarity={item.rarity} />
    </>
  );
  return href ? (
    <Link href={href} className={styles.cardName}>
      {inner}
    </Link>
  ) : (
    <span className={styles.cardName}>{inner}</span>
  );
}

/** A listing's or sale's name line: the card's, or the capsule item's, linking to its market page. */
export function ThingName({ card, item, cardKey, cosmeticKey }: { card?: { symbol: string; name: string; icon: string | null; rarity: Rarity } | null; item?: ExchangeItem | null; cardKey?: string | null; cosmeticKey?: string | null }) {
  if (item) return <ItemName item={item} href={`/games/exchange/items/${encodeURIComponent(cosmeticKey ?? item.key)}`} />;
  if (!card) return null;
  const [, symbol, rarity] = String(cardKey ?? "").split(":");
  return <CardName card={card} href={symbol && rarity ? `/games/exchange/card/${symbol}/${rarity}` : undefined} />;
}

export function Cash({ value, className }: { value: number | null | undefined; className?: string }) {
  return <b className={[styles.cash, className].filter(Boolean).join(" ")}>{money(value ?? null)}</b>;
}

export function CardName({ card, href }: { card: { symbol: string; name: string; icon: string | null; rarity: Rarity }; href?: string }) {
  const inner = (
    <>
      <Oshimark icon={card.icon} symbol={card.symbol} size={16} />
      <span>{card.name}</span>
      <RarityTag rarity={card.rarity} />
    </>
  );
  return href ? (
    <Link href={href} className={styles.cardName}>
      {inner}
    </Link>
  ) : (
    <span className={styles.cardName}>{inner}</span>
  );
}

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

/** A centred dialog (bottom sheet on phones). Escape and the scrim close it. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <DialogInner title={title} onClose={onClose} wide={wide}>{children}</DialogInner>;
}

function DialogInner({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide: boolean }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div ref={panel} tabIndex={-1} className={styles.dialog} data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className={styles.dialogHead}>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
