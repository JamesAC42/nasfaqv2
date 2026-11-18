"use client";

// The table: felt with a chart-paper grid, a brushed-brass rim on a dark wood body, and the low glowing
// market board in the middle (round, sticks, the dora rack's base and one live points chart per seat).
// Also the riichi sticks and the ring of light that pulses when one lands.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ROWS, TABLE, seatPoint, SEAT_YAW } from "@/app/components/games/mahjong/stage/geometry";
import { useStageStore, type StageSeat } from "@/app/components/games/mahjong/stage/model";
import { brushedTexture, feltTexture, radialTexture } from "@/app/components/games/mahjong/stage/textures";

function roundedSquare<T extends THREE.Path>(half: number, radius: number, shape: T): T {
  const r = radius;
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  return shape;
}

function TableBody({ day }: { day: boolean }) {
  const felt = useMemo(() => feltTexture(day), [day]);
  const brushed = useMemo(() => brushedTexture(), []);
  const feltGeometry = useMemo(() => {
    const geometry = new THREE.ShapeGeometry(roundedSquare(TABLE.felt + 0.5, 4.5, new THREE.Shape()), 12);
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / (2 * TABLE.felt) + 0.5, position.getY(i) / (2 * TABLE.felt) + 0.5);
    return geometry;
  }, []);
  const rimGeometry = useMemo(() => {
    const shape = roundedSquare(TABLE.rim, 8, new THREE.Shape());
    shape.holes.push(roundedSquare(TABLE.felt, 4.5, new THREE.Path()));
    return new THREE.ExtrudeGeometry(shape, { depth: TABLE.lip + 0.4, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.6, bevelSegments: 4, curveSegments: 16 });
  }, []);
  const apronGeometry = useMemo(() => new THREE.ExtrudeGeometry(roundedSquare(TABLE.rim - 0.4, 7.6, new THREE.Shape()), { depth: 7, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 2, curveSegments: 16 }), []);
  useEffect(() => () => felt.dispose(), [felt]);
  useEffect(
    () => () => {
      brushed.dispose();
      feltGeometry.dispose();
      rimGeometry.dispose();
      apronGeometry.dispose();
    },
    [brushed, feltGeometry, rimGeometry, apronGeometry],
  );

  return (
    <group>
      <mesh geometry={feltGeometry} rotation-x={-Math.PI / 2} receiveShadow>
        <meshStandardMaterial map={felt} roughness={0.97} metalness={0} />
      </mesh>
      <mesh geometry={rimGeometry} rotation-x={-Math.PI / 2} position-y={-0.4} castShadow receiveShadow>
        <meshStandardMaterial color={day ? "#c79c5a" : "#b48a4f"} metalness={0.92} roughness={0.34} roughnessMap={brushed} envMapIntensity={day ? 1 : 1.4} />
      </mesh>
      <mesh geometry={apronGeometry} rotation-x={-Math.PI / 2} position-y={-7.8} receiveShadow>
        <meshStandardMaterial color={day ? "#8a6340" : "#2a1a12"} roughness={0.6} metalness={0.05} />
      </mesh>
    </group>
  );
}

// ── Market board ─────────────────────────────────────────────────────────────
const BOARD = 1024;

type BoardData = { day: boolean; seats: StageSeat[]; round: { label: string; honba: number; sticks: number }; left: number; chartAt: number; font: string };

const shortName = (name: string) => (name.length > 11 ? `${name.slice(0, 10)}…` : name).toUpperCase();

