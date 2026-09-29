// Share images (next/og ImageResponse). Server only: reads the art manifest and the WebP exports,
// converts what it needs to PNG (satori doesn't read WebP), and draws the cards in JSX.
//
// Each card has a `_shared` plate slot (site-og-default, games-og-arcade, predictions-og,
// market-og-stock). When the manifest has one it becomes the background; otherwise the drawn
// version (key art collage / talent key art on a glow) is the design.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ART_MANIFEST_URL, lookupArt, sharedArtId, type ArtImage, type ArtManifest } from "@/app/lib/art-manifest";
import { talentAccent } from "@/app/lib/talent-color";

export const OG_SIZE = { width: 1200, height: 630 };

export const OG = {
  bg: "#0a0c11",
  ink: "#e9edf5",
  dim: "#8a93a6",
  blue: "#3fb8f5",
  up: "#2ee38e",
  down: "#ff5c7a",
  rule: "rgba(255,255,255,0.12)",
};

const API_BASE = process.env.SERVER_API_BASE || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";
const PUBLIC_DIR = path.join(process.cwd(), "public");

export type OgAsset = {
  symbol: string;
  display_name: string;
  unit?: string | null;
  color?: string | null;
  current_mid_price?: number | null;
  move_24h_pct?: number | null;
  volume_24h?: number | null;
  sparkline_candles?: Array<{ close?: number | null; close_mark?: number | null }>;
};

