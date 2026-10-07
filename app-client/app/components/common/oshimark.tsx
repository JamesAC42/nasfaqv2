"use client";

import { useCallback, useState } from "react";
import { getIconUrl } from "@/app/lib/normalizers";
import styles from "@/app/components/common/oshimark.module.scss";

/**
 * A talent's oshimark (the Twemoji-style SVG each stock uses as its logo).
 * This is the primary way a stock is represented next to its ticker: tape,
 * board tiles, rows, chips, headlines. Decorative by default; the ticker text
 * next to it carries the meaning.
 *
 * A new talent may list before her SVG is uploaded, so a mark that fails to load shows her ticker's
 * letter, the same as a talent with no icon at all.
 */
export function Oshimark({
  icon,
  symbol,
  size = 16,
  className,
  title,
}: {
  icon: string | null | undefined;
  symbol?: string;
  size?: number;
  className?: string;
  /** Set when the mark stands alone without a visible ticker next to it. */
  title?: string;
}) {
  const url = getIconUrl(icon);
  // Which URL failed (so a talent whose icon changes is tried again).
  const [failed, setFailed] = useState<string | null>(null);
  // An image that failed before the page hydrated never fires onError for React; decode() rejects for
  // a broken image. (Not naturalWidth: these SVGs have no size of their own, so a good one can report
  // 0.) Memoized so it runs once per icon, not on every render of the tape.
  const checkLoaded = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete) element.decode().catch(() => setFailed(url));
    },
    [url],
  );
  const classes = [styles.mark, className].filter(Boolean).join(" ");

  if (!url || failed === url) {
    return (
      <span
        className={`${classes} ${styles.fallback}`}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.55)) }}
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        aria-label={title}
      >
        {symbol?.charAt(0) ?? "?"}
      </span>
    );
  }

  return (
    // Plain <img>: these are tiny static SVGs from our CDN; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={classes}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(url)}
      ref={checkLoaded}
    />
  );
}
