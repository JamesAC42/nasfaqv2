// The viewer's camera. A wide screen sits you in the chair looking down at the table at about 36°;
// a tall phone screen climbs higher and opens the lens so the whole table and all three opponents fit,
// and your own hand then floats up toward the lens so it stays big enough to read (handAnchor).

import * as THREE from "three";
import { HAND_LEAN, ROWS, TABLE, TILE, type Vec3 } from "@/app/components/games/mahjong/stage/geometry";

export type CameraPose = { position: Vec3; target: Vec3; fov: number };

/** 0 on a landscape screen, 1 on a portrait phone. */
export const narrowness = (aspect: number) => Math.min(1, Math.max(0, (1.45 - aspect) / (1.45 - 0.5)));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// A little lower and further back than straight overhead, so there is room above the far rim for the
// opponents' heads and the side players sit inside the frame.
const WIDE: CameraPose = { position: [0, 47, 79], target: [0, 3, -7], fov: 44 };
const TALL: CameraPose = { position: [0, 128, 52], target: [0, 0, -10], fov: 55 };

export function basePose(aspect: number): CameraPose {
  const t = narrowness(aspect);
  // Ease the phone end in so ordinary laptop windows stay close to the wide framing.
  const k = t * t * (3 - 2 * t);
  return { position: lerp3(WIDE.position, TALL.position, k), target: lerp3(WIDE.target, TALL.target, k), fov: lerp(WIDE.fov, TALL.fov, k) };
}

export type HandAnchor = { center: Vec3; pitch: number; spacing: number; scale: number; floating: boolean };

/** Hand width in tiles' worth of space, including the gap before a fresh draw. */
export const handWidth = (tiles: number) => tiles * TILE.w * 1.03 + 0.9;

/** On-screen tile width (px) below which the hand lifts off the table toward the lens. */
const MIN_TILE_PX = 30;

/**
 * Where the viewer's hand stands. On the table at the near edge when its tiles come out at least
 * MIN_TILE_PX wide; otherwise (phones, small windows) on the line from the lens through the bottom of
 * the frame, at the distance where the tiles are ~46 px (at most 94% of the width), square to the lens.
 */
export function handAnchor(aspect: number, widthPx: number): HandAnchor {
  const pose = basePose(aspect);
  const cam = new THREE.Vector3(...pose.position);
  const forward = new THREE.Vector3(...pose.target).sub(cam).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(pose.fov / 2));
  const tanH = tanV * aspect;
  const width = handWidth(14);
  const lean = HAND_LEAN;
  const tableCenter = new THREE.Vector3(0, (TILE.h / 2) * Math.cos(lean) + (TILE.d / 2) * Math.sin(-lean), ROWS.hand);
  const tableDistance = tableCenter.clone().sub(cam).dot(forward);
  const tablePx = (TILE.w / (2 * tableDistance * tanH)) * widthPx;
  if (tablePx >= MIN_TILE_PX) return { center: tableCenter.toArray() as Vec3, pitch: lean, spacing: TILE.w * 1.03, scale: 1, floating: false };
  const share = Math.min(0.94, (14 * 46) / Math.max(1, widthPx));
  const fit = width / (share * 2 * tanH);
  const ndcY = -0.72 - 0.1 * narrowness(aspect);
  const center = cam.clone().addScaledVector(forward, fit).addScaledVector(up, ndcY * tanV * fit);
  const pitch = -Math.asin(Math.min(1, Math.max(-1, -forward.y)));
  return { center: center.toArray() as Vec3, pitch, spacing: TILE.w * 1.03, scale: 1, floating: true };
}

/**
 * How high a point behind the table can be and still be hidden by the rim from the resting camera:
 * on the sightline from the lens over the rim's outer top edge, where that line leaves the table on
 * its way to the point. A portrait's crop line goes a little under it, so the cut never shows.
 */
export function hiddenBelow(aspect: number, x: number, z: number): number {
  const [cx, cy, cz] = basePose(aspect).position;
  const dx = x - cx;
  const dz = z - cz;
  // Where the segment from the lens to the point leaves the rim's outer square (slab method).
  let exit = Infinity;
  for (const [from, d] of [
    [cx, dx],
    [cz, dz],
  ]) {
    if (Math.abs(d) < 1e-6) continue;
    const t = Math.max((TABLE.rim - from) / d, (-TABLE.rim - from) / d);
    exit = Math.min(exit, t);
  }
  if (!Number.isFinite(exit) || exit <= 0 || exit >= 1) return -2;
  return cy + (TABLE.lip - cy) / exit;
}

/** How high a point at (x, z) can be and still be inside the top of the resting camera's frame. */
export function frameTop(aspect: number, x: number, z: number): number {
  const pose = basePose(aspect);
  const cam = new THREE.Vector3(...pose.position);
  const forward = new THREE.Vector3(...pose.target).sub(cam).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const half = THREE.MathUtils.degToRad(pose.fov / 2);
  // The top plane of the frustum, by its outward normal: the point sits on it where the dot is zero.
  const normal = up.multiplyScalar(Math.cos(half)).addScaledVector(forward, -Math.sin(half));
  return cam.y - (normal.x * (x - cam.x) + normal.z * (z - cam.z)) / normal.y;
}

/**
 * The rim's line across a figure standing at (x, z), square to the lens and `half` wide each way:
 * `center` where it crosses the middle (what the figure shows above the table is measured from here)
 * and `low` its lowest point, which a straight cut has to stay under to be hidden all the way across.
 */
export function rimLine(aspect: number, x: number, z: number, half: number): { center: number; low: number } {
  const [cx, , cz] = basePose(aspect).position;
  const length = Math.hypot(cx - x, cz - z) || 1;
  const rx = (cz - z) / length;
  const rz = -(cx - x) / length;
  let low = Infinity;
  for (const k of [-1, -0.5, 0, 0.5, 1]) low = Math.min(low, hiddenBelow(aspect, x + rx * half * k, z + rz * half * k));
  return { center: hiddenBelow(aspect, x, z), low };
}
