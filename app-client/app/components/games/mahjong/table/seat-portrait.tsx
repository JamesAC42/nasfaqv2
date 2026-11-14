"use client";

import { useMemo, type CSSProperties } from "react";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { artId, lookupArt, type ChibiPose } from "@/app/lib/art-manifest";
import { talentAccent } from "@/app/lib/talent-color";
import type { PublicSeat } from "@/app/lib/games/mahjong/types";
import { useTheme } from "@/app/providers/theme-provider";
import { useArtStore } from "@/app/stores/art-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/games/mahjong/table/table-board.module.scss";

export type SeatStyle = { color: string; talentName: string | null };

/**
 * Each seat's talent color and name. Seats carry only the talent's ticker, so the color comes from the
 * market's asset list (the way every other talent surface does it), falling back to the player's own
 * profile color, then the site blue.
 */
export function useSeatStyles(seats: readonly (PublicSeat | null)[]): SeatStyle[] {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  return useMemo(
    () =>
      seats.map((seat) => {
        const asset = seat?.talent ? assets.find((entry) => entry.symbol === seat.talent) : undefined;
        return { color: talentAccent(asset?.color ?? seat?.profile_color, theme), talentName: asset?.display_name ?? seat?.talent ?? null };
      }),
    [assets, seats, theme],
  );
}

/** The seat's talent in a round portrait. A pose the talent has no art for falls back to idle. No words, ever. */
export function SeatPortrait({ seat, pose, size, color, className }: { seat: PublicSeat | null; pose: ChibiPose; size: number; color: string; className?: string }) {
  const manifest = useArtStore((state) => state.manifest);
  const symbol = seat?.talent ?? null;
  const shown: ChibiPose = symbol && !lookupArt(manifest, artId(symbol, "reaction", pose)) ? "idle" : pose;
  return (
    <span className={[styles.portrait, className].filter(Boolean).join(" ")} style={{ "--tal": color, width: size, height: size } as CSSProperties} data-pose={shown}>
      {symbol ? <ReactionFace key={shown} symbol={symbol} pose={shown} size={size} crop="full" className={styles.portraitFace} /> : <b aria-hidden="true">{(seat?.username ?? "?").slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}
