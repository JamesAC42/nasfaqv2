"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { artId, lookupArt, resolveArtUrl, type ChibiPose } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/reaction-face.module.scss";

export const REACTION_POSES: ChibiPose[] = ["idle", "hype", "moon", "cope", "smug", "shock"];

/** "reaction:PEK/hype" (an avatar URL from the API) or "PEK/hype" → { symbol, pose }. */
export function parseReaction(value: string | null | undefined): { symbol: string; pose: ChibiPose } | null {
  const match = /^(?:reaction:)?([A-Z0-9_]{1,16})\/(idle|hype|moon|cope|smug|shock)$/.exec(String(value ?? "").trim());
  return match ? { symbol: match[1], pose: match[2] as ChibiPose } : null;
}

/**
 * A talent's reaction pose, either cropped to her face (`crop="face"`, for avatars: zoomed in and
 * anchored on the pipeline's eye line) or whole (`crop="full"`, for chat stickers). Falls back to
 * her oshimark until the art exists.
 */
export function ReactionFace({ symbol, pose, size, crop = "face", className }: { symbol: string; pose: ChibiPose; size: number; crop?: "face" | "full"; className?: string }) {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const icon = useMarketStore((state) => state.assets.find((asset) => asset.symbol === symbol)?.icon ?? null);
  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const image = lookupArt(manifest, artId(symbol, "reaction", pose));
  if (!image) {
    return (
      <span className={[styles.face, styles.missing, className].filter(Boolean).join(" ")} data-art-id={artId(symbol, "reaction", pose)} data-art-missing="">
        <Oshimark icon={icon} symbol={symbol} size={Math.max(12, Math.round(size * (crop === "full" ? 0.42 : 0.55)))} />
      </span>
    );
  }

  // Smallest export that is still sharp at 2x (the face crop shows about half the image).
  const zoom = crop === "face" ? 1.85 : 1;
  const want = size * 2 * zoom;
  const sizes = Object.entries(image.srcset ?? {})
    .map(([width, path]) => [Number(width), path] as const)
    .filter(([width]) => Number.isFinite(width))
    .sort((a, b) => a[0] - b[0]);
  const path = sizes.find(([width]) => width >= want)?.[1] ?? sizes[sizes.length - 1]?.[1] ?? image.src;
  const eyeX = image.anchors?.eye_x ?? 0.5;
  const eyeY = image.anchors?.eye_y ?? 0.36;
  const style =
    crop === "face"
      ? ({ transform: `scale(${zoom})`, transformOrigin: `${(eyeX * 100).toFixed(1)}% ${(eyeY * 100).toFixed(1)}%` } as React.CSSProperties)
      : undefined;

  return (
    <span className={[styles.face, crop === "full" ? styles.full : null, className].filter(Boolean).join(" ")} data-art-id={artId(symbol, "reaction", pose)}>
      <img src={resolveArtUrl(path) ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} style={style} />
    </span>
  );
}
