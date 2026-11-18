// DOM overlays pinned to points in the 3D scene (nameplates, cheer chips, talent stamps). The DOM side
// registers its elements here; the canvas projects each anchor every frame and writes the transform
// directly, so the text stays crisp HTML and React never re-renders for it.

import { portraitSpot, TABLE, type Vec3 } from "@/app/components/games/mahjong/stage/geometry";

export type AnchorKind = "plate" | "cheer" | "stamp";

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
    // On the rim in front of each opponent: the side players' on their own side of it, in front of their
    // hand and under the figure rather than over it (on a phone, near the far end, under their corner).
    if (seat === 2) return [0, TABLE.lip + 0.6, -TABLE.rim];
    return [Math.sign(spot.p[0]) * (TABLE.rim + 1), TABLE.lip + 0.6, narrow > 0.5 ? -28 : spot.p[2] + 18];
  }
  if (kind === "stamp") {
    // Yours pops on the felt in front of you, in the gap between your discards and the next player's,
    // clear of every face at any width.
    if (seat === 0) return [19, 5, 19];
    // An opponent's shares their nameplate's point and stands on top of it (the CSS lifts it above).
    return anchorWorld("plate", seat, narrow);
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
