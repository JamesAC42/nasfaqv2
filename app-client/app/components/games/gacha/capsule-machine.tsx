"use client";

import type { CSSProperties } from "react";
import { CAPSULE_COLOR, type CapsuleRarity } from "@/app/components/games/gacha/capsule-types";
import styles from "@/app/components/games/gacha/capsule-machine.module.scss";

// A Japanese gashapon cabinet drawn in SVG: marquee sign with chasing bulbs, a glass window over a
// pile of capsules, price plate, chrome crank, coin slot and the exit door. Pulling turns the
// crank (twice for ten), shakes the pile, and drops a capsule the colour of the best prize.

const W = 320;
const H = 460;
const WIN = { x: 44, y: 92, w: 232, h: 150 };
const CAP_R = 17;

// The pile is decoration: toy-shop colours, with a few rarity colours mixed in. The capsule that
// drops out of the door is the one that means something (the best prize's rarity colour).
const PILE_COLORS = ["#ff9ec7", "#3fb8f5", "#ffc58a", "#b28cff", "#9ad8ff", "#ff9ec7", "#f5c542", "#c9b6ff", "#3fb8f5", "#ffb3a7", "#8d95a8", "#9ad8ff"];

type Capsule = { x: number; y: number; rot: number; color: string; delay: number };

/** A heap: full rows at the bottom, fewer toward the top, jittered and rotated. Deterministic. */
function buildPile(): Capsule[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const rows = [7, 6, 6, 4, 2];
  const pitch = CAP_R * 2 - 1;
  const out: Capsule[] = [];
  let mix = 0;
  rows.forEach((count, row) => {
    const y = WIN.y + WIN.h - CAP_R - 3 - row * (pitch * 0.86);
    const width = count * pitch;
    const start = WIN.x + (WIN.w - width) / 2 + CAP_R + (row % 2 ? pitch / 4 : 0);
    for (let i = 0; i < count; i += 1) {
      out.push({
        x: start + i * pitch + (rand() - 0.5) * 5,
        y: y + (rand() - 0.5) * 4,
        rot: Math.round((rand() - 0.5) * 140),
        color: PILE_COLORS[mix % PILE_COLORS.length],
        delay: Math.round(rand() * 240),
      });
      mix += 1;
    }
  });
  return out;
}

const PILE = buildPile();

// Marquee bulbs around the sign: across the top, down both ends.
const BULBS: { x: number; y: number }[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ x: 56 + index * (208 / 11), y: 10 })),
  { x: 36, y: 26 },
  { x: 36, y: 46 },
  { x: 284, y: 26 },
  { x: 284, y: 46 },
];

function CapsuleShape({ x, y, rot, color, r = CAP_R, className, style }: { x: number; y: number; rot: number; color: string; r?: number; className?: string; style?: CSSProperties }) {
  return (
    <g className={className} style={style}>
      <g transform={`translate(${x} ${y}) rotate(${rot})`}>
        <circle r={r} fill="#f4f6fa" />
        <path d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`} fill={color} />
        <path d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`} fill="url(#cm-capShade)" />
        <rect x={-r} y={-1.2} width={r * 2} height={2.4} fill="rgba(0,0,0,0.22)" />
        <circle r={r} fill="url(#cm-capGloss)" />
        <circle r={r - 0.5} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
      </g>
    </g>
  );
}

