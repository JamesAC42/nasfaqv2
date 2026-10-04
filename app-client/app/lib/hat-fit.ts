import type { CSSProperties } from "react";
import fits from "@/app/lib/hat-fit.json";

/**
 * Where each hat sits on a player's picture, set with the hat fitter (`npm run hats` in app-client,
 * see scripts/hat-fitter): `x` and `y` move it right and down by fractions of the picture's size,
 * `scale` grows it and `rotate` tilts it (degrees), both about the middle of its bottom edge. Keyed by
 * the hat's cosmetic key. Hats not listed sit at the default spot (player-avatar.module.scss).
 */
export type HatFit = { x?: number; y?: number; scale?: number; rotate?: number };

const FITS = fits as Record<string, HatFit>;

/** The CSS variables PlayerAvatar puts on a hat's image (none for a hat without a fit). */
export function hatFitStyle(key: string | null | undefined): CSSProperties | undefined {
  const fit = key ? FITS[key] : undefined;
  if (!fit) return undefined;
  return { "--hx": fit.x ?? 0, "--hy": fit.y ?? 0, "--hk": fit.scale ?? 1, "--hr": `${fit.rotate ?? 0}deg` } as CSSProperties;
}
