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
 * Where each opponent sits. `p` is the figure's anchor: the bottom middle of the cutout, just below the
 * table's edge as the camera sees it, so the cut-off waist (or chest, on a bust) stays hidden and the
 * head and shoulders rise above the rim. `shoulder` is how wide the bottom of the figure comes out,
 * which sets the scale whatever the crop (see scene-portraits); `maxHeight` caps very tall art so a head
 * never leaves the frame. `size` is the nominal figure height, for pinning overlays near the head.
 * Side players sit behind their side of the table, toward its far end so the lens takes them in; on a
 * phone they move further back so all three fit across the top.
 */
export function portraitSpot(seat: number, narrow: number): { p: Vec3; shoulder: number; maxHeight: number; size: number } {
  const lerp = (a: number, b: number) => a + (b - a) * narrow;
  if (seat === 2) return { p: [0, lerp(-3.5, -7), lerp(-50.5, -60)], shoulder: lerp(27, 20), maxHeight: lerp(40, 30), size: lerp(32, 24) };
  // Side players swing round from the middle of their side (landscape) to the far corner (phone): along
  // an arc, pushed out so that in between they stay behind the rim rather than cutting across the felt.
  const side = seat === 1 ? 1 : -1;
  const angle = lerp(Math.atan2(-19, 49), Math.atan2(-50, 25));
  const radius = lerp(Math.hypot(49, 19), Math.hypot(25, 50));
  let x = Math.cos(angle) * radius;
  let z = Math.sin(angle) * radius;
  const out = 48 / Math.max(Math.abs(x), Math.abs(z));
  if (out > 1) {
    x *= out;
    z *= out;
  }
  return { p: [side * x, lerp(-3.5, -8), z], shoulder: lerp(28, 20), maxHeight: lerp(42, 28), size: lerp(32, 22) };
}

/** Where the camera leans on an opponent's big moment: their chest, so the push-in keeps the table in view. */
export function portraitFocus(seat: number, narrow: number): Vec3 {
  const spot = portraitSpot(seat, narrow);
  return [spot.p[0], spot.p[1] + spot.size * 0.35, spot.p[2]];
}
