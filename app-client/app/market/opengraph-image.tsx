import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Arrow, Backdrop, Wordmark, accentOf, artDataUri, loadAssets, loadFonts, loadManifest, money, signed, type OgAsset } from "@/app/lib/og";

export const runtime = "nodejs";
// Drawn when asked for, from data cached for a few minutes (fetchApi / loadAssets). Prerendered at
// build, where the API can't be reached, the card shipped empty, and the first preview after a deploy
// (Discord's, which it keeps) got that copy while the fresh one regenerated.
export const dynamic = "force-dynamic";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ: today's movers on the hololive stock market";

/** The market's share card (and its tabs'): today's biggest movers up and down, the top one's key art behind. */
export default async function Image() {
  const [assets, manifest, fonts] = await Promise.all([loadAssets(), loadManifest(), loadFonts()]);
  const moved = assets.filter((asset) => typeof asset.move_24h_pct === "number" && Number.isFinite(asset.move_24h_pct) && (asset.current_mid_price ?? 0) > 0);
  const up = [...moved].sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0)).slice(0, 3);
  const down = [...moved].sort((a, b) => (a.move_24h_pct ?? 0) - (b.move_24h_pct ?? 0)).slice(0, 3);
  const lead = up[0];
  const accent = accentOf(lead);
  const keyart = lead ? await artDataUri(manifest, `${lead.symbol.toUpperCase()}/keyart/default`, 600) : null;

  const column = (label: string, rows: OgAsset[], isUp: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 300 }}>
      <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: isUp ? OG.up : OG.down }}>{label}</div>
      {rows.map((asset) => (
        <div key={asset.symbol} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26 }}>
          <div style={{ display: "flex", width: 72, color: accentOf(asset) }}>{asset.symbol}</div>
          <div style={{ display: "flex", width: 112, color: OG.ink }}>{money(asset.current_mid_price)}</div>
          <Arrow up={isUp} color={isUp ? OG.up : OG.down} size={14} />
          <div style={{ display: "flex", color: isUp ? OG.up : OG.down }}>{signed(asset.move_24h_pct)}</div>
        </div>
      ))}
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="82% 42%" />
        {keyart ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyart} width={500} height={640} alt="" style={{ position: "absolute", right: 0, top: -10, objectFit: "contain" }} />
        ) : null}
        <div style={{ position: "absolute", left: 640, top: 0, width: 200, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 15%, rgba(10,12,17,0))` }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 780, height: "100%" }}>
          <Wordmark size={36} />
          <div style={{ display: "flex", marginTop: 46, fontSize: 24, letterSpacing: 4, color: OG.blue }}>THE HOLOLIVE STOCK MARKET</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 76, lineHeight: 1.02, marginTop: 12 }}>{"Today's movers"}</div>
          {moved.length ? (
            <div style={{ display: "flex", gap: 36, marginTop: 40 }}>
              {column("UP", up, true)}
              {column("DOWN", down, false)}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 28, color: OG.dim, marginTop: 24 }}>Every talent is a stock, priced on their real YouTube numbers.</div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
