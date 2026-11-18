"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { getIconUrl } from "@/app/lib/normalizers";
import { CLOTH, EMBLEM, SHADE_WAVELENGTH, STILL_PHASE, VIEW, clothPath, flagColors, flagTier, flagWidth, sway, tips, waveFrames } from "@/app/lib/oshiboard-flag.mjs";
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
 * The standard itself, in SVG: a swallowtail banner hanging from a rod, the oshimark on a patch in the
 * middle. `animate` gives it a wind ripple (the outline, the light and shade on the cloth, the mark and
 * the tassels all move on the same wave); otherwise it is drawn still at a gentle ripple.
 */
function Standard({ standing, playerColor, animate, mini, width }: { standing: OshiboardStanding; playerColor: string | null | undefined; animate: boolean; mini: boolean; width: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tier = flagTier(standing.rank);
  const metal = METALS[tier];
  const fitting = metal ?? IRON;
  const colors = useMemo(() => flagColors(playerColor, standing.color), [playerColor, standing.color]);
  const frames = useMemo(() => (animate ? waveFrames(FRAMES) : null), [animate]);
  const still = useMemo(() => ({ d: clothPath(STILL_PHASE), emblem: sway(EMBLEM.cy, STILL_PHASE), ...tips(STILL_PHASE) }), []);
  const url = getIconUrl(standing.icon);
  const failed = useMarkFailed(url);

  const id = (name: string) => `osf-${name}-${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;
  const dur = `${WAVE_SECONDS}s`;
  const values = (pick: (frame: NonNullable<typeof frames>[number]) => string) => frames?.map(pick).join(";");

  const view = mini ? { ...VIEW, height: CLOTH.tail + 6 } : VIEW;
  const height = (width * view.height) / view.width;
  const markSize = (EMBLEM.r - (mini ? 4 : 6.5)) * 2;
  const tasselled = Boolean(metal) && !mini;

  const tassel = (side: "left" | "right") => {
    const at = still[side];
    return (
      <g transform={`translate(${at[0]} ${at[1]})`}>
        {frames ? <animateTransform attributeName="transform" type="translate" dur={dur} repeatCount="indefinite" values={values((frame) => `${frame[side][0].toFixed(1)} ${frame[side][1].toFixed(1)}`)} /> : null}
        <g className={styles.tassel} style={{ "--swing-delay": side === "left" ? "-0.6s" : "0s" } as CSSProperties}>
          <path d="M0,-1 V4.5" stroke={fitting.lo} strokeWidth="1.3" />
          <circle cx="0" cy="6.4" r="2.8" fill={ref("metal")} stroke={fitting.lo} strokeWidth="0.6" />
          <path d="M-2.4,8.6 L2.4,8.6 L4.4,20 Q0,21.8 -4.4,20 Z" fill={ref("metal")} stroke={fitting.lo} strokeWidth="0.6" />
          <path d="M-1.9,11 L-2.9,19.6 M0,11 V20.6 M1.9,11 L2.9,19.6" stroke={fitting.lo} strokeWidth="0.5" opacity="0.7" />
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
        {/* Dye: light from the upper left, deepening toward the far edge. */}
        <linearGradient id={id("dye")} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor={colors.hi} />
          <stop offset="0.42" stopColor={colors.cloth} />
          <stop offset="1" stopColor={colors.lo} />
        </linearGradient>
        {/* Light and shade bands that travel down the cloth in step with the ripple. */}
        <linearGradient id={id("shade")} gradientUnits="userSpaceOnUse" x1="0" y1={CLOTH.top} x2="0" y2={CLOTH.top + SHADE_WAVELENGTH} spreadMethod="repeat" gradientTransform={frames ? undefined : `translate(0 ${((STILL_PHASE / (2 * Math.PI)) * SHADE_WAVELENGTH).toFixed(1)})`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="0.74" stopColor="#000" stopOpacity="0.38" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
          {frames ? <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to={`0 ${SHADE_WAVELENGTH}`} dur={dur} repeatCount="indefinite" /> : null}
        </linearGradient>
        {/* The ripple is calm near the rod, where the cloth is held. */}
        <linearGradient id={id("calm")} gradientUnits="userSpaceOnUse" x1="0" y1={CLOTH.top} x2="0" y2={CLOTH.top + 56}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={id("held")} maskUnits="userSpaceOnUse" x={view.x} y={view.y} width={view.width} height={view.height}>
          <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={ref("calm")} />
        </mask>
        <linearGradient id={id("rodShade")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("metal")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={fitting.hi} />
          <stop offset="0.45" stopColor={fitting.mid} />
          <stop offset="1" stopColor={fitting.lo} />
        </linearGradient>
        <linearGradient id={id("rod")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={fitting.hi} />
          <stop offset="0.5" stopColor={fitting.mid} />
          <stop offset="1" stopColor={fitting.lo} />
        </linearGradient>
        <radialGradient id={id("ball")} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor={fitting.hi} />
          <stop offset="0.55" stopColor={fitting.mid} />
          <stop offset="1" stopColor={fitting.lo} />
        </radialGradient>
        <radialGradient id={id("plate")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor={colors.plate} />
          <stop offset="1" stopColor={colors.lo} stopOpacity="0.9" />
        </radialGradient>
        {/* First place: a glint that runs along the gold now and then. */}
        {tier === "crown" && frames ? (
          <linearGradient id={id("glint")} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
            <animateTransform attributeName="gradientTransform" type="translate" values="-1 0;-1 0;1 0" keyTimes="0;0.62;1" dur="5.5s" repeatCount="indefinite" />
          </linearGradient>
        ) : null}
      </defs>

      {/* Fittings that hold the rod to the top edge of the header. */}
      {mini ? null : (
        <g>
          <path d="M6,0 V6 M94,0 V6" stroke={fitting.lo} strokeWidth="1.6" />
          <path d="M6,0 V6 M94,0 V6" stroke={fitting.mid} strokeWidth="0.7" />
        </g>
      )}

      {/* The cloth. */}
      <use href={`#${id("cloth")}`} fill={ref("dye")} />
      <g clipPath={ref("clip")}>
        <rect x={view.x} y={CLOTH.top} width={view.width} height={CLOTH.tail} fill={ref("shade")} mask={ref("held")} />
        <rect x={view.x} y={CLOTH.top} width={view.width} height="9" fill={ref("rodShade")} />
        {metal ? (
          <>
            <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth={mini ? 14 : 11} />
            <use href={`#${id("cloth")}`} fill="none" stroke={ref("metal")} strokeWidth={mini ? 12 : 9} />
            {tier === "crown" && frames ? <use href={`#${id("cloth")}`} fill="none" stroke={ref("glint")} strokeWidth="9" /> : null}
            {mini ? null : <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth="15" strokeDasharray="2.4 2" opacity="0.35" />}
          </>
        ) : tier === "top10" ? (
          <>
            <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth={mini ? 10 : 7.5} opacity="0.7" />
            <use href={`#${id("cloth")}`} fill="none" stroke={colors.stitch} strokeWidth={mini ? 8 : 5.5} />
          </>
        ) : null}
      </g>
      <use href={`#${id("cloth")}`} fill="none" stroke={colors.edge} strokeWidth={mini ? 2.4 : 1.2} strokeLinejoin="round" />

      {/* The oshimark on its embroidered patch. */}
      <g transform={`translate(${still.emblem.toFixed(1)} 0)`}>
        {frames ? <animateTransform attributeName="transform" type="translate" dur={dur} repeatCount="indefinite" values={values((frame) => `${frame.emblem.toFixed(1)} 0`)} /> : null}
        <circle cx={EMBLEM.cx} cy={EMBLEM.cy} r={EMBLEM.r} fill={ref("plate")} stroke={metal ? ref("metal") : colors.stitch} strokeWidth={mini ? 3.4 : 2} />
        {mini ? null : <circle cx={EMBLEM.cx} cy={EMBLEM.cy} r={EMBLEM.r - 3.4} fill="none" stroke={metal ? fitting.hi : colors.stitch} strokeWidth="1" strokeDasharray="2.6 2.1" opacity="0.75" />}
        {failed ? (
          <text className={styles.letter} x={EMBLEM.cx} y={EMBLEM.cy} textAnchor="middle" dominantBaseline="central" fontSize={EMBLEM.r * 1.1} fill={colors.mark}>
            {standing.symbol.charAt(0)}
          </text>
        ) : (
          <image href={url ?? undefined} x={EMBLEM.cx - markSize / 2} y={EMBLEM.cy - markSize / 2} width={markSize} height={markSize} preserveAspectRatio="xMidYMid meet" className={styles.mark} />
        )}
      </g>

      {/* The sleeve the rod runs through, and the rod. */}
      <rect x="-1" y="3.5" width="102" height="10" rx="2" fill={colors.lo} stroke={colors.edge} strokeWidth={mini ? 2 : 0.8} />
      <rect x="-9" y="5.2" width="118" height="5.6" rx="2.8" fill={ref("rod")} stroke={fitting.lo} strokeWidth={mini ? 1.4 : 0.6} />
      <circle cx="-11.5" cy="8" r="5" fill={ref("ball")} stroke={fitting.lo} strokeWidth={mini ? 1.4 : 0.6} />
      <circle cx="111.5" cy="8" r="5" fill={ref("ball")} stroke={fitting.lo} strokeWidth={mini ? 1.4 : 0.6} />

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
  const { calm } = useMotion();
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
        <Standard standing={standing} playerColor={playerColor} animate={!calm} mini={false} width={Math.round((width * VIEW.width) / CLOTH.width)} />
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
