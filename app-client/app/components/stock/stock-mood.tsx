"use client";

import { ReactionFace } from "@/app/components/common/reaction-face";
import { useHasArt } from "@/app/components/common/use-art-image";
import { artId, type ChibiPose } from "@/app/lib/art-manifest";
import { signedPct } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import type { ChatterTalent } from "@/app/stores/chatter-store";
import styles from "@/app/components/stock/dossier.module.scss";

type Mood = { pose: ChibiPose; label: string };

/**
 * How she'd react to her own stock right now, or nothing when nothing's happening. Order matters:
 * a crash beats a trend, a moonshot beats being the day's top gainer.
 */
export function pickMood({ move, move15d, topGainer, heat, live }: { move: number | null; move15d: number | null; topGainer: boolean; heat: number | null; live: boolean }): Mood | null {
  if (move !== null && move <= -0.08) return { pose: "shock", label: `${signedPct(move, 1)} today` };
  if (move !== null && move >= 0.08) return { pose: "moon", label: `${signedPct(move, 1)} today` };
  if (move15d !== null && move15d >= 0.25) return { pose: "moon", label: `${signedPct(move15d, 0)} in 15 days` };
  if (topGainer && move !== null && move >= 0.02) return { pose: "smug", label: "Top gainer today" };
  if (heat !== null && heat >= 2.5) return { pose: "hype", label: `Talk of /vt/ · ${heat.toFixed(1)}×` };
  if (live && (move ?? 0) >= 0) return { pose: "hype", label: "Live now" };
  if (move !== null && move <= -0.03) return { pose: "cope", label: `${signedPct(move, 1)} today` };
  if (move15d !== null && move15d <= -0.15) return { pose: "cope", label: `${signedPct(move15d, 0)} in 15 days` };
  return null;
}

/** A small reaction beside the price. Only shows when there's a mood and her art for it exists. */
export function StockMood({ asset, assets, chatter, live, move15d }: { asset: MarketAsset; assets: MarketAsset[]; chatter: ChatterTalent | null; live: boolean; move15d: number | null }) {
  const move = asset.move_24h_pct ?? null;
  const best = assets.reduce<number | null>((top, entry) => (entry.move_24h_pct !== null && entry.move_24h_pct !== undefined && (top === null || entry.move_24h_pct > top) ? entry.move_24h_pct : top), null);
  const mood = pickMood({ move, move15d, topGainer: best !== null && move !== null && move >= best, heat: chatter?.heat ?? null, live });
  const sym = asset.symbol.toUpperCase();
  const hasArt = useHasArt(mood ? artId(sym, "reaction", mood.pose) : null);
  if (!mood || !hasArt) return null;
  return (
    <span className={styles.stockMood} data-pose={mood.pose} title={`${asset.display_name}: ${mood.label}`}>
      <ReactionFace symbol={sym} pose={mood.pose} size={44} />
      <small>{mood.label}</small>
    </span>
  );
}
