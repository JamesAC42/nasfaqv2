"use client";

// Every tile on the table in one instanced mesh. A layout maps the stage model to a target pose per
// tile, keyed by what the tile is: "t<id>" for a tile the viewer may see (its face comes from the id),
// "h<seat>-<n>" for the backs of a hidden hand, "d<n>" for the face-down dead wall. Keys get instance
// slots as they appear; whenever a key's target changes the tile tweens there from wherever it is, with
// an arc for long moves, and a key that appears flies in from where it came from (the wall for a draw,
// the hand for a discard or a call). So a discard, a fresh draw, a call, a sideways riichi tile and the
// reveal at the end all fall out of the same mechanism. A hidden tile has no id to draw: its face is
// blank, and its key says nothing about which tile it is.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { TileId } from "@/app/lib/games/mahjong/tiles";
import { TILE_COLORS } from "@/app/components/games/mahjong/tile-art";
import { FLAT, ROWS, SEAT_YAW, TABLE, TILE, pose, seatPoint, type Pose } from "@/app/components/games/mahjong/stage/geometry";
import { useStageStore, type StageMeld, type StageModel } from "@/app/components/games/mahjong/stage/model";
import { handKey, overlayEls } from "@/app/components/games/mahjong/stage/overlay";
import { handAnchor, type HandAnchor } from "@/app/components/games/mahjong/stage/rig";
import { ATLAS, cellOf, tileAtlas } from "@/app/components/games/mahjong/stage/textures";

type Zone = "hand" | "hidden" | "pond" | "meld" | "reveal" | "dora";
type Target = Pose & { cell: number; zone: Zone; seat: number; delay?: number; glow?: number; mine?: TileId };
type Track = { slot: number; cur: Pose; from: Pose; to: Target; t0: number; dur: number; arc: number; lift: number; glow: number; dim: number };

/** Instance slots: every visible tile (136), four hidden hands and the dead wall, with room to spare. */
const CAPACITY = 200;
/** A blank face (hidden tiles): the shader draws no atlas cell for it. */
const BLANK = -1;

const clone = (p: Pose): Pose => ({ p: [...p.p], pitch: p.pitch, yaw: p.yaw, roll: p.roll, scale: p.scale });
const same = (a: Pose, b: Pose) =>
  Math.abs(a.p[0] - b.p[0]) + Math.abs(a.p[1] - b.p[1]) + Math.abs(a.p[2] - b.p[2]) < 1e-3 && Math.abs(a.pitch - b.pitch) + Math.abs(a.yaw - b.yaw) + Math.abs(a.roll - b.roll) < 1e-3 && a.scale === b.scale;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ── The wall ─────────────────────────────────────────────────────────────────
/** Stacks per side, two tiles high, as at a real table. */
const WALL_STACKS = 17;
/**
 * Distance of each wall's middle from the center: right up against the hand, so from your chair the
 * wall in front of you stays clear of your third row of discards.
 */
const WALL_ROW = ROWS.hand - TILE.d / 2 - 0.5 - TILE.h / 2;
const wallStacks = (tiles: number) => Math.min(WALL_STACKS * 4, Math.ceil(Math.max(0, tiles) / 2));
/** Where stack `index` stands (stacks fill your wall first, then right, across and left). */
function wallStack(index: number, layer: number): Pose {
  const seat = Math.floor(index / WALL_STACKS) % 4;
  const x = ((index % WALL_STACKS) - (WALL_STACKS - 1) / 2) * (TILE.w + 0.05);
  const [px, , pz] = seatPoint(seat, x, 0, WALL_ROW);
  return pose([px, TILE.d / 2 + layer * (TILE.d + 0.02), pz], -FLAT, SEAT_YAW[seat]);
}

// ── Layout ───────────────────────────────────────────────────────────────────
const meldSpan = (melds: StageMeld[]) => melds.reduce((sum, meld) => sum + meld.tiles.length * TILE.w + (meld.called >= 0 ? TILE.h - TILE.w : 0) + 0.4, 0);

