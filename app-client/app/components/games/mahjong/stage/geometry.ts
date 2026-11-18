// Geometry of the 3D stage, in centimeters (one unit = 1 cm, so a tile is about real size).
//
// Seats: 0 is the viewer (near edge, +z), 1 sits to the viewer's right (+x), 2 across (-z), 3 to the
// left (-x): turn order runs counterclockwise, the way it does at a real table. Every seat has a local
// frame where +z points from the center toward that seat and +x is that player's right hand.

export const TILE = { w: 2.6, h: 3.45, d: 1.9 } as const;

export const TABLE = {
  /** Half-width of the felt. */
  felt: 40,
  /** Half-width of the brass rim's outer edge. */
  rim: 44.5,
  /** Height of the rim's lip above the felt. */
  lip: 1.1,
  /** Half-width of the market board plinth. */
  plinth: 10.5,
  plinthHeight: 1.3,
} as const;

/** Distances from the center, in a seat's own frame. */
export const ROWS = {
  stick: 12.1,
  pond: 13.8,
  hand: 32.5,
  meld: 34.5,
} as const;

/** Yaw that turns a tile's face toward its owner (see seatPoint for the frame). */
export const SEAT_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const;

export type Vec3 = [number, number, number];

/** A point in a seat's local frame (x to the player's right, z toward the player) in world space. */
export function seatPoint(seat: number, x: number, y: number, z: number): Vec3 {
  const yaw = SEAT_YAW[seat];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

/** A tile's pose: position and Euler angles applied yaw first, then pitch, then roll (order YXZ). */
export type Pose = { p: Vec3; pitch: number; yaw: number; roll: number; scale: number };

export const pose = (p: Vec3, pitch = 0, yaw = 0, roll = 0, scale = 1): Pose => ({ p, pitch, yaw, roll, scale });

/** Lying flat, face up and readable from its owner's side. */
export const FLAT = -Math.PI / 2;

/** How far a standing hand leans back toward its owner so the faces read from the chair. */
export const HAND_LEAN = -0.42;

/**
 * Where each opponent sits. `p` is the figure's spot on the floor plan (its height is nominal: the
 * portrait itself is placed by its eye line above the rim, see scene-portraits). `ipd` is how far apart
 * the eyes come out, which sets every talent's head to one size; art without face metrics falls back
 * to `shoulder`, the width of the bottom of its figure, capped at `maxHeight` so a head never leaves the
 * frame. `shoulder` is also the width the rim has to hide the cut across. `card` is the width of the lit
 * card a talent without half-body art gets. `size` is the nominal figure height, for pinning overlays
 * near the head. `turn` is how far the cutout turns from square to the lens toward the table's middle.
 *
 * Side players sit behind their own side of the table, out past the rim, which passes in front of
 * them on its slant and hides the lower body along one clean edge, as with someone seated behind a
 * table's edge; they turn partly toward the middle. Where they and the player across sit on a landscape
 * screen, and how big they come out, was set by eye (LANDSCAPE). A phone's frame ends at the side rims,
 * so there they move up to the far corners of their own side, still turned toward the middle, and the
 * one across moves back.
 */
export type PortraitSpot = { p: Vec3; ipd: number; shoulder: number; maxHeight: number; card: number; size: number; turn: number };

/** Where a side player sits on a landscape screen: out from the middle (the rim is at 44.5) and along their side (their hand is centered on 0). */

/**
 * The opponents on a landscape screen, set by eye. Sides: where they sit (sideX out from the middle,
 * the rim being at 44.5; sideZ along their side, their hand centered on 0), how far they turn from the
 * lens toward the middle, their head size (eye distance), and their lean back and tip of the top toward
 * the table in degrees (negative lean tips the top toward the viewer). Across: how far back they sit,
 * head size and lean back. A phone uses its own framing, eased into from these (portraitSpot,
 * scene-portraits).
 */
export const LANDSCAPE = { sideX: 57.5, sideZ: -16, sideTurn: 0.62, sideTilt: -11, sideRoll: 1.5, sideSize: 8.7, acrossZ: -75, acrossSize: 8.5, acrossTilt: 5.5 } as const;

export function portraitSpot(seat: number, narrow: number): PortraitSpot {
  const lerp = (a: number, b: number) => a + (b - a) * narrow;
  if (seat === 2) return { p: [0, lerp(-1.2, -5), lerp(LANDSCAPE.acrossZ, -60)], ipd: lerp(LANDSCAPE.acrossSize, 4.4), shoulder: lerp(27, 20), maxHeight: lerp(40, 30), card: lerp(13, 10), size: lerp(30, 22), turn: 0 };
  // From their side (landscape) to their far corner (phone) along an arc, pushed out so that in between
  // they stay clear of the rim. The swing leads the rest of the move.
  const side = seat === 1 ? 1 : -1;
  const swing = Math.min(1, narrow * 1.35);
  const angle = Math.atan2(LANDSCAPE.sideZ, LANDSCAPE.sideX) + (Math.atan2(-51, 38) - Math.atan2(LANDSCAPE.sideZ, LANDSCAPE.sideX)) * swing;
  const radius = Math.hypot(LANDSCAPE.sideX, LANDSCAPE.sideZ) + (Math.hypot(38, 51) - Math.hypot(LANDSCAPE.sideX, LANDSCAPE.sideZ)) * swing;
  let x = Math.cos(angle) * radius;
  let z = Math.sin(angle) * radius;
  const out = (LANDSCAPE.sideX + (50 - LANDSCAPE.sideX) * swing) / Math.max(Math.abs(x), Math.abs(z));
  if (out > 1) {
    x *= out;
    z *= out;
  }
  return { p: [side * x, lerp(-1.2, -6), z], ipd: lerp(LANDSCAPE.sideSize, 4.2), shoulder: lerp(28, 20), maxHeight: lerp(42, 28), card: lerp(13, 10), size: lerp(30, 21), turn: LANDSCAPE.sideTurn + (0.3 - LANDSCAPE.sideTurn) * swing };
}

/**
 * The yaw that turns a cutout at (x, z) to a lens at (cx, cz), then `turn` of the rest of the way
 * toward the table's middle.
 */
export function portraitYaw(cx: number, cz: number, x: number, z: number, turn: number): number {
  const lens = Math.atan2(cx - x, cz - z);
  const middle = Math.atan2(-x, -z);
  let diff = middle - lens;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return lens + diff * turn;
}

/** Where the camera leans on an opponent's big moment: their chest, so the push-in keeps the table in view. */
export function portraitFocus(seat: number, narrow: number): Vec3 {
  const spot = portraitSpot(seat, narrow);
  return [spot.p[0], spot.p[1] + spot.size * 0.35, spot.p[2]];
}