export function CapsuleMachine({
  price,
  state,
  drop,
  turns = 1,
  season = "Season 1",
}: {
  price: number | null;
  /** idle, or cranking while a pull is in flight and the capsule drops. */
  state: "idle" | "cranking";
  /** Rarity of the capsule dropping out of the door (the best prize in the batch). */
  drop: CapsuleRarity | null;
  /** Crank turns for this pull (2 for a ten-pull). */
  turns?: 1 | 2;
  season?: string;
}) {
  const dropColor = drop ? CAPSULE_COLOR[drop] : null;

  return (
    <div
      className={styles.machine}
      data-state={state}
      data-drop={drop ?? undefined}
      style={{ "--turns": turns, "--drop": dropColor ?? "transparent" } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
        <defs>
          <linearGradient id="cm-body" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1273ad" />
            <stop offset="0.12" stopColor="#2aa3e6" />
            <stop offset="0.5" stopColor="#45bdf7" />
            <stop offset="0.88" stopColor="#2aa3e6" />
            <stop offset="1" stopColor="#0f5f90" />
          </linearGradient>
          <linearGradient id="cm-sign" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#dfe8f2" />
          </linearGradient>
          <radialGradient id="cm-window" cx="0.5" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#1a2a44" />
            <stop offset="1" stopColor="#060a13" />
          </radialGradient>
          <linearGradient id="cm-capShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,0.25)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.18)" />
          </linearGradient>
          <radialGradient id="cm-capGloss" cx="0.35" cy="0.28" r="0.6">
            <stop offset="0" stopColor="rgba(255,255,255,0.85)" />
            <stop offset="0.25" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id="cm-chrome" cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#cfd6e2" />
            <stop offset="1" stopColor="#6e7890" />
          </radialGradient>
          <linearGradient id="cm-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="0.35" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id="cm-winClip">
            <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx="14" />
          </clipPath>
          <clipPath id="cm-doorClip">
            <rect x="118" y="370" width="84" height="54" rx="10" />
          </clipPath>
        </defs>

        {/* Floor shadow and feet */}
        <ellipse cx={W / 2} cy={H - 10} rx="130" ry="9" fill="rgba(0,0,0,0.45)" />
        <rect x="48" y={H - 30} width="30" height="18" rx="3" fill="#1b2030" />
        <rect x={W - 78} y={H - 30} width="30" height="18" rx="3" fill="#1b2030" />

        {/* Cabinet */}
        <rect x="24" y="58" width={W - 48} height="386" rx="20" fill="#0c4e77" />
        <rect x="24" y="54" width={W - 48} height="384" rx="20" fill="url(#cm-body)" />
        <rect x="34" y="82" width={W - 68} height="170" rx="18" fill="#0f6aa3" opacity="0.55" />

        {/* Marquee sign */}
        <g className={styles.sign}>
          <rect x="40" y="10" width={W - 80} height="58" rx="14" fill="#0a0c11" />
          <rect x="46" y="16" width={W - 92} height="46" rx="10" fill="url(#cm-sign)" />
          <text x={W / 2} y="48" textAnchor="middle" className={styles.signText}>
            CAPSULE
          </text>
          {BULBS.map((bulb, index) => (
            <circle key={index} cx={bulb.x} cy={bulb.y} r="4.2" className={styles.bulb} style={{ "--i": index } as CSSProperties} />
          ))}
        </g>

        {/* Window + pile */}
        <rect x={WIN.x - 6} y={WIN.y - 6} width={WIN.w + 12} height={WIN.h + 12} rx="18" fill="#0a0c11" />
        <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx="14" fill="url(#cm-window)" />
        <g clipPath="url(#cm-winClip)">
          <ellipse cx={W / 2} cy={WIN.y + WIN.h} rx={WIN.w / 1.6} ry="40" fill="rgba(63,184,245,0.14)" />
          <g className={styles.pile}>
            {PILE.map((capsule, index) => (
              <CapsuleShape key={index} {...capsule} className={styles.pileCap} style={{ "--d": `${capsule.delay}ms` } as CSSProperties} />
            ))}
          </g>
          <path d={`M ${WIN.x - 10} ${WIN.y + 60} L ${WIN.x + 70} ${WIN.y - 10} L ${WIN.x + 96} ${WIN.y - 10} L ${WIN.x + 6} ${WIN.y + 86} Z`} fill="rgba(255,255,255,0.1)" />
          <path d={`M ${WIN.x + 110} ${WIN.y + WIN.h + 10} L ${WIN.x + 210} ${WIN.y - 10} L ${WIN.x + 222} ${WIN.y - 10} L ${WIN.x + 122} ${WIN.y + WIN.h + 10} Z`} fill="rgba(255,255,255,0.05)" />
          <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx="14" fill="url(#cm-glass)" />
        </g>
        <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx="14" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />

        {/* Season sticker */}
        <g transform="translate(236 234) rotate(8)">
          <rect x="-40" y="-11" width="80" height="22" rx="4" fill="#f5c542" />
          <text x="0" y="5" textAnchor="middle" className={styles.sticker}>
            {season.toUpperCase()}
          </text>
        </g>

        {/* Control panel */}
        <rect x="40" y="268" width={W - 80} height="88" rx="14" fill="#0a0c11" opacity="0.9" />
        <g>
          <rect x="54" y="282" width="92" height="60" rx="8" fill="#141a26" stroke="rgba(255,255,255,0.08)" />
          <text x="66" y="302" className={styles.plateLabel}>
            1 CAPSULE
          </text>
          <text x="66" y="332" className={styles.platePrice}>
            ${price ?? 50}
          </text>
        </g>
        {/* Coin slot */}
        <rect x="160" y="290" width="10" height="44" rx="3" fill="#05070b" stroke="rgba(255,255,255,0.18)" />
        {/* Crank */}
        <g transform="translate(228 312)">
          <circle r="36" fill="#05070b" opacity="0.55" />
          <circle r="32" fill="url(#cm-chrome)" stroke="rgba(0,0,0,0.45)" />
          <g className={styles.crank}>
            <rect x="-26" y="-8" width="52" height="16" rx="8" fill="#1b2030" />
            <rect x="-24" y="-6" width="48" height="5" rx="2.5" fill="rgba(255,255,255,0.18)" />
            <circle cx="21" cy="0" r="5" fill="#f5c542" />
          </g>
          <circle r="5" fill="#8d95a8" />
        </g>

        {/* Exit door */}
        <rect x="112" y="364" width="96" height="66" rx="14" fill="#0a0c11" />
        <rect x="118" y="370" width="84" height="54" rx="10" fill="#020306" />
        <g clipPath="url(#cm-doorClip)">
          <ellipse cx={W / 2} cy="424" rx="36" ry="10" className={styles.doorGlow} />
          {drop ? <CapsuleShape x={W / 2} y={404} rot={-18} color={CAPSULE_COLOR[drop]} r={16} className={styles.dropCap} /> : null}
          <rect x="118" y="370" width="84" height="18" className={styles.flap} />
        </g>
      </svg>
    </div>
  );
}
