// The oshiboard standard's numbers: its tier and size by rank, its colors (the player's color, moved
// lighter or darker until the oshimark stands out on it), and the outline of the cloth at each moment
// of its wave. Plain JavaScript so `npm test` can run it without a build (oshiboard-flag.test.mjs).

/** @typedef {"crown" | "silver" | "bronze" | "top10" | "member"} FlagTier */
/** @typedef {{ cloth: string; hi: string; lo: string; plate: string; edge: string; stitch: string; mark: string }} FlagColors */

/** Cloth coordinates (SVG user units): 100 wide, hanging from TOP, tails at TAIL, the notch at NOTCH. */
export const CLOTH = { width: 100, top: 12, tail: 160, notch: 136 };
/** The whole drawing: the cloth plus the rod's finials either side and the tassels below. */
export const VIEW = { x: -18, y: 0, width: 136, height: 184 };
/** Where the oshimark sits on the cloth, and its patch's radius. */
export const EMBLEM = { cx: 50, cy: 64, r: 30 };

const FALLBACK = "#3fb8f5";

/** @param {number} rank */
export function flagTier(rank) {
  if (rank === 1) return "crown";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  if (rank <= 10) return "top10";
  return "member";
}

/**
 * How big the standard is, from 1 (first place) down to 0 (100th and below): a step for each podium
 * place, then a steady slope, so every place up the board is a little bigger.
 * @param {number} rank
 */
export function flagScale(rank) {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  if (rank === 1) return 1;
  if (rank === 2) return 0.72;
  if (rank === 3) return 0.6;
  return Math.max(0, 0.48 * (1 - Math.log10(rank) / 2));
}

/** Cloth width in CSS pixels for a rank, between `min` (100th and below) and `max` (first). */
export function flagWidth(rank, min = 42, max = 84) {
  return Math.round(min + (max - min) * flagScale(rank));
}

// ── Color ────────────────────────────────────────────────────────────────

/** @param {string | null | undefined} value */
export function normalizeHex(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  return null;
}

/** @param {string} hex */
function rgbOf(hex) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
}