function layout(model: StageModel, anchor: HandAnchor): Map<string, Target> {
  const out = new Map<string, Target>();
  const { w, h, d } = TILE;
  const put = (key: string, target: Target) => {
    if (!out.has(key)) out.set(key, target);
  };
  const face = (id: TileId) => cellOf(id);

  // ── Your hand (or the bottom seat's) ──
  const mine = model.hands[0];
  const meldsMine = meldSpan(model.melds[0]);
  if (mine.tiles && !mine.revealed) {
    const tiles = mine.tiles;
    const total = tiles.length * anchor.spacing + (mine.drawn ? 0.9 : 0);
    // On the table the hand steps left to clear your called sets at the right-hand corner.
    let shift = 0;
    if (!anchor.floating && meldsMine > 0) shift = Math.min(0, TABLE.felt - 4 - meldsMine - total / 2);
    tiles.forEach((id, i) => {
      const gap = mine.drawn && i === tiles.length - 1 ? 0.9 : 0;
      const x = -total / 2 + anchor.spacing * (i + 0.5) + gap + shift;
      put(`t${id}`, { ...pose([anchor.center[0] + x, anchor.center[1], anchor.center[2]], anchor.pitch, 0), cell: face(id), zone: "hand", seat: 0, mine: id });
    });
  } else if (mine.tiles) {
    const tiles = mine.tiles;
    const total = tiles.length * w * 1.02 + (mine.win !== null ? 0.7 : 0);
    tiles.forEach((id, i) => {
      const isWin = id === mine.win;
      const x = -total / 2 + w * 1.02 * (i + 0.5) + (isWin ? 0.7 : 0) - meldsMine / 2;
      put(`t${id}`, { ...pose([x, d / 2, ROWS.hand + 0.6], FLAT, 0), cell: face(id), zone: "reveal", seat: 0, delay: i * 0.05, glow: isWin ? 0.8 : 0 });
    });
  } else {
    // A spectator's bottom seat: standing backs, turned to the lens.
    const n = Math.min(14, mine.count);
    const span = n * w * 1.02 + (mine.drawn ? 0.7 : 0);
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + w * 1.02 * (i + 0.5) + (mine.drawn && i === n - 1 ? 0.7 : 0) - meldsMine / 2;
      put(`h0-${i}`, { ...pose(seatPoint(0, x, h / 2, ROWS.hand), 0, SEAT_YAW[0] + Math.PI), cell: BLANK, zone: "hidden", seat: 0 });
    }
  }

  // ── Opponents' hands: standing backs, or turned to face the table when shown ──
  for (const seat of [1, 2, 3]) {
    const hand = model.hands[seat];
    const shift = -meldSpan(model.melds[seat]) / 2;
    if (hand.tiles) {
      const tiles = hand.tiles;
      const span = tiles.length * w * 1.02 + (hand.win !== null ? 0.7 : 0);
      tiles.forEach((id, i) => {
        const isWin = id === hand.win;
        const x = shift - span / 2 + w * 1.02 * (i + 0.5) + (isWin ? 0.7 : 0);
        put(`t${id}`, { ...pose(seatPoint(seat, x, h / 2 + 0.25, ROWS.hand + 0.2), -0.32, SEAT_YAW[seat] + Math.PI), cell: face(id), zone: "reveal", seat, delay: 0.35 + i * 0.06, glow: isWin ? 0.8 : 0 });
      });
    } else {
      const n = Math.min(14, hand.count);
      const span = n * w * 1.02 + (hand.drawn ? 0.7 : 0);
      for (let i = 0; i < n; i++) {
        const x = shift - span / 2 + w * 1.02 * (i + 0.5) + (hand.drawn && i === n - 1 ? 0.7 : 0);
        put(`h${seat}-${i}`, { ...pose(seatPoint(seat, x, h / 2, ROWS.hand), 0, SEAT_YAW[seat]), cell: BLANK, zone: "hidden", seat });
      }
    }
  }

  // ── Called sets: flat at the owner's right, the taken tile sideways (a kakan's added tile beside it) ──
  model.melds.forEach((melds, seat) => {
    let cursor = TABLE.felt - 3;
    for (const meld of melds) {
      for (let i = meld.tiles.length - 1; i >= 0; i--) {
        const sideways = i === meld.called;
        const width = sideways ? h : w;
        const cx = cursor - width / 2;
        cursor -= width + 0.06;
        const id = meld.tiles[i];
        const down = meld.closed && (i === 0 || i === meld.tiles.length - 1);
        const z = ROWS.meld + (sideways ? (h - w) / 2 : 0);
        put(`t${id}`, { ...pose(seatPoint(seat, cx, d / 2, z), down ? -FLAT : FLAT, SEAT_YAW[seat], sideways ? Math.PI / 2 : 0), cell: face(id), zone: "meld", seat });
        if (sideways && meld.added !== null) {
          put(`t${meld.added}`, { ...pose(seatPoint(seat, cx, d / 2, z - w - 0.06), FLAT, SEAT_YAW[seat], Math.PI / 2), cell: face(meld.added), zone: "meld", seat });
        }
      }
      cursor -= 0.4;
    }
  });

  // ── Ponds: six to a row, in front of the plinth ──
  model.ponds.forEach((pond, seat) => {
    let row = 0;
    let cursor = -3 * w;
    pond.forEach((tile, i) => {
      if (i > 0 && i % 6 === 0 && row < 2) {
        row += 1;
        cursor = -3 * w;
      }
      const width = tile.sideways ? h : w;
      const cx = cursor + width / 2;
      cursor += width + 0.06;
      const z = ROWS.pond + h / 2 + row * (h + 0.08) + (tile.sideways ? (h - w) / 2 : 0);
      put(`t${tile.id}`, { ...pose(seatPoint(seat, cx, d / 2, z), FLAT, SEAT_YAW[seat], tile.sideways ? Math.PI / 2 : 0), cell: face(tile.id), zone: "pond", seat, glow: tile.id === model.last ? 0.3 : 0 });
    });
  });

  // ── The dora rack on the plinth: indicators face up, the rest of its five face down ──
  const s = 0.6;
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * w * s * 1.08;
    const p = pose([x, TABLE.plinthHeight + 0.35 + (h * s) / 2, -TABLE.plinth + 2.4], -0.18, 0, 0, s);
    const id = model.dora[i];
    if (id !== undefined) put(`t${id}`, { ...p, cell: face(id), zone: "dora", seat: 0 });
    else put(`d${i}`, { ...p, yaw: Math.PI, cell: BLANK, zone: "dora", seat: 0 });
  }
  return out;
}

