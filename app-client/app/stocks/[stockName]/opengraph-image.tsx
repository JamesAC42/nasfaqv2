import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Arrow, Backdrop, Wordmark, accentOf, alpha, artDataUri, loadAssets, loadFonts, loadManifest, money, sharedPlate, signed } from "@/app/lib/og";
import { unitLabel } from "@/app/lib/market-units";

export const runtime = "nodejs";
export const revalidate = 300;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ stock card";

/** The last 15 days of marks as an SVG path inside w×h. */
function sparkPath(values: number[], w: number, h: number) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  return values.map((value, index) => `${index ? "L" : "M"}${((index / (values.length - 1)) * w).toFixed(1)},${(h - ((value - lo) / span) * (h - 6) - 3).toFixed(1)}`).join(" ");
}

/** A stock's share card: key art on their colour, ticker, name, price and 15-day line. */
export default async function Image({ params }: { params: Promise<{ stockName: string }> }) {
  const { stockName } = await params;
  const symbol = decodeURIComponent(stockName).toUpperCase();
  const [assets, manifest, fonts] = await Promise.all([loadAssets(), loadManifest(), loadFonts()]);
  const asset = assets.find((entry) => entry.symbol.toUpperCase() === symbol);
  const accent = accentOf(asset);
  const plateId = sharedPlate(manifest, "market-og-stock");
  const [keyart, plate] = await Promise.all([artDataUri(manifest, `${symbol}/keyart/default`, 600), plateId ? artDataUri(manifest, plateId, 1200) : null]);
  const move = asset?.move_24h_pct ?? null;
  const tone = move === null || Math.abs(move) < 0.00005 ? OG.dim : move > 0 ? OG.up : OG.down;
  const marks = (asset?.sparkline_candles ?? []).map((candle) => candle.close_mark ?? candle.close).filter((value): value is number => typeof value === "number" && value > 0);
  const spark = sparkPath(marks, 520, 110);

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop plate={plate} glow={accent} glowAt="78% 45%" />
        {keyart ? (
          <img src={keyart} width={560} height={700} alt="" style={{ position: "absolute", right: 10, top: -8, objectFit: "contain" }} />
        ) : (
          <div style={{ position: "absolute", right: 90, top: 150, display: "flex", fontFamily: "Chicago", fontSize: 220, color: alpha(accent, 0.3) }}>{symbol}</div>
        )}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "56px 64px", width: 700, height: "100%" }}>
          <Wordmark size={38} />
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 64 }}>
            <div style={{ display: "flex", padding: "6px 14px", border: `2px solid ${accent}`, color: accent, fontSize: 26, letterSpacing: 3 }}>{symbol}</div>
            {asset?.unit ? <div style={{ display: "flex", fontSize: 24, color: OG.dim }}>{unitLabel(asset.unit)}</div> : null}
          </div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: (asset?.display_name?.length ?? 0) > 16 ? 58 : 70, lineHeight: 1.05, marginTop: 18 }}>{asset?.display_name ?? symbol}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginTop: 26 }}>
            <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 112, lineHeight: 1 }}>{money(asset?.current_mid_price)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 34, color: tone, marginBottom: 14 }}>
              {move !== null && Math.abs(move) >= 0.00005 ? <Arrow up={move > 0} color={tone} /> : null}
              {signed(move)}
            </div>
          </div>
          {spark ? (
            <svg width={520} height={110} viewBox="0 0 520 110" style={{ marginTop: 26 }}>
              <path d={spark} fill="none" stroke={accent} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          ) : null}
          <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: OG.dim }}>{spark ? "15 days · the hololive stock market" : "The hololive stock market"}</div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