function drawBoard(ctx: CanvasRenderingContext2D, opts: BoardData) {
  const { day, seats, round, left, chartAt, font } = opts;
  const history = seats.map((seat) => seat.history);
  const sticks = round.sticks;
  ctx.clearRect(0, 0, BOARD, BOARD);
  const bg = ctx.createLinearGradient(0, 0, 0, BOARD);
  bg.addColorStop(0, day ? "#1d2740" : "#0b1426");
  bg.addColorStop(1, day ? "#141c30" : "#070d1a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, BOARD, BOARD);
  // Fine grid.
  ctx.strokeStyle = "rgba(120,170,255,0.07)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    const at = (i / 16) * BOARD;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, BOARD);
    ctx.moveTo(0, at);
    ctx.lineTo(BOARD, at);
    ctx.stroke();
  }
  // Round and sticks, under the dora rack at the far edge.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#eef3ff";
  ctx.font = `700 64px ${font}`;
  ctx.fillText(round.label.toUpperCase(), BOARD / 2 - 150, 268);
  ctx.font = `600 40px ${font}`;
  ctx.fillStyle = "rgba(220,230,255,0.72)";
  ctx.textAlign = "left";
  ctx.fillText(`${round.honba} HONBA`, BOARD / 2 + 10, 262);
  ctx.textAlign = "right";
  ctx.fillText(`${left} LEFT`, BOARD - 40, 262);
  ctx.textAlign = "left";
  // Riichi sticks on the table, drawn as little bars.
  for (let i = 0; i < Math.min(8, Math.max(1, sticks)); i++) {
    ctx.fillStyle = i < sticks ? "#f4efe2" : "rgba(255,255,255,0.14)";
    ctx.fillRect(BOARD / 2 + 230 + i * 28, 236, 14, 34);
  }
  // One strip per seat: wind, name, the points line over the hands so far, points.
  const all = history.flat();
  const lo = Math.min(...all) - 1500;
  const hi = Math.max(...all) + 1500;
  for (let seat = 0; seat < 4; seat++) {
    const x = 36;
    const y = 304 + seat * 172;
    const w = BOARD - 72;
    const h = 150;
    const color = seats[seat].color;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 10, h);
    ctx.fillRect(x + 28, y + 40, 70, 70);
    ctx.fillStyle = "#05070c";
    ctx.textAlign = "center";
    ctx.font = `800 52px ${font}`;
    ctx.fillText(seats[seat].wind, x + 63, y + 94);
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.font = `700 46px ${font}`;
    ctx.fillText(shortName(seats[seat].name), x + 118, y + 92);
    ctx.textAlign = "right";
    ctx.fillStyle = "#eef3ff";
    ctx.font = `700 56px ${font}`;
    ctx.fillText(seats[seat].points.toLocaleString("en-US"), x + w - 22, y + 96);
    // The chart.
    const cx = x + 360;
    const cw = 330;
    const line = history[seat];
    const px = (i: number) => cx + (i / Math.max(1, line.length - 1)) * cw;
    const py = (v: number) => y + h - 22 - ((v - lo) / (hi - lo)) * (h - 44);
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, py(25000));
    ctx.lineTo(cx + cw, py(25000));
    ctx.stroke();
    ctx.setLineDash([]);
    const n = line.length;
    const pts: [number, number][] = line.map((v, i) => [px(i), py(v)]);
    if (n > 1 && chartAt < 1) {
      const [ax, ay] = pts[n - 2];
      const [bx, by] = pts[n - 1];
      pts[n - 1] = [ax + (bx - ax) * chartAt, ay + (by - ay) * chartAt];
    }
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, `${color}66`);
    fill.addColorStop(1, `${color}00`);
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.lineTo(pts[pts.length - 1][0], y + h - 6);
    ctx.lineTo(pts[0][0], y + h - 6);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const [ex, ey] = pts[pts.length - 1];
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex, ey, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function MarketBoard({ day }: { day: boolean }) {
  const seats = useStageStore((s) => s.model.seats);
  const round = useStageStore((s) => s.model.round);
  const left = useStageStore((s) => s.model.wall);
  const reduced = useStageStore((s) => s.ui.reduced);
  const invalidate = useThree((s) => s.invalidate);
  const boardMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = BOARD;
    element.height = BOARD;
    const t = new THREE.CanvasTexture(element);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  // A new point on the charts (a hand finished) draws its last stretch in over ~0.9 s.
  const points = seats[0]?.history.length ?? 0;
  const grow = useRef({ points, at: 0 });
  useEffect(() => {
    if (grow.current.points === points) return;
    grow.current = { points, at: points > grow.current.points && !reduced ? performance.now() : 0 };
    invalidate();
  }, [points, reduced, invalidate]);
  // Redraw when what it shows changes (the key lives on the texture, so a fresh texture always draws).
  const content = JSON.stringify([day, seats.map((seat) => [seat.name, seat.color, seat.wind, seat.points, seat.history]), round, left]);
  useFrame(() => {
    const map = boardMaterial.current?.map as THREE.CanvasTexture | null | undefined;
    if (!map) return;
    const chartAt = grow.current.at ? Math.min(1, (performance.now() - grow.current.at) / 900) : 1;
    const key = `${content}|${chartAt}`;
    if (map.userData.key === key) return;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "system-ui, sans-serif";
    drawBoard((map.image as HTMLCanvasElement).getContext("2d")!, { day, seats, round, left, chartAt, font });
    map.userData.key = key;
    map.needsUpdate = true;
    invalidate();
  });
  useEffect(() => () => texture.dispose(), [texture]);

  const plinth = useMemo(() => new RoundedBoxGeometry(TABLE.plinth * 2, TABLE.plinthHeight, TABLE.plinth * 2, 3, 0.5), []);
  useEffect(() => () => plinth.dispose(), [plinth]);
  const s = TABLE.plinth * 2 - 0.9;
  return (
    <group>
      <mesh geometry={plinth} position-y={TABLE.plinthHeight / 2} castShadow receiveShadow>
        <meshStandardMaterial color={day ? "#2a3550" : "#0d1424"} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={TABLE.plinthHeight + 0.01}>
        <planeGeometry args={[s, s]} />
        <meshBasicMaterial ref={boardMaterial} map={texture} toneMapped={false} color={day ? "#d6deef" : "#ffffff"} />
      </mesh>
      {/* The dora rack's little brass base. */}
      <mesh position={[0, TABLE.plinthHeight + 0.18, -TABLE.plinth + 2.4]} castShadow>
        <boxGeometry args={[9.6, 0.36, 1.6]} />
        <meshStandardMaterial color="#b48a4f" metalness={0.9} roughness={0.35} />
      </mesh>
      {/* A glowing strip at the foot of each side, in that seat's color. */}
      {[0, 1, 2, 3].map((seat) => {
        const [x, , z] = seatPoint(seat, 0, 0.12, TABLE.plinth + 0.25);
        return (
          <mesh key={seat} position={[x, 0.12, z]} rotation-y={SEAT_YAW[seat]}>
            <boxGeometry args={[TABLE.plinth * 1.5, 0.22, 0.22]} />
            <meshBasicMaterial color={seats[seat]?.color ?? "#3fb8f5"} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Riichi sticks and the pulse ring ─────────────────────────────────────────
function RiichiStick({ seat, at, reduced }: { seat: number; at: number; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [x, , z] = seatPoint(seat, 0, 0, ROWS.stick);
  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const t = reduced ? 10 : (performance.now() - at) / 1000 - 0.25;
    let y: number;
    if (t < 0) y = 14;
    else if (t < 0.45) y = 14 * (1 - (t / 0.45) ** 2);
    else if (t < 0.75) y = Math.sin(((t - 0.45) / 0.3) * Math.PI) * 1.2;
    else if (t < 0.92) y = Math.sin(((t - 0.75) / 0.17) * Math.PI) * 0.3;
    else y = 0;
    group.position.set(x, 0.22 + y, z);
    group.rotation.set(0, SEAT_YAW[seat], t < 0.75 ? Math.sin(t * 9) * 0.12 * Math.max(0, 0.75 - t) : 0);
    group.visible = t >= 0;
    if (t < 1) invalidate();
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[9, 0.32, 0.8]} />
        <meshStandardMaterial color="#f4efe2" roughness={0.4} />
      </mesh>
      <mesh position-y={0.17}>
        <cylinderGeometry args={[0.24, 0.24, 0.03, 20]} />
        <meshStandardMaterial color="#cc3a2f" roughness={0.4} />
      </mesh>
    </group>
  );
}

function PulseRing({ seat, at, color, reduced }: { seat: number; at: number; color: string; reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [x, , z] = seatPoint(seat, 0, 0, ROWS.stick + 3);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = (performance.now() - at) / 1000 - 0.65;
    const material = mesh.material as THREE.MeshBasicMaterial;
    if (reduced || t < 0 || t > 2.2) {
      mesh.visible = false;
      if (t < 2.2 && !reduced) invalidate();
      return;
    }
    mesh.visible = true;
    // Two quick pulses outward.
    const k = (t % 1.1) / 1.1;
    mesh.scale.setScalar(4 + k * 26);
    material.opacity = (1 - k) ** 1.6 * 0.9;
    invalidate();
  });
  return (
    <mesh ref={ref} position={[x, 0.08, z]} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.86, 1, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export function TableScene({ day }: { day: boolean }) {
  const riichi = useStageStore((s) => s.model.seats.map((seat) => (seat.riichi ? 1 : 0)).join(""));
  const moment = useStageStore((s) => s.model.moment);
  const reduced = useStageStore((s) => s.ui.reduced);
  const momentColor = useStageStore((s) => (s.model.moment ? s.model.seats[s.model.moment.seat]?.color : null) ?? "#3fb8f5");
  // A stick drops during its riichi moment; afterwards (time 0) it simply lies there.
  const droppedAt = (seat: number) => (moment?.kind === "riichi" && moment.seat === seat ? moment.at : 0);
  const glow = useMemo(() => radialTexture(0, 1), []);
  useEffect(() => () => glow.dispose(), [glow]);
  return (
    <group>
      <TableBody day={day} />
      <MarketBoard day={day} />
      {/* Soft warm pool on the felt under the lamp. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <planeGeometry args={[70, 70]} />
        <meshBasicMaterial map={glow} color={day ? "#fff4d6" : "#ffb866"} transparent opacity={day ? 0.08 : 0.13} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {riichi.split("").map((on, seat) => (on === "1" ? <RiichiStick key={`stick-${seat}`} seat={seat} at={droppedAt(seat)} reduced={reduced} /> : null))}
      {moment?.kind === "riichi" ? <PulseRing key={moment.id} seat={moment.seat} at={moment.at} color={momentColor} reduced={reduced} /> : null}
    </group>
  );
}
