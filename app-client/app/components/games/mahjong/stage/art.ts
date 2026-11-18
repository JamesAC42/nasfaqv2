// Where the stage's half-body talent portraits come from: the site's art manifest, entries
// `SYM/half/<mood>` with `eye_y` and `ipd` anchors (the rule is in lib/mahjong-portrait-art.mjs). Only
// talents with a complete, well-formed set are ever requested; anyone else gets the lit fallback card,
// with no 404s.

import { textureArtUrl, type ArtManifest } from "@/app/lib/art-manifest";
import { PORTRAIT_PENDING, resolvePortrait, type FaceMetrics, type PortraitOverlay, type PortraitSource } from "@/app/lib/mahjong-portrait-art.mjs";
import type { Mood } from "@/app/components/games/mahjong/stage/model";

/**
 * Where the face sits in a talent's set (every mood is drawn to the same framing), as fractions of the
 * image: `eyeY` the eye line from the top, `ipd` the distance between the pupils over the image's width.
 * The stage scales each figure so the eyes come out the same distance apart (one head size for
 * everyone, whatever the hair, ears or hood add) and places it by the eye line, so every talent shows
 * the same stretch of body above the table's rim. The manifest's anchors carry them (measured by the
 * art kit: the outline alone can't tell a head from the ears, hood or hat above it).
 */
export type { FaceMetrics };

/** A talent's portraits: where the face is and one texture URL per mood. */
export type PortraitArt = { face: FaceMetrics; urls: Record<Mood, string> };

// ── Development only: the local overlay from before the art was in the manifest ──────────────────
// The pilot set lives in a git-ignored folder on dev machines (NEXT_PUBLIC_MAHJONG_ART_BASE can point
// elsewhere). Used when that variable is set, or for a talent the manifest has no half-body entries
// for. Production never reads it (Next inlines NODE_ENV, so this is dropped from the build). Delete
// this block, and the `overlay` argument below, once the launch set is uploaded.
const DEV_OVERLAY: PortraitOverlay | null =
  process.env.NODE_ENV !== "production"
    ? {
        base: process.env.NEXT_PUBLIC_MAHJONG_ART_BASE || "/art/_overlay/mahjong-pilot/half",
        explicit: Boolean(process.env.NEXT_PUBLIC_MAHJONG_ART_BASE),
        // Measured by hand on the 768x1024 exports.
        table: {
          PEK: { eyeY: 462 / 1024, ipd: 123 / 768 },
          GUR: { eyeY: 390 / 1024, ipd: 135 / 768 },
          SUI: { eyeY: 390 / 1024, ipd: 112 / 768 },
        },
      }
    : null;

// One object per distinct set of files, so the stage's texture memo sees the same reference when the
// manifest arrives with the same answer (no reload, no flash).
const cache = new Map<string, PortraitArt>();

function toArt(source: PortraitSource): PortraitArt | null {
  const urls = {} as Record<Mood, string>;
  for (const [mood, file] of Object.entries(source.files) as [Mood, string][]) {
    const url = source.from === "manifest" ? textureArtUrl(file) : file;
    if (!url) return null;
    urls[mood] = url;
  }
  const key = `${source.face.eyeY}|${source.face.ipd}|${Object.values(urls).join("|")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const art = { face: source.face, urls };
  cache.set(key, art);
  return art;
}

/**
 * A talent's portrait art, null when they have none (the lit card), or "pending" while the manifest is
 * still loading and could change the answer (the stage shows its plain silhouette and requests nothing).
 * `settled`: the manifest has loaded, or is known to be missing.
 */
export function portraitArt(manifest: ArtManifest | null, settled: boolean, symbol: string | null | undefined): PortraitArt | null | typeof PORTRAIT_PENDING {
  const source = resolvePortrait({ images: manifest?.images, settled, symbol, overlay: DEV_OVERLAY });
  if (source === PORTRAIT_PENDING || source === null) return source;
  return toArt(source);
}

export { PORTRAIT_PENDING };
