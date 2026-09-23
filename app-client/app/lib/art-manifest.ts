// Contract with the art pipeline (art-pipeline/dist/manifest.json).
// Keep in sync with the pipeline thread; any asset that doesn't exist yet is
// simply absent, and the UI falls back to a placeholder.

export type ChibiPose = "idle" | "moon" | "cope" | "smug" | "shock" | "hype";

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
  /** Eye line as a fraction of height, used to align heroes across talents. */
  eye_y?: number;
};

export type ArtTalent = {
  keyart?: ArtKeyart;
  chibi?: Partial<Record<ChibiPose, ArtChibi>>;
};

export type ArtManifest = {
  version: number;
  generated_at?: string;
  talents: Record<string, ArtTalent>;
  scenes?: Record<string, unknown>;
};

export const ART_MANIFEST_URL = process.env.NEXT_PUBLIC_ART_MANIFEST_URL || "/art/manifest.json";

/** Manifest paths are relative to the manifest file's location. */
export function resolveArtUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const base = typeof window === "undefined" ? `http://localhost${ART_MANIFEST_URL}` : new URL(ART_MANIFEST_URL, window.location.href).href;
  const resolved = new URL(path, base);
  return typeof window === "undefined" ? resolved.pathname : resolved.href;
}

/** Pick the smallest chibi export that is at least `px` wide (falls back to the largest). */
export function pickChibiSize(sizes: ArtChibi["sizes"] | null | undefined, px: number) {
  if (!sizes) return null;
  const available = (["128", "256", "512"] as const).filter((key) => sizes[key]);
  if (!available.length) return null;
  const match = available.find((key) => Number(key) >= px) ?? available[available.length - 1];
  return sizes[match] ?? null;
}
