"use client";

// Canvas-drawn textures for the stage: the tile face atlas (from the site's own tile art), the felt,
// brushed brass, the room beyond the table, a portrait placeholder and soft glows. Each is built once.

import * as THREE from "three";
import { tileSvg, TILE_COLORS } from "@/app/components/games/mahjong/tile-art";
import { isRedFive, kindOf, type TileId } from "@/app/lib/games/mahjong/tiles";

// ── Tile faces ───────────────────────────────────────────────────────────────
export const ATLAS = { cols: 8, rows: 5, cellW: 256, cellH: 338 } as const;

/** Atlas cell for a tile: kinds 0-33, then the three red fives. */
export function cellOf(id: TileId): number {
  if (isRedFive(id)) return 34 + Math.floor(kindOf(id) / 9);
  return kindOf(id);
}

function svgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

let atlas: THREE.CanvasTexture | null = null;

/**
 * Every face in one texture. The drawing is tile-art's (stroke weight of a ~40 px tile, so lines stay
 * bold when the tile is small on screen), rasterized large; the shaded body rim is painted ivory because
 * the 3D tile supplies its own edges. Fills in asynchronously; `onReady` fires once it has.
 */
export function tileAtlas(onReady: () => void): THREE.CanvasTexture {
  if (atlas) {
    if (atlas.userData.ready) queueMicrotask(onReady);
    else (atlas.userData.waiters as (() => void)[]).push(onReady);
    return atlas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS.cols * ATLAS.cellW;
  canvas.height = ATLAS.rows * ATLAS.cellH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = TILE_COLORS.ivory;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData = { ready: false, waiters: [onReady] };
  atlas = texture;

  const jobs: Promise<void>[] = [];
  for (let cell = 0; cell < 37; cell++) {
    const kind = cell < 34 ? cell : [4, 13, 22][cell - 34];
    let svg = tileSvg(kind, { red: cell >= 34, labels: true, size: 40, edge: TILE_COLORS.ivory });
    svg = svg.replace(`fill="${TILE_COLORS.shade}"`, `fill="${TILE_COLORS.ivory}"`).replace(/width="\d+" height="\d+"/, 'width="240" height="320"');
    const col = cell % ATLAS.cols;
    const row = Math.floor(cell / ATLAS.cols);
    jobs.push(
      svgImage(svg).then((image) => {
        // The face proper: viewBox x 2-58, y 0-74 (the art is centered on y 37).
        ctx.drawImage(image, 8, 0, 224, 296, col * ATLAS.cellW, row * ATLAS.cellH, ATLAS.cellW, ATLAS.cellH);
      })
    );
  }
  Promise.allSettled(jobs).then(() => {
    texture.needsUpdate = true;
    texture.userData.ready = true;
    (texture.userData.waiters as (() => void)[]).forEach((run) => run());
    texture.userData.waiters = [];
  });
  return texture;
}

// ── Noise helpers ────────────────────────────────────────────────────────────
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// ── Felt ─────────────────────────────────────────────────────────────────────
/** Ink-navy cloth (cream by day) with a faint chart-paper grid woven in. */
export function feltTexture(day: boolean) {
  return canvasTexture(1024, 1024, (ctx) => {
    const random = rng(day ? 11 : 5);
    const base = day ? "#d9cba6" : "#0f1a33";
    const ink = day ? "27, 34, 51" : "150, 190, 255";
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 1024);
    // Nap: thousands of faint fibers.
    for (let i = 0; i < 26000; i++) {
      const x = random() * 1024;
      const y = random() * 1024;
      const light = random() < 0.5;
      ctx.fillStyle = light ? (day ? "rgba(255,255,255,0.10)" : "rgba(120,150,220,0.05)") : day ? "rgba(90,70,40,0.06)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(x, y, 1 + random() * 2, 1);
    }
    // Chart paper: minor lines, major lines every fifth.
    for (let i = 0; i <= 64; i++) {
      const at = Math.round((i / 64) * 1024) + 0.5;
      const major = i % 8 === 0;
      ctx.strokeStyle = `rgba(${ink}, ${major ? (day ? 0.22 : 0.14) : day ? 0.1 : 0.06})`;
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, 1024);
      ctx.moveTo(0, at);
      ctx.lineTo(1024, at);
      ctx.stroke();
    }
    // A faint center rosette under the plinth, and a soft vignette toward the rim.
    const glow = ctx.createRadialGradient(512, 512, 40, 512, 512, 560);
    glow.addColorStop(0, day ? "rgba(255,250,235,0.35)" : "rgba(60,100,180,0.16)");
    glow.addColorStop(0.55, "rgba(0,0,0,0)");
    glow.addColorStop(1, day ? "rgba(120,90,50,0.16)" : "rgba(0,0,0,0.42)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1024, 1024);
  });
}