/** Where a tile that has just appeared comes from. */
function spawnPose(target: Target, model: StageModel, anchor: HandAnchor): Pose {
  const { w, h } = TILE;
  const handEnd = (seat: number): Pose => {
    if (seat === 0 && model.hands[0].tiles && !model.hands[0].revealed) {
      const span = model.hands[0].tiles.length * anchor.spacing;
      return pose([anchor.center[0] + span / 2, anchor.center[1], anchor.center[2]], anchor.pitch, 0);
    }
    const span = Math.min(14, model.hands[seat].count) * w * 1.02;
    return pose(seatPoint(seat, span / 2, h / 2, ROWS.hand), 0, SEAT_YAW[seat]);
  };
  switch (target.zone) {
    case "hand":
    case "hidden":
      // Off the head of the wall: the stack just taken.
      return wallStack(Math.min(WALL_STACKS * 4 - 1, wallStacks(model.wall)), 1);
    case "pond":
    case "meld":
      return handEnd(target.seat);
    case "reveal": {
      // Stood up where the hand was, then laid down.
      const start = clone(target);
      start.pitch = 0;
      start.yaw = target.seat === 0 ? Math.PI : SEAT_YAW[target.seat];
      return start;
    }
    case "dora":
      return { ...clone(target), yaw: target.yaw + Math.PI };
  }
}

