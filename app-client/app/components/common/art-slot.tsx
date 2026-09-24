"use client";

import { useEffect } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { pickChibiSize, resolveArtUrl, type ChibiPose } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";
import styles from "@/app/components/common/art-slot.module.scss";

type ArtSlotProps = {
  symbol: string;
  icon?: string | null;
  /** Talent color (already made readable with talentAccent). Drives the placeholder wash. */
  accent?: string;
  className?: string;
  /** Rendered width in px, used to choose an export size. */
  width?: number;
  priority?: boolean;
  /** Drawn instead of the default placeholder while the talent has no art. */
  fallback?: React.ReactNode;
} & ({ kind: "keyart" } | { kind: "chibi"; pose?: ChibiPose });

/**
 * Character art from the art pipeline's manifest. Until a talent's art exists
 * it renders a placeholder: the talent's color wash, a halftone and a large
 * faded oshimark, so pages look finished before the art lands.
 */
export function ArtSlot(props: ArtSlotProps) {
  const { symbol, icon, accent, className, width = 256, priority = false, fallback } = props;
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const talent = manifest?.talents?.[symbol];
  const style = accent ? ({ "--tal": accent } as React.CSSProperties) : undefined;
  const classes = [styles.slot, props.kind === "keyart" ? styles.keyart : styles.chibi, className].filter(Boolean).join(" ");

  if (props.kind === "keyart" && talent?.keyart) {
    const art = talent.keyart;
    const srcSet = art.srcset
      ? Object.entries(art.srcset)
          .map(([w, path]) => (path ? `${resolveArtUrl(path)} ${w}w` : null))
          .filter(Boolean)
          .join(", ")
      : undefined;
    return (
      <div className={classes} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.image}
          src={resolveArtUrl(art.src) ?? undefined}
          srcSet={srcSet || undefined}
          sizes={`${width}px`}
          width={art.w}
          height={art.h}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
        />
      </div>
    );
  }

  if (props.kind === "chibi") {
    const pose = props.pose ?? "idle";
    const chibi = talent?.chibi?.[pose] ?? null;
    const src = resolveArtUrl(pickChibiSize(chibi?.sizes, width));
    const blink = resolveArtUrl(pickChibiSize(chibi?.blink ?? null, width));
    if (src) {
      return (
        <div className={classes} style={style}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.image} src={src} alt="" loading={priority ? "eager" : "lazy"} decoding="async" />
          {blink ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={`${styles.image} ${styles.blink}`} src={blink} alt="" loading="lazy" decoding="async" aria-hidden="true" />
          ) : null}
        </div>
      );
    }
  }

  if (fallback) {
    return (
      <div className={classes} style={style} aria-hidden="true">
        {fallback}
      </div>
    );
  }

  return (
    <div className={`${classes} ${styles.placeholder}`} style={style} aria-hidden="true">
      <span className={styles.halftone} />
      <Oshimark icon={icon} symbol={symbol} size={Math.round(width * 0.42)} className={styles.watermark} />
    </div>
  );
}
