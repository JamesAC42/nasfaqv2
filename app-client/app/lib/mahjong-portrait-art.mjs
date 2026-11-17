// Which talents the 3D mahjong table draws as half-body portraits, and from which files. Plain
// JavaScript so `npm test` runs it without a build (mahjong-portrait-art.test.mjs); the stage reads it
// through components/games/mahjong/stage/art.ts, which supplies the manifest, the environment and the
// final URLs.
//
// The art is four manifest entries per talent, `SYM/half/<mood>` for idle, think, riichi and win, each
// with `anchors.eye_y` (the eye line, a fraction of the image's height) and `anchors.ipd` (the distance
// between the pupils, a fraction of its width). Every mood is drawn to the same framing, so the stage
// places the whole set by the idle image's anchors. A talent with a missing mood or a missing or odd
// anchor gets no portrait at all (the lit card instead): no partial sets, no requests for files that
// aren't there.

/** @typedef {"idle" | "think" | "riichi" | "win"} PortraitMood */
/** @typedef {{ eyeY: number, ipd: number }} FaceMetrics */
/** @typedef {{ src?: unknown, srcset?: Record<string, unknown> | null, anchors?: { eye_y?: unknown, ipd?: unknown } | null }} PortraitImage */
/** @typedef {Record<string, PortraitImage | undefined>} PortraitImages */
/**
 * Where a talent's portraits come from. `from: "manifest"`: `files` are manifest paths (relative to the
 * manifest, still to be turned into URLs). `from: "overlay"`: `files` are URLs into the local overlay.
 * @typedef {{ from: "manifest" | "overlay", face: FaceMetrics, files: Record<PortraitMood, string> }} PortraitSource
 */
/**
 * The pre-manifest overlay (development only): a folder of `SYM_<mood>.png` files and the hand-measured
 * face metrics of the talents in it. `explicit` when NEXT_PUBLIC_MAHJONG_ART_BASE was set.
 * @typedef {{ base: string, explicit: boolean, table: Record<string, FaceMetrics> }} PortraitOverlay
 */

/** @type {readonly PortraitMood[]} */
export const PORTRAIT_MOODS = ["idle", "think", "riichi", "win"];
export const PORTRAIT_SLOT = "half";
/** The uploaded images are this wide; the stage draws them a few hundred pixels tall, so no wider export is needed. */
export const PORTRAIT_MAX_WIDTH = 768;
export const EYE_Y_RANGE = /** @type {const} */ ([0.1, 0.8]);
export const IPD_RANGE = /** @type {const} */ ([0.05, 0.4]);
/** The answer while the manifest is still loading and could change it: draw the plain silhouette, request nothing. */
export const PORTRAIT_PENDING = "pending";

/** @param {string} symbol @param {PortraitMood} mood */
export const portraitArtId = (symbol, mood) => `${symbol}/${PORTRAIT_SLOT}/${mood}`;

/** @param {unknown} value @param {readonly [number, number]} range */
const inRange = (value, [low, high]) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

/**
 * The file to load for a texture: the widest srcset export no wider than `maxWidth`, else `src`.
 * @param {PortraitImage} image
 * @returns {string | null}
 */
export function pickTexturePath(image, maxWidth = PORTRAIT_MAX_WIDTH) {
  let best = null;
  let bestWidth = -1;
  for (const [key, path] of Object.entries(image.srcset ?? {})) {
    const width = Number(key);
    if (typeof path !== "string" || !path || !Number.isFinite(width) || width > maxWidth || width <= bestWidth) continue;
    best = path;
    bestWidth = width;
  }
  if (best) return best;
  return typeof image.src === "string" && image.src ? image.src : null;
}

/**
 * A talent's portrait set from the manifest, or null unless all four moods are there with usable anchors.
 * @param {PortraitImages | null | undefined} images the manifest's `images`
 * @param {string} symbol
 * @returns {PortraitSource | null}
 */
export function manifestPortrait(images, symbol) {
  if (!images) return null;
  /** @type {Partial<Record<PortraitMood, string>>} */
  const files = {};
  /** @type {FaceMetrics | null} */
  let face = null;
  for (const mood of PORTRAIT_MOODS) {
    const image = Object.hasOwn(images, portraitArtId(symbol, mood)) ? images[portraitArtId(symbol, mood)] : undefined;
    if (!image || typeof image !== "object") return null;
    const anchors = image.anchors;
    if (!anchors || !inRange(anchors.eye_y, EYE_Y_RANGE) || !inRange(anchors.ipd, IPD_RANGE)) return null;
    const path = pickTexturePath(image);
    if (!path) return null;
    files[mood] = path;
    if (mood === "idle") face = { eyeY: /** @type {number} */ (anchors.eye_y), ipd: /** @type {number} */ (anchors.ipd) };
  }
  return face ? { from: "manifest", face, files: /** @type {Record<PortraitMood, string>} */ (files) } : null;
}

/**
 * Whether the manifest lists any half-body image for the talent, complete or not.
 * @param {PortraitImages | null | undefined} images
 * @param {string} symbol
 */
export const hasHalfEntries = (images, symbol) => Boolean(images) && Object.keys(/** @type {PortraitImages} */ (images)).some((id) => id.startsWith(`${symbol}/${PORTRAIT_SLOT}/`));

/**
 * Where a seat's portraits come from: a source, null (no portrait: the lit card), or PORTRAIT_PENDING
 * while the manifest hasn't settled (loaded, or known to be missing) and could still decide it.
 *
 * Only the manifest counts, except in development (`overlay` is passed only there; delete it once the
 * launch set is uploaded): an explicit overlay base wins for the overlay's talents, and otherwise the
 * overlay stands in for a talent with no half-body entries at all. A partial set in the manifest is
 * not masked by the overlay, so a bad upload shows up as a card.
 *
 * @param {{ images: PortraitImages | null | undefined, settled: boolean, symbol: string | null | undefined, overlay?: PortraitOverlay | null }} input
 * @returns {PortraitSource | null | typeof PORTRAIT_PENDING}
 */
export function resolvePortrait({ images, settled, symbol, overlay = null }) {
  if (!symbol) return null;
  const legacy = overlay && Object.hasOwn(overlay.table, symbol) ? overlay.table[symbol] : null;
  /** @returns {PortraitSource} */
  const fromOverlay = () => {
    const base = /** @type {PortraitOverlay} */ (overlay).base.replace(/\/$/, "");
    const files = /** @type {Record<PortraitMood, string>} */ (Object.fromEntries(PORTRAIT_MOODS.map((mood) => [mood, `${base}/${symbol}_${mood}.png`])));
    return { from: "overlay", face: /** @type {FaceMetrics} */ (legacy), files };
  };
  if (legacy && overlay?.explicit) return fromOverlay();
  if (!settled) return PORTRAIT_PENDING;
  const listed = manifestPortrait(images, symbol);
  if (listed) return listed;
  if (legacy && !hasHalfEntries(images, symbol)) return fromOverlay();
  return null;
}
