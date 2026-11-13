// DOM overlays pinned to points in the 3D scene (nameplates, cheer chips). The DOM side registers its
// elements here; the canvas projects each anchor every frame and writes the transform directly, so
// the text stays crisp HTML and React never re-renders for it.

import { portraitSpot, TABLE, type Vec3 } from "@/app/components/games/mahjong/stage/geometry";

export type AnchorKind = "plate" | "cheer";

export const overlayEls = new Map<string, HTMLElement>();
export const anchorKey = (kind: AnchorKind, seat: number) => `${kind}-${seat}`;

export function registerOverlay(key: string, el: HTMLElement | null) {
  if (el) overlayEls.set(key, el);
  else overlayEls.delete(key);
}

/** World point for an overlay. `narrow` is the camera rig's 0 (landscape) to 1 (phone). */
export function anchorWorld(kind: AnchorKind, seat: number, narrow: number): Vec3 {
  const spot = portraitSpot(seat, narrow);
  if (kind === "plate") {
    if (seat === 2 && narrow <= 0.5) return [0, TABLE.lip + 0.6, -TABLE.rim];
    // Phones seat the side players at the far corners: their plates sit just under them.
    if (narrow > 0.5) return [spot.p[0], spot.p[1] - spot.size * 0.44, spot.p[2] + 2];
    return [Math.sign(spot.p[0]) * (TABLE.rim + 1), TABLE.lip + 0.6, spot.p[2] + 4];
  }
  // Cheers float up beside the portrait's head, on the side toward the middle of the screen.
  // On a phone the three sit in a row, so cheers rise from above each head instead.
  if (narrow > 0.5 && seat === 2) return [spot.p[0] + spot.size * 0.4, spot.p[1] + spot.size * 0.12, spot.p[2]];
  if (narrow > 0.5 && seat !== 0) return [spot.p[0] - Math.sign(spot.p[0]) * spot.size * 0.24, spot.p[1] + spot.size * 0.34, spot.p[2]];
  const up = spot.p[1] + spot.size * 0.12;
  if (seat === 2) return [spot.p[0] + spot.size * 0.42, up, spot.p[2]];
  if (seat === 0) return [TABLE.felt * 0.6, 8, TABLE.felt];
  return [spot.p[0] - Math.sign(spot.p[0]) * spot.size * 0.45, up, spot.p[2]];
}

/** The action buttons, pinned just above the viewer's hand. */
export const actionsKey = "actions";

/** Live FPS readout element (debug bar). */
export const fpsKey = "fps";
