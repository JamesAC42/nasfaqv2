"use client";

import { useEffect } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { artId, artSrcSet, lookupArt, resolveArtUrl, type ArtImage, type ChibiPose } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";
import styles from "@/app/components/common/art-slot.module.scss";

type Common = {
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
  /** `contain` for cutouts (default for key art and reactions), `cover` for full scenes. */
  fit?: "contain" | "cover";
  alt?: string;
};

type Target =
  | { kind: "keyart" }
  | { kind: "chibi" | "reaction"; pose?: ChibiPose }
  /** Any talent slot from art-pipeline/spec/slots.json, e.g. `card-ssr`, `banner`. */
  | { kind?: undefined; slot: string; variant?: string; /** Slots to try, in order, when this one has no art yet. */ fallbackSlots?: string[] };

type ArtSlotProps = Common & Target;

/** The IDs to try, best first: e.g. `PEK/card-ssr/default` then `PEK/keyart/default`. */
function candidates(props: ArtSlotProps): { ids: string[]; slot: string } {
  if ("slot" in props && props.slot) {
    const ids = [artId(props.symbol, props.slot, props.variant ?? "default"), ...(props.fallbackSlots ?? []).map((slot) => artId(props.symbol, slot))];
    return { ids, slot: props.slot };
  }
  if (props.kind === "keyart") return { ids: [artId(props.symbol, "keyart")], slot: "keyart" };
  if ("pose" in props || props.kind === "chibi" || props.kind === "reaction") return { ids: [artId(props.symbol, "reaction", ("pose" in props && props.pose) || "idle")], slot: "reaction" };
  return { ids: [artId(props.symbol, "keyart")], slot: "keyart" };
}

/**
 * Talent art from the art pipeline's manifest, looked up by ID (`SYMBOL/slot/variant`). Until a
 * talent's art exists it renders a placeholder: the talent's color wash, a halftone and a large
 * faded oshimark, so pages look finished before the art lands. Every render carries
 * `data-art-id` so a bad or missing image can be found from the inspector.
 */
export function ArtSlot(props: ArtSlotProps) {
  const { symbol, icon, accent, className, width = 256, priority = false, fallback, alt = "" } = props;
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const { ids, slot } = candidates(props);
  let chosen: { id: string; image: ArtImage } | null = null;
  for (const id of ids) {
    const image = lookupArt(manifest, id);
    if (image) {
      chosen = { id, image };
      break;
    }
  }

  const shape = slot === "keyart" ? styles.keyart : slot === "reaction" ? styles.chibi : null;
  const style = accent ? ({ "--tal": accent } as React.CSSProperties) : undefined;
  const classes = [styles.slot, shape, className].filter(Boolean).join(" ");

  if (chosen) {
    const { id, image } = chosen;
    const chosenSlot = id.split("/")[1];
    // Cutouts (key art, reactions) keep the stylesheet's fit, which pages may override; full scenes
    // (cards, banners) and an explicit `fit` are set inline.
    const cutout = chosenSlot === "keyart" || chosenSlot === "reaction";
    const fit = props.fit && chosenSlot === slot ? props.fit : cutout ? null : "cover";
    const focus = image.anchors?.focus;
    const imgStyle: React.CSSProperties | undefined = fit
      ? { objectFit: fit, objectPosition: focus ? `${focus[0] * 100}% ${focus[1] * 100}%` : fit === "cover" ? "50% 30%" : undefined }
      : undefined;
    // Idle reactions blink: an eyes-closed frame shows briefly every few seconds.
    const blink = chosenSlot === "reaction" ? lookupArt(manifest, `${id}-blink`) : null;
    return (
      <div className={classes} style={style} data-art-id={id} aria-hidden={alt ? undefined : true}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.image}
          style={imgStyle}
          src={resolveArtUrl(image.src) ?? undefined}
          srcSet={artSrcSet(image)}
          sizes={`${width}px`}
          width={image.w}
          height={image.h}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
        />
        {blink ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={`${styles.image} ${styles.blink}`}
            style={imgStyle}
            src={resolveArtUrl(blink.src) ?? undefined}
            srcSet={artSrcSet(blink)}
            sizes={`${width}px`}
            alt=""
            loading="lazy"
            decoding="async"
            aria-hidden="true"
          />
        ) : null}
      </div>
    );
  }

  if (fallback) {
    return (
      <div className={classes} style={style} data-art-id={ids[0]} data-art-missing="" aria-hidden="true">
        {fallback}
      </div>
    );
  }

  return (
    <div className={`${classes} ${styles.placeholder}`} style={style} data-art-id={ids[0]} data-art-missing="" aria-hidden="true">
      <span className={styles.halftone} />
      <Oshimark icon={icon} symbol={symbol} size={Math.round(width * 0.42)} className={styles.watermark} />
    </div>
  );
}
