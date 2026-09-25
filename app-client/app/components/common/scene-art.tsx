"use client";

import { useEffect, useSyncExternalStore } from "react";
import { resolveArtUrl } from "@/app/lib/art-manifest";
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
};

const DEBUG_KEY = "nasfaq-art-debug";
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};
const readDebug = () => {
  try {
    return process.env.NODE_ENV !== "production" || window.localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return process.env.NODE_ENV !== "production";
  }
};

/**
 * A non-talent image (backdrop, illustration, spot) from the art manifest's `scenes`. Until the
 * art exists it draws a placeholder with the final aspect ratio; in development (or with
 * localStorage "nasfaq-art-debug" = "1") the placeholder is labelled with its slot id and size.
 */
export function SceneArt({ slot, className, fill = false, position, width = 800, priority = false, alt = "" }: SceneArtProps) {
  const spec = getSceneSlot(slot);
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const debug = useSyncExternalStore(subscribe, readDebug, () => false);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  if (!spec && process.env.NODE_ENV !== "production") console.warn(`SceneArt: unknown slot "${slot}"`);
  const art = manifest?.scenes?.[slot];
  const ratio = art ? `${art.w} / ${art.h}` : spec ? `${spec.w} / ${spec.h}` : "16 / 9";
  const classes = [styles.slot, fill ? styles.fill : null, className].filter(Boolean).join(" ");
  const style = fill ? undefined : ({ aspectRatio: ratio } as React.CSSProperties);

  if (art) {
    const srcSet = art.srcset
      ? Object.entries(art.srcset)
          .map(([w, path]) => (path ? `${resolveArtUrl(path)} ${w}w` : null))
          .filter(Boolean)
          .join(", ")
      : undefined;
    return (
      <div className={classes} style={style} aria-hidden={alt ? undefined : true}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.image}
          src={resolveArtUrl(art.src) ?? undefined}
          srcSet={srcSet || undefined}
          sizes={`${width}px`}
          width={art.w}
          height={art.h}
          alt={alt}
          style={position ? { objectPosition: position } : undefined}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
        />
      </div>
    );
  }

  const kind = spec?.kind ?? "illustration";
  return (
    <div className={`${classes} ${styles.placeholder}`} style={style} data-kind={kind} data-slot={slot} aria-hidden="true">
      <span className={styles.halftone} />
      {debug ? (
        <span className={styles.label}>
          <b>{slot}</b>
          <small>
            {spec ? `${spec.w}×${spec.h} · ${spec.kind}${spec.transparent ? " · transparent" : ""}` : "unregistered slot"}
          </small>
        </span>
      ) : null}
    </div>
  );
}
