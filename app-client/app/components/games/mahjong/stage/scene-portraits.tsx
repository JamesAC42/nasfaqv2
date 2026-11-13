"use client";

// The three opponents as camera-facing cutouts seated behind their tiles. Lit by the room level, edged
// with a rim light in the seat's color, breathing a little; a mood change cross-fades between images.
// A missing image falls back to a plain silhouette, so the stage works without the pilot art.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { portraitSpot } from "@/app/components/games/mahjong/stage/geometry";
import { SEATS, seatColor, useStage, type Mood } from "@/app/components/games/mahjong/stage/mock-state";
import { narrowness } from "@/app/components/games/mahjong/stage/rig";
import { fx } from "@/app/components/games/mahjong/stage/fx";
import { radialTexture, silhouetteTexture } from "@/app/components/games/mahjong/stage/textures";

const MOODS: Mood[] = ["idle", "think", "riichi", "win"];
/** Per-talent nudge so heads sit at a similar height above the rack (the cutouts frame them differently). */
const LIFT: Record<string, number> = { GUR: 6, PEK: -1, SUI: 1 };

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uSway;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Breathing: a slow rise of the shoulders and a slight lean, more toward the top of the image.
    float breath = sin(uTime * 1.55 + uPhase);
    p.y += breath * 0.18 * uv.y * uSway;
    p.x += sin(uTime * 0.6 + uPhase * 1.7) * 0.35 * uv.y * uv.y * uSway;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform float uMix;
  uniform float uLight;
  uniform vec3 uRim;
  uniform vec3 uWarm;
  uniform float uRimStrength;
  varying vec2 vUv;
  float alphaAt(vec2 uv) {
    return mix(texture2D(uA, uv).a, texture2D(uB, uv).a, uMix);
  }
  void main() {
    vec4 c = mix(texture2D(uA, vUv), texture2D(uB, vUv), uMix);
    if (c.a < 0.02) discard;
    // Rim: bright where the silhouette edge faces out (sides and top), in the seat's color.
    float o = 0.012;
    float inside = min(min(alphaAt(vUv + vec2(o, 0.0)), alphaAt(vUv - vec2(o, 0.0))), alphaAt(vUv + vec2(0.0, o)));
    float inside2 = min(min(alphaAt(vUv + vec2(o * 2.5, 0.0)), alphaAt(vUv - vec2(o * 2.5, 0.0))), alphaAt(vUv + vec2(0.0, o * 2.5)));
    float rim = clamp(c.a - inside, 0.0, 1.0) + 0.45 * clamp(c.a - inside2, 0.0, 1.0);
    // The lamp hangs above: warmer and brighter toward the top, a touch darker toward the rack.
    float lamp = mix(0.78, 1.06, smoothstep(0.1, 0.85, vUv.y));
    vec3 col = c.rgb * uWarm * lamp * uLight + uRim * rim * uRimStrength;
    gl_FragColor = vec4(col, c.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type PortraitSet = { fallback: THREE.Texture; loaded: Partial<Record<Mood, THREE.Texture>> };

/** The four moods' images; until one has loaded (or if it never does) the silhouette stands in. */
function usePortraitTextures(symbol: string | null, invalidate: () => void): PortraitSet {
  return useMemo(() => {
    const result: PortraitSet = { fallback: silhouetteTexture(), loaded: {} };
    if (!symbol) return result;
    for (const mood of MOODS) {
      new THREE.TextureLoader().load(
        `/art/_overlay/mahjong-pilot/${symbol}_${mood}.png`,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          result.loaded[mood] = texture;
          invalidate();
        },
        undefined,
        () => invalidate()
      );
    }
    return result;
  }, [symbol, invalidate]);
}

const pick = (set: PortraitSet, mood: Mood) => set.loaded[mood] ?? set.loaded.idle ?? set.fallback;

function Portrait({ seat, day }: { seat: number; day: boolean }) {
  const info = SEATS[seat];
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const mood = useStage((s) => s.moods[seat]);
  const reduced = useStage((s) => s.reduced);
  const textures = usePortraitTextures(info.symbol, invalidate);
  const group = useRef<THREE.Group>(null);
  const halo = useMemo(() => radialTexture(0.05, 1.3), []);
  const color = seatColor(seat, day);
  const spot = portraitSpot(seat, narrowness(aspect));
  const lift = info.symbol ? (LIFT[info.symbol] ?? 0) : 0;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: true,
        uniforms: {
          uA: { value: null },
          uB: { value: null },
          uMix: { value: 0 },
          uLight: { value: 1 },
          uRim: { value: new THREE.Color() },
          uWarm: { value: new THREE.Color() },
          uRimStrength: { value: 1.4 },
          uTime: { value: 0 },
          uPhase: { value: seat * 1.9 },
          uSway: { value: 1 },
        },
      }),
    [seat]
  );
  useEffect(() => () => material.dispose(), [material]);
  const plane = useRef<THREE.Mesh>(null);

  // Cross-fade to the new mood.
  const fade = useRef<{ from: Mood; to: Mood; at: number }>({ from: "idle", to: "idle", at: 0 });
  useEffect(() => {
    const f = fade.current;
    if (f.to === mood) return;
    const shown = performance.now() - f.at > 260 ? f.to : f.from;
    fade.current = { from: shown, to: mood, at: performance.now() };
    invalidate();
  }, [mood, invalidate]);

  useFrame((state) => {
    const g = group.current;
    const mesh = plane.current;
    if (!g || !mesh) return;
    // Face the lens: turn about the vertical, and lean back part of the way toward it so a steep phone
    // camera doesn't see the cutouts squashed.
    const camera = state.camera;
    const dx = camera.position.x - g.position.x;
    const dz = camera.position.z - g.position.z;
    const dy = camera.position.y - g.position.y;
    g.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.6, Math.atan2(dx, dz), 0, "YXZ");
    const f = fade.current;
    const t = reduced ? 1 : Math.min(1, (performance.now() - f.at) / 260);
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    u.uA.value = pick(textures, f.from);
    u.uB.value = pick(textures, f.to);
    u.uMix.value = t;
    u.uTime.value = state.clock.elapsedTime;
    u.uSway.value = reduced ? 0 : 1;
    u.uRim.value.set(color);
    u.uWarm.value.set(day ? "#fff6ea" : "#ffe9d2");
    u.uRimStrength.value = day ? 0.8 : 2.4;
    const base = day ? 1.02 : 0.98;
    u.uLight.value = base * (0.35 + 0.65 * fx.room) + fx.seat[seat] * 0.35;
    if (t < 1) invalidate();
  });

  const size = spot.size;
  return (
    <group ref={group} position={[spot.p[0], spot.p[1] + lift, spot.p[2]]}>
      <mesh position={[0, size * 0.06, -0.6]} renderOrder={-1}>
        <planeGeometry args={[size * 1.25, size * 1.15]} />
        <meshBasicMaterial map={halo} color={color} transparent opacity={day ? 0.16 : 0.22} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={plane} material={material}>
        <planeGeometry args={[size, size]} />
      </mesh>
    </group>
  );
}

export function Portraits({ day }: { day: boolean }) {
  return (
    <group>
      {[1, 2, 3].map((seat) => (
        <Portrait key={seat} seat={seat} day={day} />
      ))}
    </group>
  );
}