/** Listed talents from the API (cached for 5 minutes). Empty when the API is unreachable. */
export async function loadAssets(): Promise<OgAsset[]> {
  try {
    const response = await fetch(`${API_BASE}/api/market/assets`, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    const body = await response.json();
    const rows = Array.isArray(body) ? body : Array.isArray(body?.assets) ? body.assets : Array.isArray(body?.items) ? body.items : [];
    return rows.filter((row: OgAsset) => row && row.symbol);
  } catch {
    return [];
  }
}

function isAbsolute(url: string) {
  return /^https?:\/\//.test(url);
}

/** The art manifest: from the CDN when NEXT_PUBLIC_ART_BASE_URL is absolute, else from public/. */
export async function loadManifest(): Promise<ArtManifest | null> {
  try {
    if (isAbsolute(ART_MANIFEST_URL)) {
      const response = await fetch(ART_MANIFEST_URL, { next: { revalidate: 300 } });
      return response.ok ? ((await response.json()) as ArtManifest) : null;
    }
    return JSON.parse(await readFile(path.join(PUBLIC_DIR, ART_MANIFEST_URL.replace(/^\//, "")), "utf8")) as ArtManifest;
  } catch {
    return null;
  }
}

async function readArtFile(relative: string): Promise<Buffer | null> {
  try {
    if (isAbsolute(ART_MANIFEST_URL)) {
      const url = new URL(relative, ART_MANIFEST_URL).href;
      const response = await fetch(url, { next: { revalidate: 86400 } });
      return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    }
    const dir = path.dirname(path.join(PUBLIC_DIR, ART_MANIFEST_URL.replace(/^\//, "")));
    return await readFile(path.join(dir, relative));
  } catch {
    return null;
  }
}

/** Smallest export at least `width` wide. */
function pickSource(image: ArtImage, width: number) {
  const sizes = Object.entries(image.srcset ?? {})
    .map(([w, file]) => [Number(w), file] as const)
    .filter(([w, file]) => Number.isFinite(w) && file)
    .sort((a, b) => a[0] - b[0]);
  return sizes.find(([w]) => w >= width)?.[1] ?? image.src;
}

/** An art image as a PNG data URI at `width` px, or null when it's missing. */
export async function artDataUri(manifest: ArtManifest | null, id: string, width: number): Promise<string | null> {
  const image = lookupArt(manifest, id);
  if (!image) return null;
  const file = await readArtFile(pickSource(image, width));
  if (!file) return null;
  try {
    // Downscale and re-encode as PNG (small, and readable by every satori build).
    const sharp = (await import("sharp")).default;
    const png = await sharp(file).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 8 }).toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    // No sharp on this machine (it ships with Next as an optional dependency); satori can't read
    // WebP, so the card goes without the picture rather than failing.
    return null;
  }
}

/** A `_shared` plate for this card, if the pipeline shipped one. */
export function sharedPlate(manifest: ArtManifest | null, slot: string) {
  return lookupArt(manifest, sharedArtId(slot)) ? sharedArtId(slot) : null;
}

/** Talents with the given art, in the order given (e.g. busiest first). */
export function withArt(manifest: ArtManifest | null, symbols: string[], slot: string) {
  return symbols.filter((symbol) => lookupArt(manifest, `${symbol}/${slot}/default`));
}

/** Talents with the art, busiest first; falls back to whatever the manifest has. */
export function pickTalents(manifest: ArtManifest | null, assets: OgAsset[], slot: string, count: number) {
  const busiest = [...assets].sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0)).map((asset) => asset.symbol.toUpperCase());
  const fromManifest = Object.keys(manifest?.images ?? {})
    .map((id) => id.split("/"))
    .filter(([, s]) => s === slot)
    .map(([symbol]) => symbol);
  const ordered = [...new Set([...withArt(manifest, busiest, slot), ...fromManifest])];
  return ordered.slice(0, count);
}

export async function loadFonts() {
  const chicago = await readFile(path.join(process.cwd(), "app", "fonts", "ChicagoFLF.ttf"));
  return [{ name: "Chicago", data: chicago, weight: 400 as const, style: "normal" as const }];
}

export function accentOf(asset: OgAsset | undefined) {
  return talentAccent(asset?.color, "dark");
}

export function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}

/** "+1.23%" (plain ASCII signs: the display font has no − or ±). */
export function signed(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0.00%";
  const pct = value * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(2)}%`;
}

/** "#rrggbb" + alpha → rgba() (satori has no color-mix or 8-digit hex in gradients). */
export function alpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(63,184,245,${a})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Up/down arrow as a shape (the display font has no ▲▼). */
export function Arrow({ up, color, size = 22 }: { up: boolean; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10">
      <path d={up ? "M5 1 L9.5 9 H0.5 Z" : "M5 9 L9.5 1 H0.5 Z"} fill={color} />
    </svg>
  );
}

/** The NASFAQ wordmark: the blue diamond and the name. */
export function Wordmark({ size = 40 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.35 }}>
      <div style={{ width: size * 0.55, height: size * 0.55, background: OG.blue, transform: "rotate(45deg)", borderRadius: 3 }} />
      <div style={{ fontFamily: "Chicago", fontSize: size, color: OG.ink, lineHeight: 1 }}>nasfaq</div>
    </div>
  );
}

/** A full-bleed background: the shared plate if there is one, otherwise ink with a glow. */
export function Backdrop({ plate, glow = OG.blue, glowAt = "80% 40%" }: { plate?: string | null; glow?: string; glowAt?: string }) {
  if (plate) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={plate} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: "absolute", inset: 0, objectFit: "cover" }} />;
  }
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        background: `radial-gradient(circle at ${glowAt}, ${alpha(glow, 0.38)} 0%, ${alpha(glow, 0.1)} 34%, rgba(0,0,0,0) 64%), ${OG.bg}`,
      }}
    />
  );
}

/**
 * The collage cards (default, arcade, predictions): a title block on the left, a fan of talent art
 * on the right. `art` is "keyart" (cutouts, overlapping) or a card slot (framed cards, tilted).
 */
export async function collageCard({
  plateSlot,
  kicker,
  title,
  line,
  art,
  count = 4,
  extra,
}: {
  plateSlot: string;
  kicker: string;
  title: string;
  line: string;
  art: "keyart" | "card-ur" | "card-ssr";
  count?: number;
  extra?: React.ReactNode;
}) {
  const [assets, manifest, fonts] = await Promise.all([loadAssets(), loadManifest(), loadFonts()]);
  const plateId = sharedPlate(manifest, plateSlot);
  const plate = plateId ? await artDataUri(manifest, plateId, 1200) : null;
  const bySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  // With a plate the art is already in the picture; otherwise draw the talents.
  const symbols = plate ? [] : pickTalents(manifest, assets, art === "keyart" ? "keyart" : art, count);
  const images = await Promise.all(symbols.map((symbol) => artDataUri(manifest, `${symbol}/${art}/default`, art === "keyart" ? 420 : 300)));
  const talents = symbols.map((symbol, index) => ({ symbol, src: images[index], accent: accentOf(bySymbol.get(symbol)) })).filter((talent) => talent.src);
  const lead = talents[0]?.accent ?? OG.blue;

  const pieces =
    art === "keyart"
      ? talents.map((talent, index) => {
          const n = talents.length;
          const width = 340;
          const height = 425;
          const left = 590 + index * ((1200 - 590 - width + 20) / Math.max(1, n - 1));
          return (
            // Key art stands on the bottom edge; the cut at the top of the canvas fades out.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={talent.symbol}
              src={talent.src!}
              width={width}
              height={height}
              alt=""
              style={{ position: "absolute", left, top: 630 - height + (index % 2 ? 18 : 0), objectFit: "contain", maskImage: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,1) 22%)" }}
            />
          );
        })
      : talents.map((talent, index) => {
          const n = talents.length;
          const angle = (index - (n - 1) / 2) * 9;
          const left = 610 + index * 150;
          const frame = art === "card-ur" ? "linear-gradient(135deg, #ff7ad9, #ffd36e, #7dffcf, #6ecbff, #b28cff)" : "linear-gradient(135deg, #6b4e08, #f5c542, #fff6cf, #d9a520, #6b4e08)";
          return (
            <div
              key={talent.symbol}
              style={{
                position: "absolute",
                left,
                top: 120 + Math.abs(index - (n - 1) / 2) * 26,
                display: "flex",
                padding: 7,
                borderRadius: 18,
                backgroundImage: frame,
                transform: `rotate(${angle}deg)`,
                boxShadow: "0 20px 40px rgba(0,0,0,0.55)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={talent.src!} width={236} height={330} alt="" style={{ borderRadius: 12, objectFit: "cover" }} />
            </div>
          );
        });

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop plate={plate} glow={lead} glowAt="78% 50%" />
        {pieces}
        {art === "keyart" && pieces.length ? (
          // Soften the left edge of the first figure into the ink.
          <div style={{ position: "absolute", left: 560, top: 0, width: 190, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 12%, rgba(10,12,17,0))` }} />
        ) : null}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            padding: "56px 64px",
            width: 600,
            height: "100%",
          }}
        >
          <Wordmark size={38} />
          <div style={{ display: "flex", marginTop: 84, fontSize: 24, letterSpacing: 4, color: OG.blue }}>{kicker}</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: title.length > 18 ? 66 : 84, lineHeight: 1.02, marginTop: 14 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 28, lineHeight: 1.4, color: OG.dim, marginTop: 22, maxWidth: 500 }}>{line}</div>
          {extra ? <div style={{ display: "flex", marginTop: 34 }}>{extra}</div> : null}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}
