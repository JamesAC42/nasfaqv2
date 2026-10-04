"use client";

import { useId } from "react";
import type { Rarity } from "@/app/lib/games/types";
import styles from "@/app/components/games/cards/card-drawn.module.scss";

// Drawn card furniture: the per-rarity frame ornaments and the card back. Both are SVG on the
// card's own 500×700 grid (5:7), so they scale with the card. A `_shared/games-frame-*` or
// `_shared/games-card-back` image in the manifest still replaces them (see SceneArt `fallback`).

const W = 500;
const H = 700;

/** Mirror a corner piece drawn for the top-left into all four corners. */
function Corners({ children }: { children: React.ReactNode }) {
  return (
    <>
      <g>{children}</g>
      <g transform={`translate(${W} 0) scale(-1 1)`}>{children}</g>
      <g transform={`translate(0 ${H}) scale(1 -1)`}>{children}</g>
      <g transform={`translate(${W} ${H}) scale(-1 -1)`}>{children}</g>
    </>
  );
}

/** A 4-point sparkle centred on (x, y). */
function Sparkle({ x, y, r, delay = 0 }: { x: number; y: number; r: number; delay?: number }) {
  const k = r * 0.22;
  return (
    <path
      className={styles.sparkle}
      style={{ animationDelay: `${delay}ms` }}
      d={`M ${x} ${y - r} L ${x + k} ${y - k} L ${x + r} ${y} L ${x + k} ${y + k} L ${x} ${y + r} L ${x - k} ${y + k} L ${x - r} ${y} L ${x - k} ${y - k} Z`}
    />
  );
}

function Diamond({ x, y, r, className }: { x: number; y: number; r: number; className?: string }) {
  return <path className={className} d={`M ${x} ${y - r} L ${x + r * 0.8} ${y} L ${x} ${y + r} L ${x - r * 0.8} ${y} Z`} />;
}

/** The inner edge where the frame meets the art. */
const inner = { x: 12, y: 12, w: W - 24, h: H - 24, r: 14 };

/**
 * Frame ornaments by rarity: C is a plain steel bezel, R adds corner brackets, SR chamfered
 * brackets and gems, SSR an art-deco gold frame with a crest, UR the same in holo foil with
 * sparkles. Drawn over the CSS frame gradient (which the card still owns).
 */
