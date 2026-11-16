"use client";

// The three opponents as camera-facing cutouts seated behind their side of the table: each seat's
// talent, in the mood the hand puts them in (think on their turn, riichi when they declare, win when
// they win). Half-body art with face metrics (art.ts) is scaled so the eyes come out the same distance
// apart for every talent, and cut at its crop line (mid-chest unless the art says otherwise): that line
// sits on the seat's anchor, just below the table's edge, and nothing under it is ever drawn. Lit by the lamp from the table side,
// with a thin rim of the seat's color on the far edge; a mood change cross-fades between images.
// A talent without half-body art gets a lit card with their reaction art (or their ticker, if that
// can't be loaded); while an image loads a plain silhouette stands in.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { faceMetrics, portraitUrl, type FaceMetrics } from "@/app/components/games/mahjong/stage/art";
import { portraitSpot } from "@/app/components/games/mahjong/stage/geometry";
import { useStageStore, type Mood } from "@/app/components/games/mahjong/stage/model";
import { hiddenBelow, narrowness } from "@/app/components/games/mahjong/stage/rig";
import { fx } from "@/app/components/games/mahjong/stage/fx";
import { radialTexture, silhouetteTexture } from "@/app/components/games/mahjong/stage/textures";
import { artId, lookupArt, textureArtUrl, type ChibiPose } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";

const MOODS: Mood[] = ["idle", "think", "riichi", "win"];
/** Where art without its own crop line is cut: this many eye distances under the eyes, about mid-chest. */
const MID_CHEST = 3.7;

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

