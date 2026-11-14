"use client";

// The three opponents as camera-facing cutouts seated behind their side of the table. Each cutout is
// placed from its own alpha: the bottom middle of the figure sits on the seat's anchor, just below the
// table's edge, and the width of the figure's bottom sets the scale. So a bust (cut at the chest) and a
// half-body portrait (cut at the waist) both come out with the same shoulders, the cut hidden behind
// the rim, and taller art simply rises higher with no code change. Lit by the lamp from the table side,
// with a thin rim of the seat's color on the far edge; a mood change cross-fades between images. A
// missing image falls back to a plain silhouette, so the stage works without the pilot art.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { portraitSpot } from "@/app/components/games/mahjong/stage/geometry";
import { SEATS, seatColor, useStage, type Mood } from "@/app/components/games/mahjong/stage/mock-state";
import { narrowness } from "@/app/components/games/mahjong/stage/rig";
import { fx } from "@/app/components/games/mahjong/stage/fx";
import { radialTexture, silhouetteTexture } from "@/app/components/games/mahjong/stage/textures";

const MOODS: Mood[] = ["idle", "think", "riichi", "win"];

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uSway;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Breathing: a slow rise of the shoulders and a slight lean, more toward the top of the image.
    // (The plane is unit-sized and scaled by the mesh, so these are fractions of the figure.)
    float breath = sin(uTime * 1.55 + uPhase);
    p.y += breath * 0.004 * uv.y * uSway;
    p.x += sin(uTime * 0.6 + uPhase * 1.7) * 0.008 * uv.y * uv.y * uSway;
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
  uniform float uOuter;
  uniform vec2 uTexel;
  uniform vec2 uCut;
  varying vec2 vUv;
  float alphaAt(vec2 uv) {
    return mix(texture2D(uA, uv).a, texture2D(uB, uv).a, uMix);
  }
  void main() {
    vec4 c = mix(texture2D(uA, vUv), texture2D(uB, vUv), uMix);
    // Tighten the soft matte edge: the cutouts' transparent pixels are black, so the outermost pixel
    // or two would otherwise filter into a dark (or, lit, a pale) fringe.
    float a = smoothstep(0.35, 0.75, c.a);
    // Fade out the last stretch above the cut (waist or chest), in case a camera angle shows it past the rim.
    a *= smoothstep(uCut.x, uCut.x + uCut.y, vUv.y);
    if (a < 0.01) discard;

    // Where the silhouette's edge is, and which way it faces (alpha rises toward the inside).
    vec2 o = uTexel * 4.0;
    vec2 g = vec2(alphaAt(vUv + vec2(o.x, 0.0)) - alphaAt(vUv - vec2(o.x, 0.0)), alphaAt(vUv + vec2(0.0, o.y)) - alphaAt(vUv - vec2(0.0, o.y)));
    float edge = clamp(length(g) * 0.8, 0.0, 1.0);
    vec2 outward = -g / max(length(g), 1e-4);
    // The seat's rim light sits behind and above, on the side away from the table: it only catches
    // edges that face it, and only just inside the silhouette, so there is no outline all the way round.
    float facing = smoothstep(0.1, 0.9, dot(outward, normalize(vec2(uOuter * 0.8, 1.0))));
    float rim = edge * facing * a;

    // The lamp hangs over the table: brighter toward the top and on the side facing the table.
    float lamp = mix(0.74, 1.0, smoothstep(0.15, 0.85, vUv.y));
    float across = uOuter > 0.5 ? vUv.x : (uOuter < -0.5 ? 1.0 - vUv.x : 0.5);
    lamp *= mix(1.05, 0.88, across);
    vec3 col = c.rgb * uWarm * lamp * uLight + uRim * rim * uRimStrength;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Where the figure is in its image, from the alpha: all as fractions of the image (v measured up from the bottom). */
type Fit = { cx: number; bottom: number; band: number; height: number; aspect: number };

/**
 * Reads a cutout's alpha (on a small copy, it only needs to be roughly right): the bottom of the figure,
 * and the middle and width of its bottom eighth, the shoulders or waist, which stays put however the
 * hair or ears spread above it.
 */
function measure(image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Fit | null {
  const W = image.width;
  const H = image.height;
  if (!W || !H) return null;
  const k = Math.min(1, 256 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 128;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (top < 0) top = y;
      bottom = y;
      break;
    }
  }
  if (top < 0) return null;
  const tall = bottom - top + 1;
  let minX = w;
  let maxX = -1;
  let widthSum = 0;
  let rows = 0;
  for (let y = Math.max(top, bottom - Math.round(tall * 0.12)); y <= bottom; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    widthSum += count;
    rows += 1;
  }
  return { cx: (minX + maxX + 1) / 2 / w, bottom: (h - 1 - bottom) / h, band: Math.max(0.05, widthSum / rows / w), height: tall / h, aspect: W / H };
}

type PortraitSet = { fallback: THREE.Texture; fallbackFit: Fit | null; loaded: Partial<Record<Mood, THREE.Texture>>; fit: Fit | null };

/** The four moods' images; until one has loaded (or if it never does) the silhouette stands in. */
function usePortraitTextures(symbol: string | null, invalidate: () => void): PortraitSet {
  const set = useMemo(() => {
    const fallback = silhouetteTexture();
    const result: PortraitSet = { fallback, fallbackFit: measure(fallback.image as HTMLCanvasElement), loaded: {}, fit: null };
    if (!symbol) return result;
    for (const mood of MOODS) {
      // Half-body art first; the older head-and-shoulders set stands in where it's missing.
      const load = (paths: string[]): void => {
        const [path, ...rest] = paths;
        new THREE.TextureLoader().load(
          path,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            result.loaded[mood] = texture;
            // Every mood is placed the way the idle image is (the set is drawn to one framing), so a
            // mood change never shifts the figure; until idle arrives the first image to load stands in.
            if (mood === "idle" || !result.fit) result.fit = measure(texture.image as HTMLImageElement) ?? result.fit;
            invalidate();
          },
          undefined,
          () => (rest.length ? load(rest) : invalidate())
        );
      };
      load([`/art/_overlay/mahjong-pilot/half/${symbol}_${mood}.png`, `/art/_overlay/mahjong-pilot/${symbol}_${mood}.png`]);
    }
    return result;
  }, [symbol, invalidate]);
  useEffect(
    () => () => {
      set.fallback.dispose();
      Object.values(set.loaded).forEach((texture) => texture?.dispose());
    },
    [set]
  );
  return set;
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
  useEffect(() => () => halo.dispose(), [halo]);
  const color = seatColor(seat, day);
  const spot = portraitSpot(seat, narrowness(aspect));
  const outer = seat === 1 ? 1 : seat === 3 ? -1 : 0;

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
          uRimStrength: { value: 1 },
          uOuter: { value: 0 },
          uTexel: { value: new THREE.Vector2(1 / 640, 1 / 640) },
          uCut: { value: new THREE.Vector2(0, 0.0001) },
          uTime: { value: 0 },
          uPhase: { value: seat * 1.9 },
          uSway: { value: 1 },
        },
      }),
    [seat]
  );
  useEffect(() => () => material.dispose(), [material]);
  const plane = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

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
    // camera doesn't see the cutouts squashed. The group's origin is the figure's bottom, below the
    // table's edge, so leaning never lifts the cut into view.
    const camera = state.camera;
    const dx = camera.position.x - g.position.x;
    const dz = camera.position.z - g.position.z;
    const dy = camera.position.y - g.position.y;
    const win = fx.seat[seat];
    g.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.6, Math.atan2(dx, dz), 0, "YXZ");
    g.scale.setScalar(1 + 0.05 * win);

    // Size and place the plane from the figure's alpha bounds.
    const fit = textures.fit ?? textures.fallbackFit;
    if (fit) {
      let width = spot.shoulder / fit.band;
      const tall = (fit.height * width) / fit.aspect;
      if (tall > spot.maxHeight) width *= spot.maxHeight / tall;
      const height = width / fit.aspect;
      mesh.scale.set(width, height, 1);
      mesh.position.set(-(fit.cx - 0.5) * width, height * (0.5 - fit.bottom), 0);
      (mesh.material as THREE.ShaderMaterial).uniforms.uCut.value.set(fit.bottom, fit.height * 0.12);
      const halo = haloRef.current;
      if (halo) {
        const figure = fit.height * height;
        halo.position.set(0, figure * 0.62, -0.8);
        halo.scale.set(figure * 1.5, figure * 1.3, 1);
      }
    }

    const f = fade.current;
    const t = reduced ? 1 : Math.min(1, (performance.now() - f.at) / 260);
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    const a = pick(textures, f.from);
    u.uA.value = a;
    u.uB.value = pick(textures, f.to);
    u.uMix.value = t;
    const image = a.image as { width?: number; height?: number } | undefined;
    if (image?.width && image.height) u.uTexel.value.set(1 / image.width, 1 / image.height);
    u.uTime.value = state.clock.elapsedTime;
    u.uSway.value = reduced ? 0 : 1;
    u.uOuter.value = outer;
    u.uRim.value.set(color);
    u.uWarm.value.set(day ? "#fff4e6" : "#ffe6cc");
    u.uRimStrength.value = (day ? 0.35 : 0.85) * (1 + 1.6 * win);
    const base = day ? 0.95 : 0.92;
    // The room dims for a big moment; the winner stays in the spotlight.
    u.uLight.value = base * (0.3 + 0.7 * fx.room) + win * (day ? 0.4 : 0.5);
    const haloMesh = haloRef.current;
    if (haloMesh) (haloMesh.material as THREE.MeshBasicMaterial).opacity = (day ? 0 : 0.07) + win * (day ? 0.18 : 0.28);
    if (t < 1) invalidate();
  });

  return (
    <group ref={group} position={spot.p}>
      <mesh ref={haloRef} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={halo} color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={plane} material={material}>
        <planeGeometry args={[1, 1]} />
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