export function CardOrnament({ rarity }: { rarity: Rarity }) {
  const uid = useId().replace(/:/g, "");
  const gold = `gold-${uid}`;
  const holo = `holo-${uid}`;
  const foil = rarity === "UR" ? `url(#${holo})` : `url(#${gold})`;

  return (
    <svg className={styles.ornament} data-rarity={rarity} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.3" stopColor="#f5c542" />
          <stop offset="0.55" stopColor="#a8790f" />
          <stop offset="0.75" stopColor="#ffe68a" />
          <stop offset="1" stopColor="#c99416" />
        </linearGradient>
        <linearGradient id={holo} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7ad9" />
          <stop offset="0.25" stopColor="#ffd36e" />
          <stop offset="0.5" stopColor="#7dffcf" />
          <stop offset="0.75" stopColor="#6ecbff" />
          <stop offset="1" stopColor="#b28cff" />
        </linearGradient>
      </defs>

      {/* Every rarity: the bezel line where frame meets art. */}
      <rect className={styles.bezel} x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={inner.r} />

      {rarity === "C" ? (
        <>
          <circle className={styles.rivet} cx={W / 2} cy={6} r={3} />
          <circle className={styles.rivet} cx={W / 2} cy={H - 6} r={3} />
        </>
      ) : null}

      {rarity === "R" ? (
        <>
          <Corners>
            <path className={styles.bracket} d="M 26 78 V 26 H 78" />
          </Corners>
          <Diamond className={styles.gem} x={W / 2} y={6} r={6} />
          <Diamond className={styles.gem} x={W / 2} y={H - 6} r={6} />
        </>
      ) : null}

      {rarity === "SR" ? (
        <>
          <rect className={`${styles.bezel} ${styles.fine}`} x={20} y={20} width={W - 40} height={H - 40} rx={10} />
          <Corners>
            <path className={styles.bracket} d="M 28 104 V 46 L 46 28 H 104" />
            <Diamond className={styles.gem} x={36} y={36} r={7} />
          </Corners>
          <path className={styles.rule} d={`M ${W / 2 - 70} 6 H ${W / 2 - 16} M ${W / 2 + 16} 6 H ${W / 2 + 70}`} />
          <Diamond className={styles.gem} x={W / 2} y={6} r={9} />
          <Diamond className={styles.gem} x={W / 2} y={H - 6} r={7} />
        </>
      ) : null}

      {rarity === "SSR" || rarity === "UR" ? (
        <g className={rarity === "UR" ? styles.holo : undefined}>
          <rect className={styles.foilLine} stroke={foil} x={21} y={21} width={W - 42} height={H - 42} rx={9} />
          <Corners>
            {/* Art-deco corner: nested chamfered brackets and a fan of rays. */}
            <path className={styles.foilBracket} stroke={foil} d="M 26 124 V 48 L 48 26 H 124" />
            <path className={`${styles.foilBracket} ${styles.fine}`} stroke={foil} d="M 38 88 V 56 L 56 38 H 88" />
            <path className={`${styles.foilRay} ${styles.fine}`} stroke={foil} d="M 48 48 L 70 70 M 52 46 L 84 60 M 46 52 L 60 84" />
            <Diamond className={styles.foilGem} x={48} y={48} r={8} />
          </Corners>
          {/* Crest on the top edge, a smaller one at the bottom, studs mid-sides. */}
          <path className={styles.foilBracket} stroke={foil} d={`M ${W / 2 - 110} 11 H ${W / 2 - 26} M ${W / 2 + 26} 11 H ${W / 2 + 110}`} />
          <path className={styles.crest} fill={foil} d={`M ${W / 2} -4 L ${W / 2 + 22} 14 L ${W / 2} 36 L ${W / 2 - 22} 14 Z`} />
          {rarity === "UR" ? (
            <path className={styles.crestMark} d={`M ${W / 2} 2 L ${W / 2 + 4} 10 L ${W / 2 + 12} 14 L ${W / 2 + 4} 18 L ${W / 2} 28 L ${W / 2 - 4} 18 L ${W / 2 - 12} 14 L ${W / 2 - 4} 10 Z`} />
          ) : (
            <Diamond className={styles.crestMark} x={W / 2} y={15} r={8} />
          )}
          <path className={styles.foilBracket} stroke={foil} d={`M ${W / 2 - 60} ${H - 11} H ${W / 2 - 16} M ${W / 2 + 16} ${H - 11} H ${W / 2 + 60}`} />
          <path className={styles.crest} fill={foil} d={`M ${W / 2} ${H - 24} L ${W / 2 + 13} ${H - 11} L ${W / 2} ${H + 2} L ${W / 2 - 13} ${H - 11} Z`} />
          <Diamond className={styles.foilGem} x={6} y={H / 2} r={10} />
          <Diamond className={styles.foilGem} x={W - 6} y={H / 2} r={10} />
          {rarity === "UR" ? (
            <g className={styles.fine}>
              <Sparkle x={92} y={70} r={14} />
              <Sparkle x={W - 70} y={120} r={10} delay={700} />
              <Sparkle x={70} y={H - 150} r={9} delay={1300} />
              <Sparkle x={W - 96} y={H - 80} r={13} delay={400} />
            </g>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

/**
 * The card back: a guilloche rosette like a banknote, a double border with corner diamonds, and
 * the NASFAQ diamond. The wordmark sits on top in HTML (the display font).
 */
export function CardBackArt() {
  const uid = useId().replace(/:/g, "");
  const bg = `bg-${uid}`;
  const cx = W / 2;
  const cy = H / 2;
  return (
    <svg className={styles.back} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={bg} cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#14305c" />
          <stop offset="1" stopColor="#060a14" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${bg})`} />
      {/* Fine diagonal lattice across the whole back. */}
      <g className={styles.lattice}>
        {Array.from({ length: 40 }, (_, i) => {
          const x = (i - 14) * 50;
          return <path key={i} d={`M ${x} 0 L ${x + H} ${H} M ${x + H} 0 L ${x} ${H}`} />;
        })}
      </g>
      {/* Rosette: rotated ellipses, then two rings. */}
      <g className={styles.rosette}>
        {Array.from({ length: 24 }, (_, i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={170} ry={62} transform={`rotate(${i * 7.5} ${cx} ${cy})`} />
        ))}
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return <circle key={`c${i}`} cx={cx + Math.cos(a) * 64} cy={cy + Math.sin(a) * 64} r={52} />;
        })}
      </g>
      <circle className={styles.ring} cx={cx} cy={cy} r={124} />
      <circle className={`${styles.ring} ${styles.dashed}`} cx={cx} cy={cy} r={132} />
      <circle className={styles.hub} cx={cx} cy={cy} r={96} />
      {/* Borders and corners. */}
      <rect className={styles.border} x={22} y={22} width={W - 44} height={H - 44} rx={16} />
      <rect className={`${styles.border} ${styles.dashed}`} x={34} y={34} width={W - 68} height={H - 68} rx={10} />
      <Corners>
        <Diamond className={styles.backGem} x={34} y={34} r={10} />
        <path className={styles.border} d="M 52 34 H 96 M 34 52 V 96" />
      </Corners>
      {/* The NASFAQ diamond, above the wordmark. */}
      <Diamond className={styles.logo} x={cx} y={cy - 46} r={20} />
    </svg>
  );
}
