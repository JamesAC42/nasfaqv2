import type { CSSProperties } from "react";
import fits from "@/app/lib/hat-fit.json";

/**
 * Where each hat and item sits on a player's picture, set with the fitter (`npm run hats` in
 * app-client, see scripts/hat-fitter): `x` and `y` move it right and down by fractions of the
 * picture's size, `scale` grows it and `rotate` tilts it (degrees), both about the middle of its bottom
 * edge. Keyed by cosmetic key (hats and items never share one). Anything not listed sits at its slot's
 * default spot (player-avatar.module.scss: hats on top, items at the lower right).
 */
export type HatFit = { x?: number; y?: number; scale?: number; rotate?: number };

const FITS = fits as Record<string, HatFit>;

/** The CSS variables PlayerAvatar puts on a hat's or item's image (none without a fit). */
export function fitStyle(key: string | null | undefined): CSSProperties | undefined {
  const fit = key ? FITS[key] : undefined;
  if (!fit) return undefined;
  return { "--hx": fit.x ?? 0, "--hy": fit.y ?? 0, "--hk": fit.scale ?? 1, "--hr": `${fit.rotate ?? 0}deg` } as CSSProperties;
}
