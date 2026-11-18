"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { getIconUrl } from "@/app/lib/normalizers";
import { CLOTH, EMBLEM, SHADE_WAVELENGTH, STILL_PHASE, VIEW, clothPath, flagColors, flagTier, flagWidth, lean, sway, tips, waveFrames } from "@/app/lib/oshiboard-flag.mjs";
import type { FlagTier } from "@/app/lib/oshiboard-flag.mjs";
import type { OshiboardMembership, OshiboardStanding } from "@/app/lib/types";
import { useMotion } from "@/app/providers/motion-provider";
import styles from "@/app/components/common/oshiboard-flag.module.scss";

// The podium's metals, the same ramps as the leaderboard's medals (common/medal.tsx).
const METALS: Partial<Record<FlagTier, { hi: string; mid: string; lo: string }>> = {
  crown: { hi: "#fff4c2", mid: "#f5c542", lo: "#9a6f0c" },
  silver: { hi: "#ffffff", mid: "#c7ccd8", lo: "#6c7486" },
  bronze: { hi: "#ffd9b0", mid: "#d08a4a", lo: "#7a4418" },
};
// Rod and fittings below the podium: dark iron.
const IRON = { hi: "#9aa3b6", mid: "#4b5368", lo: "#1a1f2b" };

const WAVE_SECONDS = 3.4;
const FRAMES = 12;

/** The profile's membership on their oshi's board (the only board a player can be on), as a standing. */
export function standingOf(membership: OshiboardMembership | undefined): OshiboardStanding | null {
  if (!membership || membership.rank < 1) return null;
  const { asset } = membership;
  return { symbol: asset.symbol, display_name: asset.display_name, icon: asset.icon, color: asset.color, rank: membership.rank, member_count: membership.member_count };
}

/** Spoken and hover text: the place, the board's size and whose board it is. */
export function standingLabel(standing: OshiboardStanding) {
  return `#${standing.rank.toLocaleString("en-US")} of ${standing.member_count.toLocaleString("en-US")} on ${standing.display_name}’s oshiboard`;
}

const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeReduce(onChange: () => void) {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Calm mode or the OS asking for less motion: either one holds the standard still. */
function useStill() {
  const { calm } = useMotion();
  const reduce = useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE).matches, () => false);
  return calm || reduce;
}

function useMarkFailed(url: string | null) {
  // Which URL failed, so a talent whose icon changes is tried again (as Oshimark does).
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const probe = new Image();
    probe.onerror = () => live && setFailed(url);
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return !url || failed === url;
}

/**
 * The standard itself, in SVG and flat color like the rest of the site: a swallowtail banner hanging
 * from a rod, the oshimark printed on a disc in the middle. `animate` gives it a wind ripple: the
 * outline moves, hard-edged bands of light and shade run down the cloth (over the print too), and the
 * print and tassels sway and lean with it. Otherwise it is drawn still at a gentle ripple.
 */
