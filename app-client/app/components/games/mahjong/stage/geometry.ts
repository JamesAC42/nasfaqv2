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

/** Where each opponent's portrait sits and how big it is. Side seats tuck in on narrow screens. */
export function portraitSpot(seat: number, narrow: number): { p: Vec3; size: number } {
  const lerp = (a: number, b: number) => a + (b - a) * narrow;
  // On a phone the side players move up to the far corners, so all three line up across the top.
  if (seat === 2) return { p: [0, lerp(7.5, 26), lerp(-60, -64)], size: lerp(44, 42) };
  const side = seat === 1 ? 1 : -1;
  return { p: [side * lerp(57, 27), lerp(11, 22), lerp(-12, -50)], size: lerp(40, 40) };
}
