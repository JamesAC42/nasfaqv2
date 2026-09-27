"use client";

import { useId, type CSSProperties } from "react";
import styles from "@/app/components/common/medal.module.scss";

export type MedalTier = "gold" | "silver" | "bronze";

const TIERS: Record<MedalTier, { hi: string; mid: string; lo: string; ribbon: [string, string] }> = {
  gold: { hi: "#fff4c2", mid: "#f5c542", lo: "#9a6f0c", ribbon: ["#3fb8f5", "#1d6fa5"] },
  silver: { hi: "#ffffff", mid: "#c7ccd8", lo: "#6c7486", ribbon: ["#ff7ad9", "#a8388f"] },
  bronze: { hi: "#ffd9b0", mid: "#d08a4a", lo: "#7a4418", ribbon: ["#7dd8a8", "#2f7d57"] },
};

/**
 * A medal on a ribbon, drawn in SVG. Tiers are gold/silver/bronze (leaderboard podium); pass
 * `color` instead for a custom enamel (achievements, badge prizes). `mark` is what's struck in
 * the middle: a rank number, an initial, or nothing for a star.
 */
export function Medal({ tier, color, mark, size = 48, className, title }: { tier?: MedalTier; color?: string; mark?: string | number | null; size?: number; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const metal = TIERS[tier ?? "gold"];
  const enamel = color ?? null;
  const face = `face-${uid}`;
  const rim = `rim-${uid}`;
  const text = mark === null || mark === undefined ? null : String(mark).slice(0, 2);
  return (
    <svg
      className={[styles.medal, className].filter(Boolean).join(" ")}
      viewBox="0 0 64 80"
      width={size}
      height={(size * 80) / 64}
      style={{ "--enamel": enamel ?? metal.mid } as CSSProperties}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal.hi} />
          <stop offset="0.45" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.lo} />
        </linearGradient>
        <radialGradient id={face} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor={enamel ? "#ffffff" : metal.hi} stopOpacity={enamel ? 0.55 : 1} />
          <stop offset="0.5" stopColor={enamel ?? metal.mid} />
          <stop offset="1" stopColor={enamel ?? metal.lo} />
        </radialGradient>
      </defs>
      {/* Ribbon: two tails in a V, notched ends. */}
      <path d="M 18 0 H 30 L 38 30 L 30 34 Z" fill={enamel ? "#1b2233" : metal.ribbon[1]} />
      <path d="M 46 0 H 34 L 26 30 L 34 34 Z" fill={enamel ?? metal.ribbon[0]} opacity={enamel ? 0.9 : 1} />
      <path d="M 18 0 H 30 L 31 4 H 19 Z M 34 0 H 46 L 45 4 H 33 Z" fill="rgba(0,0,0,0.25)" />
      {/* Disc: metal rim, stamped edge, enamel or metal face. */}
      <circle cx="32" cy="52" r="24" fill={`url(#${rim})`} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <circle cx="32" cy="52" r="20.5" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1.2" strokeDasharray="1.6 1.9" />
      <circle cx="32" cy="52" r="17" fill={`url(#${face})`} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      {text ? (
        <text className={styles.mark} x="32" y="52" textAnchor="middle" dominantBaseline="central" fontSize={text.length > 1 ? 14 : 17}>
          {text}
        </text>
      ) : (
        <path d="M 32 40 L 35.3 47.6 L 43.4 48.2 L 37.2 53.5 L 39.1 61.5 L 32 57.2 L 24.9 61.5 L 26.8 53.5 L 20.6 48.2 L 28.7 47.6 Z" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
      )}
      {/* Gloss. */}
      <path d="M 16 46 A 17 17 0 0 1 38 35.5 A 22 22 0 0 0 16 46 Z" fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}