function Standard({ standing, playerColor, animate, mini, width }: { standing: OshiboardStanding; playerColor: string | null | undefined; animate: boolean; mini: boolean; width: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tier = flagTier(standing.rank);
  const metal = METALS[tier];
  const fitting = metal ?? IRON;
  const colors = useMemo(() => flagColors(playerColor, standing.color), [playerColor, standing.color]);
  const frames = useMemo(() => (animate ? waveFrames(FRAMES) : null), [animate]);
  const still = useMemo(() => ({ d: clothPath(STILL_PHASE), emblem: sway(EMBLEM.cy, STILL_PHASE), lean: lean(EMBLEM.cy, STILL_PHASE), ...tips(STILL_PHASE) }), []);
  const url = getIconUrl(standing.icon);
  const failed = useMarkFailed(url);

  const id = (name: string) => `osf-${name}-${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;
  const dur = `${WAVE_SECONDS}s`;
  const values = (pick: (frame: NonNullable<typeof frames>[number]) => string) => frames?.map(pick).join(";");

  const view = mini ? { ...VIEW, height: CLOTH.tail + 6 } : VIEW;
  const height = (width * view.height) / view.width;
  const markSize = (EMBLEM.r - (mini ? 4 : 5.5)) * 2;
  const tasselled = Boolean(metal) && !mini;
  const line = mini ? 2 : 0.8;
  // The folds: one shadow and one thin highlight per wave, with gently curved edges so they read as
  // creases in the cloth rather than stripes. They travel one wavelength down per cycle.
  const fold = (top: number, depth: number) => {
    const bottom = top + depth;
    return `M-20,${top} C25,${top - 5} 75,${top + 5} 120,${top} L120,${bottom} C75,${bottom + 4} 25,${bottom - 6} -20,${bottom} Z`;
  };
  const foldStart = CLOTH.top - SHADE_WAVELENGTH + 0.55 * SHADE_WAVELENGTH;
  const foldShift = frames ? 0 : (STILL_PHASE / (2 * Math.PI)) * SHADE_WAVELENGTH;

  const tassel = (side: "left" | "right") => {
    const at = still[side];
    return (
      <g transform={`translate(${at[0]} ${at[1]})`}>
        {frames ? <animateTransform attributeName="transform" type="translate" dur={dur} repeatCount="indefinite" values={values((frame) => `${frame[side][0].toFixed(1)} ${frame[side][1].toFixed(1)}`)} /> : null}
        <g className={styles.tassel} style={{ "--swing-delay": side === "left" ? "-0.6s" : "0s" } as CSSProperties}>
          <path d="M0,-1 V4.5" stroke={fitting.lo} strokeWidth="1.3" />
          <circle cx="0" cy="6.4" r="2.8" fill={fitting.mid} stroke={fitting.lo} strokeWidth="0.7" />
          <path d="M-2.4,8.6 L2.4,8.6 L4.4,20 Q0,21.8 -4.4,20 Z" fill={fitting.mid} stroke={fitting.lo} strokeWidth="0.7" />
          <path d="M-0.8,10 L-1.4,19.4" stroke={fitting.hi} strokeWidth="0.9" />
          <path d="M1.4,10.6 L2.3,19.4" stroke={fitting.lo} strokeWidth="0.6" />
        </g>
      </g>
    );
  };

  return (
    <svg className={styles.svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} width={width} height={height} aria-hidden="true" focusable="false">
      <defs>
        {/* The cloth's outline, drawn once and reused for the fill, the clip and the trim. */}
        <path id={id("cloth")} d={still.d}>
          {frames ? <animate attributeName="d" dur={dur} repeatCount="indefinite" values={values((frame) => frame.d)} /> : null}
        </path>
        <clipPath id={id("clip")}>
          <use href={`#${id("cloth")}`} />
        </clipPath>
        {/* The cloth is held still near the rod: no folds there. */}
        <mask id={id("held")} maskUnits="userSpaceOnUse" x={view.x} y={view.y} width={view.width} height={view.height}>
          <rect x={view.x} y={CLOTH.top + 30} width={view.width} height={view.height} fill="#fff" />
        </mask>
      </defs>

      {/* Fittings that hold the rod to the top edge of the header. */}
      {mini ? null : <path d="M6,0 V6 M94,0 V6" stroke={fitting.lo} strokeWidth="1.4" />}

      {/* The cloth, and what is printed and sewn on it. */}
      <use href={`#${id("cloth")}`} fill={colors.cloth} />
      <g clipPath={ref("clip")}>
        {/* The print sways and leans with the cloth around it. */}
        <g transform={`translate(${still.emblem.toFixed(1)} 0)`}>
          {frames ? <animateTransform attributeName="transform" type="translate" dur={dur} repeatCount="indefinite" values={values((frame) => `${frame.emblem.toFixed(1)} 0`)} /> : null}
          <g transform={`translate(${EMBLEM.cx} ${EMBLEM.cy})`}>
            <g transform={`skewX(${still.lean.toFixed(2)})`}>
              {frames ? <animateTransform attributeName="transform" type="skewX" dur={dur} repeatCount="indefinite" values={values((frame) => frame.lean.toFixed(2))} /> : null}
              <g transform={`translate(${-EMBLEM.cx} ${-EMBLEM.cy})`}>
                <circle cx={EMBLEM.cx} cy={EMBLEM.cy} r={EMBLEM.r} fill={colors.plate} stroke={metal ? fitting.mid : colors.stitch} strokeWidth={mini ? 3.6 : 2.2} />
                {failed ? (
                  <text className={styles.letter} x={EMBLEM.cx} y={EMBLEM.cy} textAnchor="middle" dominantBaseline="central" fontSize={EMBLEM.r * 1.1} fill={colors.mark}>
                    {standing.symbol.charAt(0)}
                  </text>
                ) : (
                  <image href={url ?? undefined} x={EMBLEM.cx - markSize / 2} y={EMBLEM.cy - markSize / 2} width={markSize} height={markSize} preserveAspectRatio="xMidYMid meet" className={styles.mark} />
                )}
              </g>
            </g>
          </g>
        </g>
        {/* Trim sewn along the edge: a dark seam inside, a band, and a bright edge (metal on the podium,
            the player's own color in the top ten). Solid lines, so nothing crawls as it waves. */}
        {metal ? (
          <>
            <use href={`#${id("cloth")}`} fill="none" stroke={fitting.lo} strokeWidth={mini ? 14 : 11} />
            <use href={`#${id("cloth")}`} fill="none" stroke={fitting.mid} strokeWidth={mini ? 12 : 9} />
            {mini ? null : <use href={`#${id("cloth")}`} fill="none" stroke={fitting.hi} strokeWidth="3.4" />}
          </>
        ) : tier === "top10" ? (
          <>
            <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth={mini ? 10 : 7.5} />
            <use href={`#${id("cloth")}`} fill="none" stroke={colors.stitch} strokeWidth={mini ? 8 : 5.5} />
          </>
        ) : null}
        {/* Folds over everything on the cloth, the print included. */}
        <g mask={ref("held")}>
          <g transform={`translate(0 ${foldShift.toFixed(1)})`}>
            {frames ? <animateTransform attributeName="transform" type="translate" from="0 0" to={`0 ${SHADE_WAVELENGTH}`} dur={dur} repeatCount="indefinite" /> : null}
            {[0, 1, 2].map((k) => {
              const top = foldStart + k * SHADE_WAVELENGTH;
              return (
                <g key={k}>
                  <path d={fold(top - 14, 7)} fill="#fff" opacity="0.13" />
                  <path d={fold(top, 26)} fill="#000" opacity="0.17" />
                </g>
              );
            })}
          </g>
        </g>
        {/* The shadow the sleeve casts. */}
        <rect x={view.x} y={CLOTH.top} width={view.width} height="5" fill="#000" opacity="0.22" />
      </g>
      <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth={mini ? 2.4 : 1.2} strokeLinejoin="round" />

      {/* The sleeve the rod runs through, and the rod. */}
      <rect x="-1" y="3.5" width="102" height="10" rx="2" fill={colors.lo} stroke={colors.edge} strokeWidth={line} />
      <rect x="-9" y="5.2" width="118" height="5.6" rx="2.8" fill={fitting.mid} stroke={fitting.lo} strokeWidth={line} />
      {mini ? null : <rect x="-7" y="6.2" width="114" height="1.3" rx="0.65" fill={fitting.hi} />}
      {[-11.5, 111.5].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="8" r="5" fill={fitting.mid} stroke={fitting.lo} strokeWidth={line} />
          {mini ? null : <circle cx={cx - 1.6} cy="6.4" r="1.5" fill={fitting.hi} />}
        </g>
      ))}

      {tasselled ? (
        <>
          {tassel("left")}
          {tassel("right")}
        </>
      ) : null}
    </svg>
  );
}