// ── Material ─────────────────────────────────────────────────────────────────
function tileMaterial(atlas: THREE.Texture, back: string) {
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.38, metalness: 0 });
  const uniforms = {
    uAtlas: { value: atlas },
    uIvory: { value: new THREE.Color(TILE_COLORS.ivory) },
    uBack: { value: new THREE.Color(back) },
    uHalf: { value: new THREE.Vector3(TILE.w / 2, TILE.h / 2, TILE.d / 2) },
    uGlowColor: { value: new THREE.Color("#ffd27a") },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aCell;
        attribute float aGlow;
        attribute float aDim;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        varying float vCell;
        varying float vGlow;
        varying float vDim;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vObjPos = position;
        vObjNormal = normal;
        vCell = aCell;
        vGlow = aGlow;
        vDim = aDim;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uAtlas;
        uniform vec3 uIvory;
        uniform vec3 uBack;
        uniform vec3 uHalf;
        uniform vec3 uGlowColor;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        varying float vCell;
        varying float vGlow;
        varying float vDim;`
      )
      .replace(
        "#include <map_fragment>",
        `
        // Two-tone body: an ivory front over a colored back layer about a third of the depth.
        float split = -uHalf.z * 0.3;
        float backMask = 1.0 - smoothstep(split - 0.03, split + 0.03, vObjPos.z);
        vec3 body = mix(uIvory, uBack, backMask);
        // A thin dark seam where the layers meet.
        body *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.05, abs(vObjPos.z - split)));
        // The cell index arrives as an interpolated varying, which is not exactly an integer on every
        // fragment (24.0 can arrive as 23.99998). Unrounded, floor() then puts stray fragments of a
        // tile whose cell starts an atlas row (9m, 8p, 7s, green dragon) into the wrong row: speckled
        // faces. A negative cell is a hidden tile: a blank ivory face.
        float cell = floor(vCell + 0.5);
        // The face, from the atlas.
        float faceMask = smoothstep(0.7, 0.92, vObjNormal.z) * (1.0 - backMask) * step(-0.5, cell);
        // Half a texel in from the cell's edge, so filtering never reaches the neighboring face.
        vec2 inset = vec2(0.5 / ${ATLAS.cellW}.0, 0.5 / ${ATLAS.cellH}.0);
        vec2 fuv = clamp(vObjPos.xy / (2.0 * uHalf.xy) + 0.5, inset, 1.0 - inset);
        float safeCell = max(cell, 0.0);
        float col = mod(safeCell, ${ATLAS.cols}.0);
        float row = floor(safeCell / ${ATLAS.cols}.0);
        vec2 auv = vec2((col + fuv.x) / ${ATLAS.cols}.0, 1.0 - (row + 1.0 - fuv.y) / ${ATLAS.rows}.0);
        vec3 face = texture2D(uAtlas, auv).rgb;
        diffuseColor.rgb *= mix(body, face, faceMask) * (1.0 - 0.42 * vDim);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * uGlowColor * 0.55;`
      );
  };
  material.customProgramCacheKey = () => "stage-tile-v3";
  return material;
}

function tileGeometry(count: number) {
  const box = new RoundedBoxGeometry(TILE.w, TILE.h, TILE.d, 2, 0.32);
  box.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(count).fill(BLANK), 1));
  box.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  box.setAttribute("aDim", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return box;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * One frame of the tiles: tween every track toward its target, lift and light your tiles, and pin
 * your tiles' buttons over them. Returns whether anything is still moving (so another frame is due).
 */
function stepTiles(mesh: THREE.InstancedMesh, tracks: Map<string, Track>, reduced: boolean, camera: THREE.Camera, size: { width: number; height: number }, dummy: THREE.Object3D, corner: THREE.Vector3): boolean {
  const glows = mesh.geometry.getAttribute("aGlow") as THREE.InstancedBufferAttribute;
  const dims = mesh.geometry.getAttribute("aDim") as THREE.InstancedBufferAttribute;
  const { hover, selected, dim, glow: lit } = useStageStore.getState().ui;
  const now = performance.now() / 1000;
  const { width: sw, height: sh } = size;
  let moving = false;
  let glowDirty = false;
  for (const [, track] of tracks) {
    const { from, to } = track;
    const raw = track.dur <= 0 ? (now >= track.t0 ? 1 : 0) : Math.min(1, Math.max(0, (now - track.t0) / track.dur));
    if (raw < 1) moving = true;
    const t = ease(raw);
    const cur = track.cur;
    cur.p[0] = from.p[0] + (to.p[0] - from.p[0]) * t;
    cur.p[1] = from.p[1] + (to.p[1] - from.p[1]) * t + Math.sin(Math.PI * t) * track.arc;
    cur.p[2] = from.p[2] + (to.p[2] - from.p[2]) * t;
    cur.pitch = from.pitch + (to.pitch - from.pitch) * t;
    cur.yaw = from.yaw + (to.yaw - from.yaw) * t;
    cur.roll = from.roll + (to.roll - from.roll) * t;
    cur.scale = from.scale + (to.scale - from.scale) * t;
    // Your tiles: the pointed-at one rises a little toward you, the lifted one more.
    const id = to.mine;
    const liftTarget = id === undefined ? 0 : selected === id ? 1.5 : hover === id ? 0.6 : 0;
    const nextLift = reduced ? liftTarget : track.lift + (liftTarget - track.lift) * 0.3;
    track.lift = Math.abs(nextLift - liftTarget) < 1e-3 ? liftTarget : nextLift;
    if (track.lift !== liftTarget) moving = true;
    const glowTarget = (to.glow ?? 0) + track.lift * 0.08 + (id !== undefined && lit?.has(id) ? 0.45 : 0);
    if (Math.abs(glowTarget - track.glow) > 1e-3) {
      track.glow = glowTarget;
      glows.setX(track.slot, glowTarget);
      glowDirty = true;
    }
    const dimTarget = id !== undefined && dim?.has(id) ? 1 : 0;
    if (dimTarget !== track.dim) {
      track.dim = dimTarget;
      dims.setX(track.slot, dimTarget);
      dims.needsUpdate = true;
    }
    dummy.position.set(cur.p[0], cur.p[1] + track.lift * 1.1, cur.p[2] + track.lift * 0.35);
    dummy.rotation.set(cur.pitch, cur.yaw, cur.roll, "YXZ");
    dummy.scale.setScalar(cur.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(track.slot, dummy.matrix);

    // Pin your tile's button over it: the screen box of the tile's face.
    if (id !== undefined) {
      const el = overlayEls.get(handKey(id));
      if (el) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const [cx, cy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          corner.set((cx * TILE.w) / 2, (cy * TILE.h) / 2, TILE.d / 2).applyMatrix4(dummy.matrix).project(camera);
          const px = ((corner.x + 1) / 2) * sw;
          const py = ((1 - corner.y) / 2) * sh;
          x0 = Math.min(x0, px);
          x1 = Math.max(x1, px);
          y0 = Math.min(y0, py);
          y1 = Math.max(y1, py);
        }
        el.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
        el.style.width = `${(x1 - x0).toFixed(1)}px`;
        el.style.height = `${(y1 - y0).toFixed(1)}px`;
        el.style.visibility = "visible";
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (glowDirty) glows.needsUpdate = true;
  return moving;
}

// ── Component ────────────────────────────────────────────────────────────────
export function Tiles({ backColor }: { backColor: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const geometry = useMemo(() => tileGeometry(CAPACITY), []);
  const atlas = useMemo(() => tileAtlas(() => invalidate()), [invalidate]);
  const material = useMemo(() => tileMaterial(atlas, backColor), [atlas, backColor]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const model = useStageStore((s) => s.model);
  const reduced = useStageStore((s) => s.ui.reduced);
  const anchor = useMemo(() => handAnchor(aspect, width), [aspect, width]);
  const targets = useMemo(() => layout(model, anchor), [model, anchor]);

  const tracks = useRef(new Map<string, Track>());
  const free = useRef<number[]>(Array.from({ length: CAPACITY }, (_, i) => CAPACITY - 1 - i));
  const handOf = useRef("");
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Every slot starts empty.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let slot = 0; slot < CAPACITY; slot++) mesh.setMatrixAt(slot, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Retarget tiles whose destination moved; give new keys a slot, free the ones that left.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const cells = mesh.geometry.getAttribute("aCell") as THREE.InstancedBufferAttribute;
    const glows = mesh.geometry.getAttribute("aGlow") as THREE.InstancedBufferAttribute;
    const dims = mesh.geometry.getAttribute("aDim") as THREE.InstancedBufferAttribute;
    const now = performance.now() / 1000;
    // A new hand (or the first state) puts everything in place without flying.
    const settle = handOf.current !== model.key;
    handOf.current = model.key;
    const release = (key: string, track: Track) => {
      mesh.setMatrixAt(track.slot, HIDDEN);
      free.current.push(track.slot);
      tracks.current.delete(key);
    };
    for (const [key, track] of tracks.current) if (!targets.has(key)) release(key, track);
    for (const [key, to] of targets) {
      const track = tracks.current.get(key);
      if (!track) {
        const slot = free.current.pop();
        if (slot === undefined) continue;
        cells.setX(slot, to.cell);
        glows.setX(slot, 0);
        dims.setX(slot, 0);
        cells.needsUpdate = glows.needsUpdate = dims.needsUpdate = true;
        const start = settle || reduced ? clone(to) : spawnPose(to, model, anchor);
        tracks.current.set(key, { slot, cur: clone(start), from: start, to, t0: now + (settle ? 0 : (to.delay ?? 0)), dur: settle || reduced ? 0 : 0.45, arc: settle || reduced ? 0 : 2.5, lift: 0, glow: 0, dim: 0 });
        continue;
      }
      if (same(track.to, to)) {
        track.to = to;
        continue;
      }
      const dx = to.p[0] - track.cur.p[0];
      const dz = to.p[2] - track.cur.p[2];
      const dist = Math.hypot(dx, dz);
      const turn = Math.abs(to.yaw - track.cur.yaw) + Math.abs(to.pitch - track.cur.pitch);
      track.from = clone(track.cur);
      track.to = to;
      track.t0 = now + (settle ? 0 : (to.delay ?? 0));
      track.dur = reduced || settle ? 0 : Math.min(0.75, 0.26 + dist / 70 + turn * 0.08);
      track.arc = reduced || settle ? 0 : dist > 6 ? Math.min(7, 1.5 + dist * 0.18) : turn > 1 ? 1.6 : 0;
    }
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [targets, model, anchor, reduced, invalidate]);

  const corner = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const mesh = meshRef.current;
    if (mesh && stepTiles(mesh, tracks.current, reduced, state.camera, state.size, dummy, corner)) invalidate();
  });

  return (
    <>
      <instancedMesh ref={meshRef} args={[geometry, material, CAPACITY]} castShadow receiveShadow frustumCulled={false} raycast={() => null} />
      <Wall material={material} />
    </>
  );
}

/**
 * The live wall, face down in front of each hand. It holds no tile ids: it simply has as many stacks
 * as there are tiles left to draw, so it shortens as the hand goes on. Stacks are taken from the far
 * side first, so the walls in front of you and to your right are the last to go.
 */
function Wall({ material }: { material: THREE.Material }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const remaining = useStageStore((s) => s.model.wall);
  const count = WALL_STACKS * 4 * 2;
  const geometry = useMemo(() => tileGeometry(count), [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const stacks = wallStacks(remaining);
    let i = 0;
    for (let stack = 0; stack < WALL_STACKS * 4; stack++) {
      for (let layer = 0; layer < 2; layer++) {
        if (stack < stacks) {
          const at = wallStack(stack, layer);
          dummy.position.set(...at.p);
          dummy.rotation.set(at.pitch, at.yaw, 0, "YXZ");
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i++, dummy.matrix);
        } else mesh.setMatrixAt(i++, HIDDEN);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
    // A new material (day/night back color) rebuilds the mesh, so its stacks are placed again too.
  }, [remaining, material, invalidate]);

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} castShadow receiveShadow raycast={() => null} />;
}
