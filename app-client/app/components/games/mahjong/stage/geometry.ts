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
 * Side players sit behind their own side of the table, level with the middle of their hand so they
 * read as sitting behind it (the frame may cut off their outer side), and just outside the rim: the
 * rim then passes in front of them on its slant, hiding the lower body along one clean edge, as with
 * someone seated behind a table's edge. They face the lens with only a slight turn toward the middle
 * (SIDE_TURN), which keeps their inner shoulder from reaching back over the rim. The
 * player across is further from the lens, so their head is set larger to come out about the same size.
 * A phone's frame ends at the side rims, so there they move up to the far corners of their own side,
 * still turned toward the middle, and the one across moves back.
 */
export type PortraitSpot = { p: Vec3; ipd: number; shoulder: number; maxHeight: number; card: number; size: number; turn: number };

/** Where a side player sits on a landscape screen: out from the middle (the rim is at 44.5) and along their side (their hand is centered on 0). */
const SIDE_X = 46;
const SIDE_Z = -8;
const SIDE_TURN = 0.4;

export function portraitSpot(seat: number, narrow: number): PortraitSpot {
  const lerp = (a: number, b: number) => a + (b - a) * narrow;
  if (seat === 2) return { p: [0, lerp(-1.2, -5), lerp(-50.5, -60)], ipd: lerp(6.8, 4.4), shoulder: lerp(27, 20), maxHeight: lerp(40, 30), card: lerp(13, 10), size: lerp(30, 22), turn: 0 };
  // From their side (landscape) to their far corner (phone) along an arc, pushed out so that in between
  // they stay clear of the rim. The swing leads the rest of the move.
  const side = seat === 1 ? 1 : -1;
  const swing = Math.min(1, narrow * 1.35);
  const angle = Math.atan2(SIDE_Z, SIDE_X) + (Math.atan2(-51, 38) - Math.atan2(SIDE_Z, SIDE_X)) * swing;
  const radius = Math.hypot(SIDE_X, SIDE_Z) + (Math.hypot(38, 51) - Math.hypot(SIDE_X, SIDE_Z)) * swing;
  let x = Math.cos(angle) * radius;
  let z = Math.sin(angle) * radius;
  const out = (SIDE_X + (50 - SIDE_X) * swing) / Math.max(Math.abs(x), Math.abs(z));
  if (out > 1) {
    x *= out;
    z *= out;
  }
  return { p: [side * x, lerp(-1.2, -6), z], ipd: lerp(5.8, 4.2), shoulder: lerp(28, 20), maxHeight: lerp(42, 28), card: lerp(13, 10), size: lerp(30, 21), turn: SIDE_TURN + (0.3 - SIDE_TURN) * swing };
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
