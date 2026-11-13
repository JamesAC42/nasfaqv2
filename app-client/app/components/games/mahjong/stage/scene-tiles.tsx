"use client";

// Every tile on the table in one instanced mesh (instance i is tile id i). A layout maps the mock state
// to a target pose per tile; whenever a target changes the tile tweens there from wherever it is, with
// an arc for long moves. So a discard, a fresh draw, a sideways riichi tile and the win reveal all fall
// out of the same mechanism.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TILES, type TileId } from "@/app/lib/games/mahjong/tiles";
import { TILE_COLORS } from "@/app/components/games/mahjong/tile-art";
import { FLAT, ROWS, SEAT_YAW, TABLE, TILE, pose, seatPoint, type Pose } from "@/app/components/games/mahjong/stage/geometry";
import { useStage } from "@/app/components/games/mahjong/stage/mock-state";
import { handAnchor, type HandAnchor } from "@/app/components/games/mahjong/stage/rig";
import { ATLAS, cellOf, tileAtlas } from "@/app/components/games/mahjong/stage/textures";

type Target = Pose & { delay?: number; glow?: number; hand?: boolean };
type Track = { cur: Pose; from: Pose; to: Target; t0: number; dur: number; arc: number; lift: number; glow: number; shown: boolean };

const clone = (p: Pose): Pose => ({ p: [...p.p], pitch: p.pitch, yaw: p.yaw, roll: p.roll, scale: p.scale });
const same = (a: Pose, b: Pose) =>
  Math.abs(a.p[0] - b.p[0]) + Math.abs(a.p[1] - b.p[1]) + Math.abs(a.p[2] - b.p[2]) < 1e-3 && Math.abs(a.pitch - b.pitch) + Math.abs(a.yaw - b.yaw) + Math.abs(a.roll - b.roll) < 1e-3 && a.scale === b.scale;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ── Layout ───────────────────────────────────────────────────────────────────
type LayoutInput = Pick<ReturnType<typeof useStage.getState>, "hands" | "wins" | "drawn" | "melds" | "ponds" | "sideways" | "dora" | "reveal">;