/** @param {number[]} rgb */
function hexOf(rgb) {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** @param {string} hex @returns {[number, number, number]} hue (0-360), saturation and lightness (0-1) */
function hslOf(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** @param {number} h @param {number} s @param {number} l */
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hexOf([f(0), f(8), f(4)]);
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/**
 * The lightness nearest `l` (same hue and saturation) whose color has at least `ratio` contrast with
 * `against`, searching both ways and keeping within [lo, hi]. If neither way gets there, the best seen.
 */
function lightnessAgainst(h, s, l, against, ratio, lo = 0.1, hi = 0.9) {
  if (contrast(hsl(h, s, l), against) >= ratio) return l;
  let best = l;
  let bestRatio = contrast(hsl(h, s, l), against);
  for (let step = 0.02; step <= 0.8; step += 0.02) {
    for (const next of [l - step, l + step]) {
      if (next < lo || next > hi) continue;
      const got = contrast(hsl(h, s, next), against);
      if (got >= ratio) return next;
      if (got > bestRatio) [best, bestRatio] = [next, got];
    }
  }
  return best;
}

/**
 * The standard's colors. The cloth is the player's color (saturation reined in a little so it reads as
 * dyed cloth, not a highlighter), moved lighter or darker until it stands apart from the talent's color,
 * which is the oshimark's main color. The patch behind the mark goes further the same way, so the
 * mark always has a ground it shows on, even when the player's color and the talent's are the same.
 * @param {string | null | undefined} playerColor
 * @param {string | null | undefined} talentColor
 * @returns {FlagColors}
 */
export function flagColors(playerColor, talentColor) {
  const base = normalizeHex(playerColor) ?? FALLBACK;
  const talent = normalizeHex(talentColor);
  const [h, s0, l0] = hslOf(base);
  const s = Math.min(s0, 0.8);
  let l = clamp(l0, 0.16, 0.84);
  if (talent) l = lightnessAgainst(h, s, l, talent, 1.6, 0.12, 0.86);

  // The patch: darker than the cloth under a light mark, lighter under a dark one.
  const markIsLight = talent ? luminance(talent) > 0.28 : l > 0.5;
  let plateL = clamp(markIsLight ? l - 0.16 : l + 0.16, 0.06, 0.94);
  if (talent) plateL = markIsLight ? Math.min(plateL, lightnessAgainst(h, s, plateL, talent, 3.2, 0.05, plateL)) : Math.max(plateL, lightnessAgainst(h, s, plateL, talent, 3.2, plateL, 0.95));

  const cloth = hsl(h, s, l);
  return {
    cloth,
    hi: hsl(h, s, clamp(l + 0.13, 0, 0.96)),
    lo: hsl(h, Math.min(1, s + 0.06), clamp(l - 0.17, 0.04, 1)),
    plate: hsl(h, s, plateL),
    edge: hsl(h, Math.min(1, s + 0.1), clamp(l - 0.34, 0.03, 0.4)),
    // Self-colored embroidery for the ranks without a metal trim: lighter on a dark cloth, darker on a light one.
    stitch: hsl(h, s * 0.9, l > 0.55 ? clamp(l - 0.26, 0.05, 1) : clamp(l + 0.26, 0, 0.95)),
    // The letter shown when a talent has no oshimark yet: the talent's own color if it shows on the patch.
    mark: talent && contrast(talent, hsl(h, s, plateL)) >= 3 ? talent : luminance(hsl(h, s, plateL)) > 0.4 ? "#141821" : "#f4f6fa",
  };
}

// ── Wave ─────────────────────────────────────────────────────────────────

const AMPLITUDE = 6.5;
const WAVELENGTH = 104;
const LENGTH = CLOTH.tail - CLOTH.top;

/** How free the cloth is at height y: pinned at the rod, swinging most at the tails. */
const slack = (y) => Math.max(0, (y - CLOTH.top) / LENGTH) ** 1.2;

/** The ripple's sideways shift at height y and phase p (radians); one full cycle per 2π. */
export function sway(y, p) {
  return AMPLITUDE * slack(y) * Math.sin((2 * Math.PI * (y - CLOTH.top)) / WAVELENGTH - p);
}

/** How far the cloth leans at height y and phase p, in degrees (for skewing what's printed on it). */
export function lean(y, p) {
  return (Math.atan((sway(y + 1, p) - sway(y - 1, p)) / 2) * 180) / Math.PI;
}

/** A second, shorter ripple that pulls the edges apart and together a little (the cloth billowing). */
const billow = (y, p) => 1.7 * slack(y) * Math.sin((2 * Math.PI * (y - CLOTH.top)) / (WAVELENGTH * 0.62) - 2 * p + 1.1);

const f1 = (value) => (Math.round(value * 10) / 10).toString();

/** Catmull-Rom through the points, as cubic Bézier segments starting from the first point. */
function smooth(points) {
  let d = "";
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d;
}

/** Tail tip positions at phase p, for the tassels. */
export function tips(p) {
  const lift = 1.6 * Math.sin(-p + 0.8);
  return {
    left: [sway(CLOTH.tail, p) - billow(CLOTH.tail, p), CLOTH.tail + lift],
    right: [CLOTH.width + sway(CLOTH.tail, p) + billow(CLOTH.tail, p), CLOTH.tail - lift],
  };
}

/** The cloth's outline at phase p: down the right edge, across the swallowtail, up the left edge. */
export function clothPath(p) {
  const ys = [];
  for (let y = CLOTH.top; y < CLOTH.tail; y += 14.8) ys.push(y);
  const right = ys.map((y) => [CLOTH.width + sway(y, p) + billow(y, p), y]);
  const left = ys.map((y) => [sway(y, p) - billow(y, p), y]).reverse();
  const tip = tips(p);
  right.push(tip.right);
  left.unshift(tip.left);
  const notch = [CLOTH.width / 2 + sway(CLOTH.notch, p), CLOTH.notch];
  return `M${f1(right[0][0])},${f1(right[0][1])}${smooth(right)} L${f1(notch[0])},${f1(notch[1])} L${f1(left[0][0])},${f1(left[0][1])}${smooth(left)} Z`;
}

/**
 * Keyframes for one full cycle of the wave (the last equals the first, so it loops without a seam).
 * @param {number} count frames, not counting the repeated first one
 */
export function waveFrames(count = 12) {
  const frames = [];
  for (let i = 0; i <= count; i += 1) {
    const p = (2 * Math.PI * (i % count)) / count;
    const tip = tips(p);
    frames.push({ p, d: clothPath(p), emblem: sway(EMBLEM.cy, p), lean: lean(EMBLEM.cy, p), left: tip.left, right: tip.right });
  }
  return frames;
}

/** The phase a still standard is drawn at (calm mode, the leaderboard's small ones): a gentle ripple. */
export const STILL_PHASE = 1.1;
/** One cycle's length on the gradient (the light and shade bands travel this far per cycle). */
export const SHADE_WAVELENGTH = WAVELENGTH;
