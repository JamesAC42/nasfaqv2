"use client";

// The WebGL half of the stage, loaded only in the browser (stage-mock imports it with ssr:false):
// lights, the room, the camera rig and the scene pieces.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { portraitSpot, SEAT_YAW, seatPoint, TILE, type Vec3 } from "@/app/components/games/mahjong/stage/geometry";
import { seatColor, useStage } from "@/app/components/games/mahjong/stage/mock-state";
import { basePose, handAnchor, narrowness } from "@/app/components/games/mahjong/stage/rig";
import { fx } from "@/app/components/games/mahjong/stage/fx";
import { actionsKey, anchorKey, anchorWorld, fpsKey, overlayEls } from "@/app/components/games/mahjong/stage/overlay";
import { radialTexture, roomTexture } from "@/app/components/games/mahjong/stage/textures";
import { Tiles } from "@/app/components/games/mahjong/stage/scene-tiles";
import { TableScene } from "@/app/components/games/mahjong/stage/scene-table";
import { Portraits } from "@/app/components/games/mahjong/stage/scene-portraits";

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

// ── Light beams ──────────────────────────────────────────────────────────────
/** A soft volumetric-looking cone: brightest where you look straight through it, fading at its edges and toward its foot. */
function beamMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        vAlong = -position.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float face = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        float foot = smoothstep(0.0, 0.25, vAlong) * (1.0 - smoothstep(0.9, 1.0, vAlong));
        gl_FragColor = vec4(uColor * face * foot * uOpacity, 1.0);
      }
    `,
  });
}

// ── Lights ───────────────────────────────────────────────────────────────────
const LAMP: Vec3 = [0, 96, 4];
/** Where the win spotlight hangs: high above the far side, so its beam slants across the frame. */
const SPOT_FROM: Vec3 = [0, 125, -30];

function Lights({ day }: { day: boolean }) {
  const pendant = useRef<THREE.SpotLight>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const target = useMemo(() => new THREE.Object3D(), []);
  const spotTarget = useMemo(() => new THREE.Object3D(), []);

  // A soft studio environment so the brass and the tile glaze have something to reflect.
  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [get]);

  useEffect(() => {
    const { scene } = get();
    scene.environmentIntensity = day ? 0.32 : 0.28;
    scene.background = new THREE.Color(day ? "#e7dcc6" : "#04060b");
    scene.fog = new THREE.Fog(day ? "#e7dcc6" : "#04060b", 170, 420);
    invalidate();
  }, [get, day, invalidate]);

  useEffect(() => {
    const { scene } = get();
    scene.add(target);
    scene.add(spotTarget);
    target.position.set(0, 0, -2);
    if (pendant.current) pendant.current.target = target;
    if (spot.current) spot.current.target = spotTarget;
    return () => {
      scene.remove(target);
      scene.remove(spotTarget);
    };
  }, [get, target, spotTarget]);

  const level = useRef({ room: 1, spot: 0, aim: new THREE.Vector3(0, 0, 0) });
  const beam = useRef<THREE.Mesh>(null);
  const beamGeometry = useMemo(() => {
    // A unit-tall open cone, apex at the top, fading out toward the floor.
    const geometry = new THREE.CylinderGeometry(0.05, 1, 1, 48, 8, true);
    geometry.translate(0, -0.5, 0);
    return geometry;
  }, []);
  const beamMat = useMemo(() => beamMaterial(day ? "#fff3dc" : "#ffe2b8"), [day]);
  useEffect(() => () => beamMat.dispose(), [beamMat]);
  useFrame((state) => {
    const { moment, reveal, reduced } = useStage.getState();
    const now = performance.now();
    let room = 1;
    let spotOn = 0;
    const aim = new THREE.Vector3(0, 0, 0);
    if (moment) {
      const t = (now - moment.at) / 1000;
      if (moment.kind === "win") {
        room = 1 - 0.72 * smooth(t / 0.5);
        spotOn = smooth((t - 0.2) / 0.5);
        const [hx, , hz] = moment.seat === 0 ? [0, 0, 30] : seatPoint(moment.seat, 0, 0, 34);
        // The spot swings in from the middle of the table to the winner's place.
        const swing = reduced ? 1 : smooth((t - 0.15) / 0.9);
        aim.set(hx * swing, 0, hz * swing);
      } else if (moment.kind === "draw") {
        const flicker = t < 0.9 ? (Math.sin(t * 61) > 0.2 ? 0.35 : 0.85) * (1 - t / 0.9) + 0.55 * (t / 0.9) : 0.55;
        room = reduced ? 0.55 : flicker;
      } else if (moment.kind === "riichi") {
        room = 1 - 0.18 * smooth(t / 0.6);
      }
    } else if (reveal !== null) {
      room = 0.4;
    }
    const l = level.current;
    const k = reduced ? 1 : moment?.kind === "draw" ? 1 : 0.12;
    l.room += (room - l.room) * k;
    l.spot += (spotOn - l.spot) * (reduced ? 1 : 0.15);
    l.aim.lerp(aim, reduced ? 1 : 0.2);
    fx.room = l.room;
    for (let seat = 0; seat < 4; seat++) fx.seat[seat] = moment?.kind === "win" && moment.seat === seat ? l.spot : 0;

    if (pendant.current) pendant.current.intensity = (day ? 1.9 : 4.6) * (0.25 + 0.75 * l.room);
    if (hemi.current) hemi.current.intensity = (day ? 0.62 : 0.5) * (0.3 + 0.7 * l.room);
    if (fill.current) fill.current.intensity = (day ? 0.32 : 0.6) * l.room;
    if (spot.current) {
      spot.current.intensity = l.spot * (day ? 5 : 7);
      spotTarget.position.copy(l.aim);
      spot.current.visible = l.spot > 0.01;
    }
    state.scene.environmentIntensity = (day ? 0.32 : 0.28) * (0.3 + 0.7 * l.room);
    const cone = beam.current;
    if (cone) {
      const top = SPOT_FROM;
      const dx = l.aim.x - top[0];
      const dy = l.aim.y - top[1];
      const dz = l.aim.z - top[2];
      const length = Math.hypot(dx, dy, dz);
      cone.position.set(...top);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / length, dy / length, dz / length));
      const radius = Math.tan(0.2) * length;
      cone.scale.set(radius, length, radius);
      (cone.material as THREE.ShaderMaterial).uniforms.uOpacity.value = l.spot * (day ? 0.22 : 0.4);
      cone.visible = l.spot > 0.01;
    }
    if (Math.abs(l.room - room) > 0.002 || Math.abs(l.spot - spotOn) > 0.002) invalidate();
  });

  return (
    <>
      <spotLight
        ref={pendant}
        position={LAMP}
        angle={0.47}
        penumbra={0.95}
        decay={0}
        color={day ? "#fff1d8" : "#ffc98a"}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={40}
        shadow-camera-far={170}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={5}
      />
      <hemisphereLight ref={hemi} args={[day ? "#fff8ec" : "#4b5f93", day ? "#b39a74" : "#07090f"]} />
      <directionalLight ref={fill} position={[-50, 60, 90]} color={day ? "#ffffff" : "#8fb2ff"} />
      <mesh ref={beam} geometry={beamGeometry} material={beamMat} visible={false} renderOrder={5} />
      <spotLight ref={spot} position={SPOT_FROM} angle={0.2} penumbra={0.6} decay={0} color={day ? "#fffaf0" : "#fff2dc"} visible={false} />
    </>
  );
}

// ── Room: backdrop, floor, the lamp and its glow ─────────────────────────────
function Room({ day }: { day: boolean }) {
  const backdrop = useMemo(() => roomTexture(day), [day]);
  const glow = useMemo(() => radialTexture(0, 1), []);
  const backdropMat = useRef<THREE.MeshBasicMaterial>(null);
  const coneRef = useRef<THREE.Mesh>(null);
  const motes = useMemo(() => {
    const count = 140;
    const positions = new Float32Array(count * 3);
    let seed = 3;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const y = 10 + random() * 80;
      const r = (1 - y / 100) * 40 * Math.sqrt(random());
      const a = random() * Math.PI * 2;
      positions.set([Math.cos(a) * r, y, Math.sin(a) * r + 2], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  const motesRef = useRef<THREE.Points>(null);
  useEffect(() => () => backdrop.dispose(), [backdrop]);
  // The lamp's cone of light: the same soft beam as the win spotlight, unit-sized and scaled.
  const cone = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.08, 1, 1, 48, 8, true);
    geometry.translate(0, -0.5, 0);
    return geometry;
  }, []);
  const coneMaterial = useMemo(() => beamMaterial(day ? "#fff4dc" : "#ffcf8f"), [day]);
  useEffect(() => () => coneMaterial.dispose(), [coneMaterial]);

  useFrame((state) => {
    if (backdropMat.current) backdropMat.current.color.setScalar(0.25 + 0.75 * fx.room);
    if (coneRef.current) (coneRef.current.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (day ? 0.05 : 0.11) * fx.room;
    if (motesRef.current && !useStage.getState().reduced) motesRef.current.rotation.y = state.clock.elapsedTime * 0.02;
  });

  return (
    <group>
      <mesh position-y={30}>
        <cylinderGeometry args={[300, 300, 260, 64, 1, true]} />
        <meshBasicMaterial ref={backdropMat} map={backdrop} side={THREE.BackSide} fog={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-70} receiveShadow>
        <circleGeometry args={[300, 48]} />
        <meshStandardMaterial color={day ? "#b89a72" : "#07090e"} roughness={0.85} />
      </mesh>
      {/* The pendant: a brass shade and a hot bulb, mostly above the frame. */}
      <group position={LAMP}>
        <mesh position-y={3}>
          <cylinderGeometry args={[3, 9, 6, 32, 1, true]} />
          <meshStandardMaterial color="#b48a4f" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.6, 16, 12]} />
          <meshBasicMaterial color="#fff2d0" toneMapped={false} />
        </mesh>
        <mesh>
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial map={glow} color={day ? "#fff6e0" : "#ffcf8f"} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position-y={30}>
          <cylinderGeometry args={[0.2, 0.2, 60, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </group>
      <mesh ref={coneRef} geometry={cone} material={coneMaterial} position={LAMP} scale={[46, LAMP[1] + 4, 46]} renderOrder={4} />
      <points ref={motesRef} geometry={motes}>
        <pointsMaterial size={0.35} color={day ? "#ffffff" : "#ffd9a8"} transparent opacity={day ? 0.25 : 0.45} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
      </points>
    </group>
  );
}

// ── Camera ───────────────────────────────────────────────────────────────────
function CameraRig() {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const fpsState = useRef({ frames: 0, since: 0 });

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const base = basePose(aspect);
    const narrow = narrowness(aspect);
    const { moment, reduced } = useStage.getState();
    const position = new THREE.Vector3(...base.position);
    const target = new THREE.Vector3(...base.target);
    let busy = false;
    if (moment && !reduced && (moment.kind === "riichi" || moment.kind === "win")) {
      const t = (performance.now() - moment.at) / 1000;
      const focus = new THREE.Vector3(...(moment.seat === 0 ? seatPoint(0, 0, 4, 26) : portraitSpot(moment.seat, narrow).p));
      if (moment.seat !== 0) focus.y -= 4;
      // Glide in over ~1 s, hold, glide back.
      const env = moment.kind === "riichi" ? smooth(t / 1.0) * (1 - smooth((t - 2.4) / 1.0)) : smooth(t / 1.2) * 0.1;
      target.lerp(focus, 0.38 * env);
      position.lerp(focus, 0.15 * env);
      busy = env > 0 && env < 1;
      if (t < 3.6) busy = true;
    }
    if (!reduced) {
      // A few millimeters of idle drift.
      const e = state.clock.elapsedTime;
      position.x += Math.sin(e * 0.31) * 0.35;
      position.y += Math.sin(e * 0.23 + 1) * 0.25;
      target.x += Math.sin(e * 0.17) * 0.12;
    }
    camera.position.copy(position);
    lookAt.copy(target);
    camera.lookAt(lookAt);
    if (Math.abs(camera.fov - base.fov) > 0.01) {
      camera.fov = base.fov;
      camera.near = 5;
      camera.far = 900;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    // Pin the DOM overlays.
    for (const kind of ["plate", "cheer"] as const) {
      for (let seat = 0; seat < 4; seat++) {
        const el = overlayEls.get(anchorKey(kind, seat));
        if (!el) continue;
        scratch.set(...anchorWorld(kind, seat, narrow)).project(camera);
        const x = ((scratch.x + 1) / 2) * size.width;
        const y = ((1 - scratch.y) / 2) * size.height;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        el.style.visibility = scratch.z < 1 ? "visible" : "hidden";
      }
    }

    const actions = overlayEls.get(actionsKey);
    if (actions) {
      const hand = handAnchor(aspect, size.width);
      scratch.set(hand.center[0], hand.center[1] + TILE.h * 0.62, hand.center[2]).project(camera);
      const x = ((scratch.x + 1) / 2) * size.width;
      const y = ((1 - scratch.y) / 2) * size.height;
      actions.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      actions.style.visibility = "visible";
    }

    // FPS readout.
    const f = fpsState.current;
    f.frames += 1;
    const now = performance.now();
    if (now - f.since > 500) {
      const el = overlayEls.get(fpsKey);
      if (el) el.textContent = `${Math.round((f.frames * 1000) / (now - f.since))} fps`;
      f.frames = 0;
      f.since = now;
    }
    if (busy) invalidate();
  });
  return null;
}

/** Under reduced motion the canvas renders on demand: redraw whenever the mock state changes. */
function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => useStage.subscribe(() => invalidate()), [invalidate]);
  return null;
}

export default function StageCanvas({ day }: { day: boolean }) {
  const reduced = useStage((s) => s.reduced);
  const lowEnd = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4;
  const backColor = day ? "#2f86c0" : "#1a557c";
  return (
    <Canvas
      shadows="percentage"
      dpr={lowEnd ? 1 : [1, 1.5]}
      frameloop={reduced ? "demand" : "always"}
      camera={{ fov: 40, near: 5, far: 900, position: [0, 61, 80] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, get }) => {
        gl.toneMappingExposure = 1.05;
        // For measuring from the browser console (dev-only page): window.__mjThree().gl.info, etc.
        (window as unknown as { __mjThree?: typeof get }).__mjThree = get;
        // ANGLE's D3D compiler logs harmless X4122 precision notes for three's depth-packing chunk;
        // compile errors still surface as WebGL errors.
        gl.debug.checkShaderErrors = false;
      }}
    >
      <InvalidateOnChange />
      <CameraRig />
      <Lights day={day} />
      <Room day={day} />
      <TableScene day={day} />
      <Tiles day={day} backColor={backColor} />
      <Portraits day={day} />
      <SeatGlows day={day} />
    </Canvas>
  );
}

/** A faint pool of each seat's color on the felt in front of its hand. */
function SeatGlows({ day }: { day: boolean }) {
  const glow = useMemo(() => radialTexture(0, 1), []);
  return (
    <group>
      {[0, 1, 2, 3].map((seat) => {
        const [x, , z] = seatPoint(seat, 0, 0, 30);
        return (
          <mesh key={seat} position={[x, 0.04, z]} rotation={new THREE.Euler(-Math.PI / 2, SEAT_YAW[seat], 0, "YXZ")}>
            <planeGeometry args={[48, 22]} />
            <meshBasicMaterial map={glow} color={seatColor(seat, day)} transparent opacity={day ? 0.05 : 0.07} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}