// ── The lit card (talents without half-body art) ────────────────────────────
const CARD_POSE: Record<Mood, ChibiPose> = { idle: "idle", think: "idle", riichi: "smug", win: "hype" };
const CARD_W = 512;
const CARD_H = 640;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCard(canvas: HTMLCanvasElement, color: string, label: string, image: HTMLImageElement | null) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  roundedRect(ctx, 8, 8, CARD_W - 16, CARD_H - 16, 40);
  const back = ctx.createLinearGradient(0, 0, 0, CARD_H);
  back.addColorStop(0, "#1a2133");
  back.addColorStop(1, "#0a0e18");
  ctx.fillStyle = back;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The seat's color as a soft light from above.
  const glow = ctx.createRadialGradient(CARD_W / 2, CARD_H * 0.32, 10, CARD_W / 2, CARD_H * 0.32, CARD_W * 0.7);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.globalAlpha = 1;
  if (image && image.naturalWidth) {
    const box = { x: 30, y: 30, w: CARD_W - 60, h: CARD_H * 0.78 };
    const k = Math.min(box.w / image.naturalWidth, box.h / image.naturalHeight);
    const w = image.naturalWidth * k;
    const h = image.naturalHeight * k;
    ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + box.h - h, w, h);
  } else {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${label.length > 3 ? 120 : 150}px system-ui, sans-serif`;
    ctx.fillText(label, CARD_W / 2, CARD_H * 0.4);
  }
  ctx.restore();
  roundedRect(ctx, 8, 8, CARD_W - 16, CARD_H - 16, 40);
  ctx.lineWidth = 8;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A card with the talent's reaction art for a pose, drawn at once with their ticker until the art loads (or if it can't be). */
function cardTexture(symbol: string | null, label: string, color: string, pose: ChibiPose, invalidate: () => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  drawCard(canvas, color, label, null);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const art = symbol ? lookupArt(useArtStore.getState().manifest, artId(symbol, "reaction", pose)) : null;
  const src = art ? textureArtUrl(Object.entries(art.srcset ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])).find(([width]) => Number(width) >= 384)?.[1] ?? art.src) : null;
  if (src) {
    // Only a CORS-clean image may go into a WebGL texture: one that can't be read stays the ticker card.
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (texture.userData.disposed) return;
      drawCard(canvas, color, label, image);
      texture.needsUpdate = true;
      invalidate();
    };
    image.src = src;
  }
  return texture;
}

// ── Textures per seat ───────────────────────────────────────────────────────
type PortraitSet = {
  fallback: THREE.Texture;
  fallbackFit: Fit | null;
  loaded: Partial<Record<Mood, THREE.Texture>>;
  /** Half-body art: where the face is. */
  face: FaceMetrics | null;
  /** No half-body art: the lit card stands in. */
  card: boolean;
};

function disposeAll(textures: Iterable<THREE.Texture | undefined>) {
  new Set(textures).forEach((texture) => {
    if (!texture) return;
    texture.userData.disposed = true;
    texture.dispose();
  });
}

/**
 * The four moods' images; until one has loaded (or if it never does) the silhouette stands in. Half-body
 * art depends on the talent alone, so a theme change or new seat colors never reload it; only the
 * cards (drawn in the seat's color) are redrawn.
 */
function usePortraitTextures(symbol: string | null, name: string, color: string, invalidate: () => void): PortraitSet {
  const ensureArt = useArtStore((s) => s.ensureLoaded);
  // Listed art that can't be loaded (not deployed yet, or a host without CORS) falls back to the card.
  const [missing, setMissing] = useState<string | null>(null);
  const face = missing === symbol ? null : faceMetrics(symbol);
  const manifestReady = useArtStore((s) => s.manifest !== null);
  useEffect(() => {
    if (!face) ensureArt();
  }, [face, ensureArt]);

  const fallback = useMemo(() => {
    const texture = silhouetteTexture();
    return { texture, fit: measure(texture.image as HTMLCanvasElement) };
  }, []);
  useEffect(() => () => disposeAll([fallback.texture]), [fallback]);

  const half = useMemo(() => {
    const loaded: Partial<Record<Mood, THREE.Texture>> = {};
    const holder = { disposed: false };
    if (!face) return { loaded, holder };
    for (const mood of MOODS) {
      const url = portraitUrl(symbol, mood);
      if (!url) continue;
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          if (holder.disposed) return texture.dispose();
          loaded[mood] = texture;
          invalidate();
        },
        undefined,
        () => {
          if (mood === "idle" && !holder.disposed) setMissing(symbol);
          invalidate();
        },
      );
    }
    return { loaded, holder };
  }, [symbol, face, invalidate]);
  useEffect(
    () => () => {
      half.holder.disposed = true;
      disposeAll(Object.values(half.loaded));
    },
    [half],
  );

  const cards = useMemo(() => {
    const loaded: Partial<Record<Mood, THREE.Texture>> = {};
    if (face) return loaded;
    const label = symbol ?? (name.trim().slice(0, 1).toUpperCase() || "?");
    const byPose = new Map<ChibiPose, THREE.Texture>();
    for (const mood of MOODS) {
      const pose = CARD_POSE[mood];
      if (!byPose.has(pose)) byPose.set(pose, cardTexture(symbol, label, color, pose, invalidate));
      loaded[mood] = byPose.get(pose);
    }
    return loaded;
    // The manifest arriving redraws the cards with the reaction art.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, face, name, color, manifestReady, invalidate]);
  useEffect(() => () => disposeAll(Object.values(cards)), [cards]);

  return { fallback: fallback.texture, fallbackFit: fallback.fit, loaded: face ? half.loaded : cards, face, card: !face };
}

const pick = (set: PortraitSet, mood: Mood) => set.loaded[mood] ?? set.loaded.idle ?? set.fallback;

function Portrait({ seat, day }: { seat: number; day: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const symbol = useStageStore((s) => s.model.seats[seat]?.symbol ?? null);
  const name = useStageStore((s) => s.model.seats[seat]?.name ?? "");
  const color = useStageStore((s) => s.model.seats[seat]?.color ?? "#3fb8f5");
  const mood = useStageStore((s) => s.model.seats[seat]?.mood ?? "idle");
  const reduced = useStageStore((s) => s.ui.reduced);
  const textures = usePortraitTextures(symbol, name, color, invalidate);
  const group = useRef<THREE.Group>(null);
  const halo = useMemo(() => radialTexture(0.05, 1.3), []);
  useEffect(() => () => halo.dispose(), [halo]);
  const spot = portraitSpot(seat, narrowness(aspect));
  // The crop line sits just under where the rim stops hiding things from the lens.
  const anchorY = Math.min(spot.p[1] + 2, hiddenBelow(aspect, spot.p[0], spot.p[2]) - 0.9);
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
          uSway: { value: 0 },
        },
      }),
    [seat],
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
    // camera doesn't see the cutouts squashed. The group's origin is the crop line, below the table's
    // edge, so leaning never lifts the cut into view.
    const camera = state.camera;
    const dx = camera.position.x - g.position.x;
    const dz = camera.position.z - g.position.z;
    const dy = camera.position.y - g.position.y;
    const win = fx.seat[seat];
    g.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.6, Math.atan2(dx, dz), 0, "YXZ");
    g.scale.setScalar(1 + 0.05 * win);

    const f = fade.current;
    const t = reduced ? 1 : Math.min(1, (performance.now() - f.at) / 260);
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    const a = pick(textures, f.from);
    const b = pick(textures, f.to);

    // Size and place the plane: half-body art by its face, a card by its width, the silhouette by its outline.
    const image = b.image as { width?: number; height?: number } | undefined;
    let figure = 0;
    if (textures.face && b !== textures.fallback && image?.width && image.height) {
      const face = textures.face;
      const imageAspect = image.width / image.height;
      const width = spot.ipd / face.ipd;
      const height = width / imageAspect;
      const cropTop = Math.min(0.98, face.crop ?? face.eyeY + MID_CHEST * face.ipd * imageAspect);
      const cropV = 1 - cropTop;
      mesh.scale.set(width, height, 1);
      mesh.position.set(0, height * (0.5 - cropV), 0);
      u.uCut.value.set(cropV, 0.035);
      figure = height * cropTop * 0.92;
    } else if (textures.card && b !== textures.fallback) {
      const width = spot.card;
      const height = (width * CARD_H) / CARD_W;
      mesh.scale.set(width, height, 1);
      mesh.position.set(0, height * 0.5 - 1.5, 0);
      u.uCut.value.set(0, 0.0001);
      figure = height * 0.8;
    } else if (textures.fallbackFit) {
      const fit = textures.fallbackFit;
      let width = spot.shoulder / fit.band;
      const tall = (fit.height * width) / fit.aspect;
      if (tall > spot.maxHeight) width *= spot.maxHeight / tall;
      const height = width / fit.aspect;
      mesh.scale.set(width, height, 1);
      mesh.position.set(-(fit.cx - 0.5) * width, height * (0.5 - fit.bottom), 0);
      u.uCut.value.set(fit.bottom, fit.height * 0.12);
      figure = fit.height * height;
    }
    const haloMesh = haloRef.current;
    if (haloMesh) {
      haloMesh.position.set(0, figure * 0.62, -0.8);
      haloMesh.scale.set(figure * 1.5, figure * 1.3, 1);
    }

    u.uA.value = a;
    u.uB.value = b;
    u.uMix.value = t;
    const shown = a.image as { width?: number; height?: number } | undefined;
    if (shown?.width && shown.height) u.uTexel.value.set(1 / shown.width, 1 / shown.height);
    u.uTime.value = state.clock.elapsedTime;
    u.uOuter.value = outer;
    u.uRim.value.set(color);
    u.uWarm.value.set(day ? "#fff4e6" : "#ffe6cc");
    u.uRimStrength.value = (day ? 0.35 : 0.85) * (1 + 1.6 * win);
    const base = day ? 0.95 : 0.92;
    // The room dims for a big moment; the winner stays in the spotlight.
    u.uLight.value = base * (0.3 + 0.7 * fx.room) + win * (day ? 0.4 : 0.5);
    if (haloMesh) (haloMesh.material as THREE.MeshBasicMaterial).opacity = (day ? 0 : 0.07) + win * (day ? 0.18 : 0.28);
    if (t < 1) invalidate();
  });

  return (
    <group ref={group} position={[spot.p[0], anchorY, spot.p[2]]}>
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