// ── Brushed metal ────────────────────────────────────────────────────────────
/** Long horizontal streaks, used as a roughness map on the brass. */
export function brushedTexture() {
  const texture = canvasTexture(
    512,
    512,
    (ctx) => {
      const random = rng(3);
      ctx.fillStyle = "#7a7a7a";
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 1800; i++) {
        const y = random() * 512;
        const shade = Math.floor(90 + random() * 90);
        ctx.strokeStyle = `rgba(${shade},${shade},${shade},0.35)`;
        ctx.lineWidth = random() * 1.4 + 0.3;
        ctx.beginPath();
        const x = random() * 512;
        ctx.moveTo(x - 300, y);
        ctx.lineTo(x + 300, y + (random() - 0.5) * 2);
        ctx.stroke();
      }
    },
    false
  );
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

// ── The room ─────────────────────────────────────────────────────────────────
/** A wrap-around backdrop: a dark trading floor of out-of-focus screens by night, a pale wood room by day. */
export function roomTexture(day: boolean) {
  const texture = canvasTexture(2048, 512, (ctx) => {
    const random = rng(day ? 21 : 9);
    const W = 2048;
    const H = 512;
    if (day) {
      const wall = ctx.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, "#efe6d6");
      wall.addColorStop(0.55, "#e2d3b9");
      wall.addColorStop(1, "#b9a17c");
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, W, H);
      // Vertical slat paneling.
      for (let x = 0; x < W; x += 22) {
        ctx.fillStyle = `rgba(120, 86, 48, ${0.05 + random() * 0.07})`;
        ctx.fillRect(x, H * 0.18, 10 + random() * 4, H * 0.82);
      }
      ctx.filter = "blur(18px)";
      // Tall bright windows and warm lamps, well out of focus.
      for (let i = 0; i < 6; i++) {
        const x = (i / 6) * W + 100 + random() * 120;
        ctx.fillStyle = "rgba(255, 252, 240, 0.85)";
        ctx.fillRect(x, H * 0.12, 120, H * 0.5);
      }
      for (let i = 0; i < 26; i++) {
        const x = random() * W;
        const y = H * (0.35 + random() * 0.3);
        const r = 10 + random() * 26;
        ctx.fillStyle = `rgba(255, ${200 + Math.floor(random() * 40)}, 150, ${0.25 + random() * 0.3})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = "none";
      return;
    }
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#04060b");
    wall.addColorStop(0.5, "#0a0f1c");
    wall.addColorStop(1, "#05070c");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    ctx.filter = "blur(10px)";
    // Banks of distant monitors.
    const tones = ["63,184,245", "46,227,142", "255,68,96", "245,184,63", "138,214,255", "169,147,255"];
    for (let bank = 0; bank < 9; bank++) {
      const bx = (bank / 9) * W + random() * 60;
      const by = H * (0.36 + random() * 0.12);
      for (let i = 0; i < 6; i++) {
        const tone = tones[Math.floor(random() * tones.length)];
        const x = bx + (i % 3) * 52;
        const y = by + Math.floor(i / 3) * 34;
        ctx.fillStyle = `rgba(${tone}, ${0.2 + random() * 0.28})`;
        ctx.fillRect(x, y, 46, 28);
      }
    }
    ctx.filter = "blur(4px)";
    // Bokeh: soft discs of light.
    for (let i = 0; i < 90; i++) {
      const tone = tones[Math.floor(random() * tones.length)];
      const x = random() * W;
      const y = H * (0.22 + random() * 0.5);
      const r = 4 + random() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${tone}, ${0.3 + random() * 0.35})`);
      g.addColorStop(0.7, `rgba(${tone}, ${0.14 + random() * 0.14})`);
      g.addColorStop(1, `rgba(${tone}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A long ticker band around the room.
    ctx.filter = "blur(3px)";
    ctx.fillStyle = "rgba(63,184,245,0.10)";
    ctx.fillRect(0, H * 0.27, W, 10);
    for (let x = 0; x < W; x += 14 + random() * 30) {
      ctx.fillStyle = random() < 0.5 ? "rgba(46,227,142,0.35)" : "rgba(255,68,96,0.3)";
      ctx.fillRect(x, H * 0.27 + 2, 6 + random() * 12, 5);
    }
    ctx.filter = "none";
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// ── Glows ────────────────────────────────────────────────────────────────────
/** A soft white disc fading to nothing: halos, contact shadows, the lamp's glow. */
export function radialTexture(inner = 0, soft = 1) {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, inner * 128, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(Math.min(0.99, 0.35 * soft + inner), "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

/** A head-and-shoulders silhouette, shown while a portrait loads or if its file is missing. */
export function silhouetteTexture() {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "rgba(40, 46, 62, 0.92)";
    ctx.beginPath();
    ctx.ellipse(256, 230, 92, 108, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(60, 512);
    ctx.bezierCurveTo(70, 380, 150, 350, 256, 350);
    ctx.bezierCurveTo(362, 350, 442, 380, 452, 512);
    ctx.closePath();
    ctx.fill();
  });
}