function layout(state: LayoutInput, anchor: HandAnchor, now: boolean): Map<TileId, Target> {
  const out = new Map<TileId, Target>();
  const { w, h, d } = TILE;

  // Your hand.
  const mine = state.hands[0];
  const revealMine = state.reveal === 0;
  const total = mine.length * anchor.spacing + (state.drawn ? 0.9 : 0);
  mine.forEach((id, i) => {
    const gap = state.drawn && i === mine.length - 1 ? 0.9 : 0;
    const x = -total / 2 + anchor.spacing * (i + 0.5) + gap;
    if (revealMine) {
      out.set(id, { ...pose([x, d / 2, ROWS.hand - 2], FLAT, 0), delay: now ? 0 : i * 0.06 });
      return;
    }
    out.set(id, { ...pose([anchor.center[0] + x, anchor.center[1], anchor.center[2]], anchor.pitch, 0), hand: true });
  });

  // Opponents' hands: standing backs, or flipped to face the table on a win.
  for (const seat of [1, 2, 3]) {
    const hand = state.reveal === seat ? [...state.hands[seat], state.wins[seat]] : state.hands[seat];
    const meldWidth = state.melds[seat].reduce((sum, meld) => sum + meld.tiles.length * w + (h - w) + 0.4, 0);
    const span = hand.length * w * 1.02;
    const shift = -meldWidth / 2;
    hand.forEach((id, i) => {
      const isWin = state.reveal === seat && i === hand.length - 1;
      const x = shift - span / 2 + w * 1.02 * (i + 0.5) + (isWin ? 0.7 : 0);
      if (state.reveal === seat) {
        out.set(id, { ...pose(seatPoint(seat, x, h / 2 + 0.25, ROWS.hand - 0.6), -0.32, SEAT_YAW[seat] + Math.PI), delay: now ? 0 : 0.35 + i * 0.07, glow: isWin ? 1 : 0 });
      } else {
        out.set(id, pose(seatPoint(seat, x, h / 2, ROWS.hand), 0, SEAT_YAW[seat]));
      }
    });
    // Called sets lie flat at the owner's right, the taken tile sideways.
    let cursor = TABLE.felt - 3;
    for (const meld of state.melds[seat]) {
      const widths = meld.tiles.map((_, i) => (i === meld.called ? h : w));
      for (let i = meld.tiles.length - 1; i >= 0; i--) {
        const width = widths[i];
        const cx = cursor - width / 2;
        cursor -= width + 0.06;
        const sideways = i === meld.called;
        out.set(meld.tiles[i], pose(seatPoint(seat, cx, d / 2, ROWS.meld + (sideways ? (h - w) / 2 : 0)), FLAT, SEAT_YAW[seat], sideways ? Math.PI / 2 : 0));
      }
      cursor -= 0.4;
    }
  }

  // Ponds: six to a row, in front of the plinth.
  state.ponds.forEach((pond, seat) => {
    let row = 0;
    let cursor = -3 * w;
    pond.forEach((id, i) => {
      if (i > 0 && i % 6 === 0 && row < 2) {
        row += 1;
        cursor = -3 * w;
      }
      const sideways = state.sideways.includes(id);
      const width = sideways ? h : w;
      const cx = cursor + width / 2;
      cursor += width + 0.06;
      const z = ROWS.pond + h / 2 + row * (h + 0.08) + (sideways ? (h - w) / 2 : 0);
      out.set(id, pose(seatPoint(seat, cx, d / 2, z), FLAT, SEAT_YAW[seat], sideways ? Math.PI / 2 : 0));
    });
  });

  // The dora rack on the plinth: the indicator face up, the rest of the dead wall face down.
  const s = 0.6;
  state.dora.forEach((id, i) => {
    const x = (i - 2) * w * s * 1.08;
    out.set(id, pose([x, TABLE.plinthHeight + 0.35 + (h * s) / 2, -TABLE.plinth + 2.4], -0.18, i === 0 ? 0 : Math.PI, 0, s));
  });
  return out;
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
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        varying float vCell;
        varying float vGlow;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vObjPos = position;
        vObjNormal = normal;
        vCell = aCell;
        vGlow = aGlow;`
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
        varying float vGlow;`
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
        // The face, from the atlas.
        float faceMask = smoothstep(0.7, 0.92, vObjNormal.z) * (1.0 - backMask);
        vec2 fuv = clamp(vObjPos.xy / (2.0 * uHalf.xy) + 0.5, 0.0, 1.0);
        float col = mod(vCell, ${ATLAS.cols}.0);
        float row = floor(vCell / ${ATLAS.cols}.0);
        vec2 auv = vec2((col + fuv.x) / ${ATLAS.cols}.0, 1.0 - (row + 1.0 - fuv.y) / ${ATLAS.rows}.0);
        vec3 face = texture2D(uAtlas, auv).rgb;
        diffuseColor.rgb *= mix(body, face, faceMask);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * uGlowColor * 0.55;`
      );
  };
  material.customProgramCacheKey = () => "stage-tile-v1";
  return material;
}

// ── Component ────────────────────────────────────────────────────────────────
export function Tiles({ day, backColor }: { day: boolean; backColor: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const geometry = useMemo(() => {
    const box = new RoundedBoxGeometry(TILE.w, TILE.h, TILE.d, 2, 0.32);
    const cells = new Float32Array(TILES);
    for (let id = 0; id < TILES; id++) cells[id] = cellOf(id);
    box.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 1));
    box.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(TILES), 1));
    return box;
  }, []);
  const atlas = useMemo(() => tileAtlas(() => invalidate()), [invalidate]);
  const material = useMemo(() => tileMaterial(atlas, backColor), [atlas, backColor]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const hands = useStage((s) => s.hands);
  const wins = useStage((s) => s.wins);
  const drawn = useStage((s) => s.drawn);
  const melds = useStage((s) => s.melds);
  const ponds = useStage((s) => s.ponds);
  const sideways = useStage((s) => s.sideways);
  const dora = useStage((s) => s.dora);
  const reveal = useStage((s) => s.reveal);
  const reduced = useStage((s) => s.reduced);
  const hoverTile = useStage((s) => s.hoverTile);
  const anchor = useMemo(() => handAnchor(aspect, width), [aspect, width]);
  const targets = useMemo(() => layout({ hands, wins, drawn, melds, ponds, sideways, dora, reveal }, anchor, reduced), [hands, wins, drawn, melds, ponds, sideways, dora, reveal, anchor, reduced]);

  const tracks = useRef(new Map<TileId, Track>());
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Retarget tiles whose destination moved.
  useEffect(() => {
    const now = performance.now() / 1000;
    for (const [id, to] of targets) {
      const track = tracks.current.get(id);
      if (!track) {
        // A new tile drops in from just above its spot.
        const start = clone(to);
        start.p = [to.p[0], to.p[1] + (tracks.current.size ? 5 : 0), to.p[2]];
        tracks.current.set(id, { cur: clone(start), from: start, to, t0: now, dur: reduced || !tracks.current.size ? 0 : 0.35, arc: 0, lift: 0, glow: 0, shown: true });
        continue;
      }
      track.shown = true;
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
      track.t0 = now + (to.delay ?? 0);
      track.dur = reduced ? 0 : Math.min(0.75, 0.26 + dist / 70 + turn * 0.08);
      track.arc = reduced ? 0 : dist > 6 ? Math.min(7, 1.5 + dist * 0.18) : turn > 1 ? 1.6 : 0;
    }
    for (const [id, track] of tracks.current) if (!targets.has(id)) track.shown = false;
    invalidate();
  }, [targets, reduced, invalidate]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const glows = mesh.geometry.getAttribute("aGlow") as THREE.InstancedBufferAttribute;
    const now = performance.now() / 1000;
    let moving = false;
    let glowDirty = false;
    for (let id = 0; id < TILES; id++) {
      const track = tracks.current.get(id);
      if (!track || !track.shown) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -50, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(id, dummy.matrix);
        continue;
      }
      const { from, to } = track;
      const raw = track.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - track.t0) / track.dur));
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
      // Hover: your tile rises a little toward you.
      const liftTarget = to.hand && hoverTile === id ? 1 : 0;
      const nextLift = reduced ? liftTarget : track.lift + (liftTarget - track.lift) * 0.25;
      if (Math.abs(nextLift - track.lift) > 1e-3) moving = true;
      track.lift = Math.abs(nextLift - liftTarget) < 1e-3 ? liftTarget : nextLift;
      const glowTarget = (to.glow ?? 0) * (0.75 + 0.25 * Math.sin(now * 4)) + track.lift * 0.35;
      if (Math.abs(glowTarget - track.glow) > 1e-3) {
        track.glow = glowTarget;
        glows.setX(id, glowTarget);
        glowDirty = true;
        if (to.glow) moving = true;
      }
      dummy.position.set(cur.p[0], cur.p[1] + track.lift * 1.1, cur.p[2] + track.lift * 0.5);
      dummy.rotation.set(cur.pitch, cur.yaw, cur.roll, "YXZ");
      dummy.scale.setScalar(cur.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(id, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (glowDirty) glows.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (moving) invalidate();
  });

  const onMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const id = event.instanceId;
    const target = id !== undefined ? targets.get(id) : undefined;
    const next = target?.hand ? (id as TileId) : null;
    if (useStage.getState().hoverTile !== next) useStage.getState().setHover(next);
    document.body.style.cursor = next !== null ? "pointer" : "";
  };
  const onOut = () => {
    if (useStage.getState().hoverTile !== null) useStage.getState().setHover(null);
    document.body.style.cursor = "";
  };
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    const id = event.instanceId;
    if (id === undefined || !targets.get(id)?.hand) return;
    event.stopPropagation();
    useStage.getState().discard(id);
    document.body.style.cursor = "";
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, TILES]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onPointerMove={onMove}
      onPointerOut={onOut}
      onClick={onClick}
      userData={{ day }}
    />
  );
}