/**
 * The profile header's standard: hangs from the top edge of the header when the player is on their
 * oshi's oshiboard. Bigger the higher they place; the podium gets metal trim, tassels and an aura, and
 * first place glows. Links to the board. No printed rank: the size and trim say it, the label speaks it.
 */
export function OshiboardBanner({ standing, playerColor, className }: { standing: OshiboardStanding; playerColor: string | null | undefined; className?: string }) {
  const still = useStill();
  const tier = flagTier(standing.rank);
  const width = flagWidth(standing.rank, 44, 88);
  const colors = flagColors(playerColor, standing.color);
  const label = standingLabel(standing);
  return (
    <Link
      href={`/leaderboard?tab=talent&coin=${encodeURIComponent(standing.symbol)}`}
      className={[styles.banner, className].filter(Boolean).join(" ")}
      data-tier={tier}
      aria-label={label}
      title={label}
      style={{ "--cloth": colors.cloth, "--cloth-hi": colors.hi, "--fw": `${width}px` } as CSSProperties}
    >
      {tier === "crown" || tier === "silver" || tier === "bronze" || tier === "top10" ? (
        <span className={styles.aura} aria-hidden="true">
          {tier === "crown" ? <span className={styles.rays} /> : null}
        </span>
      ) : null}
      <span className={styles.sway}>
        <Standard standing={standing} playerColor={playerColor} animate={!still} mini={false} width={Math.round((width * VIEW.width) / CLOTH.width)} />
      </span>
    </Link>
  );
}

/** The leaderboard's quiet version: a small still standard beside the name, only for players on a board. */
export function OshiboardPennant({ standing, playerColor, className }: { standing: OshiboardStanding; playerColor: string | null | undefined; className?: string }) {
  const tier = flagTier(standing.rank);
  const width = flagWidth(standing.rank, 12, 17);
  const label = standingLabel(standing);
  return (
    <span className={[styles.pennant, className].filter(Boolean).join(" ")} data-tier={tier} role="img" aria-label={label} title={label}>
      <Standard standing={standing} playerColor={playerColor} animate={false} mini width={Math.round((width * VIEW.width) / CLOTH.width)} />
    </span>
  );
}
