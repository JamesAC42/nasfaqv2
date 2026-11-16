// Where the stage's half-body talent portraits come from. The art lives outside the repo for now (a
// local, git-ignored overlay folder by default; NEXT_PUBLIC_MAHJONG_ART_BASE points it at a CDN), so
// only talents listed here are ever requested: anyone else gets the lit fallback card, with no 404s.

import type { Mood } from "@/app/components/games/mahjong/stage/model";

const BASE = (process.env.NEXT_PUBLIC_MAHJONG_ART_BASE || "/art/_overlay/mahjong-pilot/half").replace(/\/$/, "");

/**
 * Where the face sits in a talent's set (every mood is drawn to the same framing), as fractions of the
 * image: `eyeY` the eye line from the top, `ipd` the distance between the pupils over the image's width.
 * The stage scales each figure so the eyes come out the same distance apart (one head size for
 * everyone, whatever the hair, ears or hood add) and crops it a little under the collar. Measured by
 * hand on the 768x1024 exports: the outline alone can't tell a head from the ears, hood or hat above it.
 */
export type FaceMetrics = { eyeY: number; ipd: number };

const HALF_BODY: Record<string, FaceMetrics> = {
  PEK: { eyeY: 462 / 1024, ipd: 123 / 768 },
  GUR: { eyeY: 390 / 1024, ipd: 135 / 768 },
  SUI: { eyeY: 390 / 1024, ipd: 112 / 768 },
};

export const hasPortraitArt = (symbol: string | null | undefined): symbol is string => Boolean(symbol && Object.hasOwn(HALF_BODY, symbol));

export const faceMetrics = (symbol: string | null | undefined): FaceMetrics | null => (hasPortraitArt(symbol) ? HALF_BODY[symbol] : null);

/** The portrait for a talent and mood, or null when the talent has no half-body art yet. */
export function portraitUrl(symbol: string | null | undefined, mood: Mood): string | null {
  return hasPortraitArt(symbol) ? `${BASE}/${symbol}_${mood}.png` : null;
}
