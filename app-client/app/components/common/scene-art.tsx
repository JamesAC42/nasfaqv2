"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { artSrcSet, lookupArt, resolveArtUrl, sharedArtId } from "@/app/lib/art-manifest";
import { getSceneSlot } from "@/app/lib/art/scene-slots";
import { useArtStore } from "@/app/stores/art-store";
import styles from "@/app/components/common/scene-art.module.scss";

type SceneArtProps = {
  /** Slot id from app/lib/art/slots/*.json. */
  slot: string;
  className?: string;
  /** Cover the parent (position it yourself) instead of sizing to the slot's aspect ratio. */
  fill?: boolean;
  /** How the image sits when `fill` crops it. */
  position?: string;
  /** Rendered width in px, for srcset. */
  width?: number;
  priority?: boolean;
  /** Alt text when the image carries meaning; decorative (empty alt) by default. */
  alt?: string;
  /** Named version of the slot (see its `variants`), e.g. `light`. */
  variant?: string;
  /**
   * The drawn version (SVG/CSS) that is the design until a `_shared` image for this slot ships in
   * the manifest; the image replaces it when it does. Without one, the halftone panel is the design.
   */
  fallback?: ReactNode;
};

const DEBUG_KEY = "nasfaq-art-debug";
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};
// The drawn fallbacks are the finished design, so slot labels are opt-in (localStorage flag), even in dev.
const readDebug = () => {
  try {
    return window.localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * A non-talent image (backdrop, illustration, spot), looked up in the art manifest by ID
 * (`_shared/<slot>/<variant>`, carried as `data-art-id`). When there's no image, the drawn
 * `fallback` (or the halftone panel) is what shows, and that is the design, not a stand-in. With
 * localStorage "nasfaq-art-debug" = "1" the panel is labelled with its slot id and size.
 */
export function SceneArt({ slot, className, fill = false, position, width = 800, priority = false, alt = "", variant = "default", fallback }: SceneArtProps) {
  const spec = getSceneSlot(slot);
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const debug = useSyncExternalStore(subscribe, readDebug, () => false);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  if (!spec && process.env.NODE_ENV !== "production") console.warn(`SceneArt: unknown slot "${slot}"`);
  const id = sharedArtId(slot, variant);
  const art = lookupArt(manifest, id) ?? (variant !== "default" ? lookupArt(manifest, sharedArtId(slot)) : null);
  const ratio = art ? `${art.w} / ${art.h}` : spec ? `${spec.w} / ${spec.h}` : "16 / 9";
  const classes = [styles.slot, fill ? styles.fill : null, className].filter(Boolean).join(" ");
  const style = fill ? undefined : ({ aspectRatio: ratio } as React.CSSProperties);

  if (art) {
    const srcSet = artSrcSet(art);
    // An explicit position wins; otherwise crop around the pipeline's focus point, if it sent one.
    const focus = art.anchors?.focus;
    const objectPosition = position ?? (focus ? `${Math.round(focus[0] * 100)}% ${Math.round(focus[1] * 100)}%` : undefined);
    return (
      <div className={classes} style={style} data-art-id={id} aria-hidden={alt ? undefined : true}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.image}
          src={resolveArtUrl(art.src) ?? undefined}
          srcSet={srcSet || undefined}
          sizes={`${width}px`}
          width={art.w}
          height={art.h}
          alt={alt}
          style={objectPosition ? { objectPosition } : undefined}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
        />
      </div>
    );
  }

  if (fallback !== undefined) {
    return (
      <div className={`${classes} ${styles.drawn}`} style={style} data-art-id={id} data-art-missing="" aria-hidden={alt ? undefined : true} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        {fallback}
      </div>
    );
  }

  const kind = spec?.kind ?? "illustration";
  return (
    <div className={`${classes} ${styles.placeholder}`} style={style} data-kind={kind} data-art-id={id} data-art-missing="" aria-hidden="true">
      <span className={styles.halftone} />
      {debug ? (
        <span className={styles.label}>
          <b>{id}</b>
          <small>
            {spec ? `${spec.w}×${spec.h} · ${spec.kind}${spec.transparent ? " · transparent" : ""}` : "unregistered slot"}
          </small>
        </span>
      ) : null}
    </div>
  );
}
