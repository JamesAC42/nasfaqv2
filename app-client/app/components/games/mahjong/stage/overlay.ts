// DOM overlays pinned to points in the 3D scene (nameplates, cheer chips). The DOM side registers its
// elements here; the canvas projects each anchor every frame and writes the transform directly, so
// the text stays crisp HTML and React never re-renders for it.

import { portraitSpot, TABLE, type Vec3 } from "@/app/components/games/mahjong/stage/geometry";

export type AnchorKind = "plate" | "cheer";

export const overlayEls = new Map<string, HTMLElement>();
export const anchorKey = (kind: AnchorKind, seat: number) => `${kind}-${seat}`;

/** Set by the canvas: draws a frame, so an overlay registered between frames gets placed. */
let repaint: (() => void) | null = null;
export function setOverlayRepaint(next: (() => void) | null) {
  repaint = next;
}

export function registerOverlay(key: string, el: HTMLElement | null) {
  if (el) {
    overlayEls.set(key, el);
    repaint?.();
  } else overlayEls.delete(key);
}

/** The button over one of your tiles (scene-tiles pins it over the tile's face). */
export const handKey = (id: number) => `hand-${id}`;

/** World point for an overlay. `narrow` is the camera rig's 0 (landscape) to 1 (phone). */
export function anchorWorld(kind: AnchorKind, seat: number, narrow: number): Vec3 {
  // The spot's point is the bottom of the figure, hidden behind the table; its size is the figure's height.
  const spot = portraitSpot(seat, narrow);
  if (kind === "plate") {
    // On the rim in front of each opponent. A phone lines all three up across the far edge, so the
    // side players' plates drop a row onto the felt to clear the middle one.
    if (seat === 2) return [0, TABLE.lip + 0.6, -TABLE.rim];
    if (narrow > 0.5) return [spot.p[0], TABLE.lip + 0.6, -TABLE.rim + 7];
    // Side players: on the rim a little nearer you than they sit, clear of the chin.
    return [Math.sign(spot.p[0]) * (TABLE.rim + 1), TABLE.lip + 0.6, spot.p[2] + 15];
  }
  // Cheers float up beside the portrait's head, on the side toward the middle of the screen.
  // On a phone the three sit in a row, so cheers rise from above each head instead.
  if (narrow > 0.5 && seat === 2) return [spot.p[0] + spot.shoulder * 0.45, spot.p[1] + spot.size * 0.95, spot.p[2]];
  if (narrow > 0.5 && seat !== 0) return [spot.p[0] - Math.sign(spot.p[0]) * spot.shoulder * 0.3, spot.p[1] + spot.size * 1.05, spot.p[2]];
  const up = spot.p[1] + spot.size * 0.78;
  if (seat === 2) return [spot.p[0] + spot.shoulder * 0.62, up, spot.p[2]];
  if (seat === 0) return [TABLE.felt * 0.6, 8, TABLE.felt];
  return [spot.p[0] - Math.sign(spot.p[0]) * spot.shoulder * 0.66, up, spot.p[2]];
}

/** Live FPS readout element (debug bar). */
export const fpsKey = "fps";
