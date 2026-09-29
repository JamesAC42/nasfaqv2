"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ReactionFace } from "@/app/components/common/reaction-face";
import type { ArtManifest, ChibiPose } from "@/app/lib/art-manifest";
import { talentAccent } from "@/app/lib/talent-color";
import { useTheme } from "@/app/providers/theme-provider";
import { useArtStore } from "@/app/stores/art-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/talent-reaction.module.scss";

/** Talents whose reaction art for `pose` is in the manifest. */
export function talentsWithPose(manifest: ArtManifest | null, pose: ChibiPose): string[] {
  if (!manifest) return [];
  const out = new Set<string>();
  for (const id of Object.keys(manifest.images ?? {})) {
    const match = /^([A-Z0-9_]+)\/reaction\/([a-z]+)$/.exec(id);
    if (match && match[2] === pose) out.add(match[1]);
  }
  for (const [symbol, talent] of Object.entries(manifest.talents ?? {})) if (talent.chibi?.[pose]) out.add(symbol);
  return [...out].sort();
}

// The talent picked for this visit (kept across poses while they have the art).
let visitPick: string | null = null;

/**
 * Which talent reacts: `prefer` when their art exists, otherwise a random one that has the pose.
 * The random pick happens after mount, so server and client render the same first frame.
 */
export function useReactionTalent(pose: ChibiPose, prefer?: string | null, fresh = false) {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const candidates = useMemo(() => talentsWithPose(manifest, pose), [manifest, pose]);
  const [random, setRandom] = useState<string | null>(null);
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);
  const preferred = prefer ? prefer.toUpperCase() : null;
  const usePreferred = preferred !== null && candidates.includes(preferred);
  useEffect(() => {
    if (usePreferred || !candidates.length) return;
    // Deferred so the first client frame matches the server's. One talent per visit: every empty
    // list on the page (and the next page) shows the same one, rather than a crowd.
    const timer = window.setTimeout(() => {
      const roll = () => candidates[Math.floor(Math.random() * candidates.length)];
      if (fresh) {
        setRandom((current) => (current && candidates.includes(current) ? current : roll()));
        return;
      }
      const kept = visitPick && candidates.includes(visitPick) ? visitPick : null;
      visitPick = kept ?? roll();
      setRandom(visitPick);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [candidates, usePreferred, fresh]);
  return usePreferred ? preferred : random;
}

type TalentReactionProps = {
  pose: ChibiPose;
  /** A talent to prefer (the stock you're on, the card you drew); falls back to a random one. */
  symbol?: string | null;
  /** Rendered diameter in px. */
  size?: number;
  /** A new random talent each time (game results, 404s) instead of the one talent for this visit. */
  fresh?: boolean;
  /** Line under the portrait; `{name}` is replaced with the talent's name. */
  caption?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * A talent's reaction in a round portrait with their colour behind it: the face of empty lists
 * (idle), errors (cope), 404s (shock) and game results (hype / cope). Renders an empty disc of
 * the same size until the art is known, so nothing jumps.
 */
export function TalentReaction({ pose, symbol, size = 160, fresh = false, caption, className, children }: TalentReactionProps) {
  const who = useReactionTalent(pose, symbol, fresh);
  const asset = useMarketStore((state) => (who ? state.assets.find((entry) => entry.symbol === who) : undefined));
  const { theme } = useTheme();
  const accent = talentAccent(asset?.color, theme);
  const name = asset?.display_name?.split(" ").slice(-1)[0] ?? who ?? "";
  return (
    <figure className={[styles.wrap, className].filter(Boolean).join(" ")} style={{ "--size": `${size}px`, "--tal": accent } as CSSProperties} data-pose={pose} data-ready={who ? "" : undefined}>
      <span className={styles.disc}>{who ? <ReactionFace symbol={who} pose={pose} size={size} crop="full" className={styles.face} /> : null}</span>
      {caption && who ? <figcaption className={styles.caption}>{caption.replace("{name}", name)}</figcaption> : null}
      {children}
    </figure>
  );
}
