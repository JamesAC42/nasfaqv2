// Contract with the art pipeline (art-pipeline/spec/slots.json → art-pipeline/dist/manifest.json).
//
// Every image has an ID: `SYMBOL/slot/variant` for talent art (e.g. `PEK/card-ssr/default`,
// `PEK/reaction/hype`) and `_shared/slot/variant` for everything else (e.g. `_shared/howto-hero/default`).
// The UI looks images up by ID through the manifest and never hardcodes filenames (they carry a
// content hash). Missing IDs fall back to the slot's placeholder; missing art never breaks a page.
//
// Manifest v2 (proposed in art-pipeline/spec/ART_SPEC.md):
//   { "version": 2, "generated_at": "...",
//     "images": { "PEK/keyart/default": { "src": "PEK/keyart/default.3f2a1c9e.webp", "w": 1200, "h": 1500,
//                 "srcset": { "600": "...", "1200": "..." }, "anchors": { "eye_y": 0.24 } } } }
// Paths are relative to the manifest. The v1 shape (talents.keyart / talents.chibi / scenes) is still read.

export type ChibiPose = "idle" | "moon" | "cope" | "smug" | "shock" | "hype";

export type ArtAnchors = {
  /** Eye line as a fraction of height. */
  eye_y?: number;
  eye_x?: number;
  /** Feet line for full-body cutouts. */
  feet_y?: number;
  /** Point of interest for cropping, as [x, y] fractions. */
  focus?: [number, number];
};

export type ArtImage = {
  src: string;
  w: number;
  h: number;
  /** width → path */
  srcset?: Record<string, string>;
  anchors?: ArtAnchors;
};

// ── v1 shapes (current pipeline output) ────────────────────────────────────
export type ArtChibi = {
  sizes: Partial<Record<"128" | "256" | "512", string>>;
  blink?: Partial<Record<"128" | "256" | "512", string>> | null;
  loop?: string | null;
};

export type ArtKeyart = {
  src: string;
  srcset?: Partial<Record<"600" | "1200", string>>;
  w: number;
  h: number;
  eye_y?: number;
};

export type ArtTalent = {
  keyart?: ArtKeyart;
  chibi?: Partial<Record<ChibiPose, ArtChibi>>;
};

/** Kept for older manifests: non-talent art keyed by scene slot id. */
export type ArtScene = {
  src: string;
  srcset?: Partial<Record<"600" | "1200" | "2400", string>>;
  w: number;
  h: number;
};

export type ArtManifest = {
  version: number;
  generated_at?: string;
  images?: Record<string, ArtImage>;
  talents?: Record<string, ArtTalent>;
  scenes?: Record<string, ArtScene>;
};

const BASE = (process.env.NEXT_PUBLIC_ART_BASE_URL || "/art").replace(/\/$/, "");
export const ART_MANIFEST_URL = process.env.NEXT_PUBLIC_ART_MANIFEST_URL || `${BASE}/manifest.json`;
/** Where the browser fetches it: through the site when it lives on another host (see app/art-manifest.json). */
export const ART_MANIFEST_FETCH_URL = /^https?:\/\//.test(ART_MANIFEST_URL) ? "/art-manifest.json" : ART_MANIFEST_URL;

export const SHARED = "_shared";

export const artId = (owner: string, slot: string, variant = "default") => `${owner}/${slot}/${variant}`;
export const sharedArtId = (slot: string, variant = "default") => artId(SHARED, slot, variant);

/** Manifest paths are relative to the manifest file's location. */
export function resolveArtUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  // On a CDN: a full URL. Served from the site: a root-relative path, the same on server and client.
  if (/^https?:\/\//.test(ART_MANIFEST_URL)) return new URL(path, ART_MANIFEST_URL).href;
  return new URL(path, `http://localhost${ART_MANIFEST_URL.startsWith("/") ? "" : "/"}${ART_MANIFEST_URL}`).pathname;
}

/** Pick the smallest chibi export that is at least `px` wide (falls back to the largest). */
export function pickChibiSize(sizes: ArtChibi["sizes"] | null | undefined, px: number) {
  if (!sizes) return null;
  const available = (["128", "256", "512"] as const).filter((key) => sizes[key]);
  if (!available.length) return null;
  const match = available.find((key) => Number(key) >= px) ?? available[available.length - 1];
  return sizes[match] ?? null;
}

function fromV1(manifest: ArtManifest, id: string): ArtImage | null {
  const [owner, slot, variant = "default"] = id.split("/");
  if (owner === SHARED) {
    const scene = manifest.scenes?.[slot] ?? manifest.scenes?.[slot.replace("-", ".")];
    return scene ? { src: scene.src, w: scene.w, h: scene.h, srcset: scene.srcset as Record<string, string> | undefined } : null;
  }
  const talent = manifest.talents?.[owner];
  if (!talent) return null;
  if (slot === "keyart" && talent.keyart) {
    const art = talent.keyart;
    return { src: art.src, w: art.w, h: art.h, srcset: art.srcset as Record<string, string> | undefined, anchors: art.eye_y ? { eye_y: art.eye_y } : undefined };
  }
  if (slot === "reaction") {
    const blink = variant.endsWith("-blink");
    const pose = (blink ? variant.slice(0, -6) : variant) as ChibiPose;
    const chibi = talent.chibi?.[pose];
    const sizes = blink ? chibi?.blink : chibi?.sizes;
    if (!sizes) return null;
    const entries = Object.entries(sizes).filter(([, path]) => path) as [string, string][];
    if (!entries.length) return null;
    const [largest, src] = entries.sort((a, b) => Number(b[0]) - Number(a[0]))[0];
    return { src, w: Number(largest), h: Number(largest), srcset: Object.fromEntries(entries) };
  }
  return null;
}

/** Looks an image up by ID (v2), falling back to the v1 shape. */
export function lookupArt(manifest: ArtManifest | null | undefined, id: string): ArtImage | null {
  if (!manifest) return null;
  return manifest.images?.[id] ?? fromV1(manifest, id);
}

/** `srcset` attribute for an image, or undefined. */
export function artSrcSet(image: ArtImage) {
  if (!image.srcset) return undefined;
  const parts = Object.entries(image.srcset)
    .map(([w, path]) => (path ? `${resolveArtUrl(path)} ${w}w` : null))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}
