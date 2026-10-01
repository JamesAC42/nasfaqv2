import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Arrow, Backdrop, Wordmark, accentOf, artDataUri, cardText, fetchApi, loadAssets, loadFonts, loadManifest, moneyShort } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ: the week's Dividend Review";

type Row = { symbol: string; display_name: string; rate: number };
type Review = { eval_date: string; dividends_total: number; fees_total: number; paying_count: number; charging_count: number; top_dividends: Row[]; top_fees: Row[] };

const pct = (rate: number) => `${rate >= 0 ? "+" : "-"}${Math.abs(rate * 100).toFixed(1)}%`;

function dateLabel(iso: string | undefined) {
  if (!iso) return "";
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** The latest Dividend Review: the best week's talent beside the totals and the top payers and fee-takers. */
export default async function Image() {
  const [review, assets, manifest, fonts] = await Promise.all([fetchApi<Review>("/api/market/evaluations/latest", 600), loadAssets(), loadManifest(), loadFonts()]);
  const top = review?.top_dividends?.[0] ?? null;
  const accent = top ? accentOf(assets.find((asset) => asset.symbol.toUpperCase() === top.symbol.toUpperCase())) : OG.blue;
  const keyart = top ? await artDataUri(manifest, `${top.symbol.toUpperCase()}/keyart/default`, 600) : null;
  const rows = [...(review?.top_dividends ?? []).slice(0, 3), ...(review?.top_fees ?? []).slice(0, 2)];
  const title = top ? `${cardText(top.display_name, 28)} pays ${pct(top.rate)}` : "Every Saturday, the market pays out";

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="80% 45%" />
        {keyart ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyart} width={540} height={680} alt="" style={{ position: "absolute", right: 0, top: -20, objectFit: "contain" }} />
        ) : null}
        <div style={{ position: "absolute", left: 600, top: 0, width: 200, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 15%, rgba(10,12,17,0))` }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 720, height: "100%" }}>
          <Wordmark size={36} />
          <div style={{ display: "flex", marginTop: 40, fontSize: 24, letterSpacing: 4, color: OG.blue }}>
            {`DIVIDEND REVIEW${review ? ` · ${dateLabel(review.eval_date)}` : ""}`}
          </div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: title.length > 26 ? 52 : 64, lineHeight: 1.04, marginTop: 12 }}>{title}</div>
          {review ? (
            <div style={{ display: "flex", gap: 44, marginTop: 26 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 50, color: OG.up }}>{moneyShort(review.dividends_total)}</div>
                <div style={{ display: "flex", fontSize: 20, color: OG.dim }}>{`PAID OUT · ${review.paying_count} STOCKS`}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 50, color: OG.down }}>{moneyShort(Math.abs(review.fees_total))}</div>
                <div style={{ display: "flex", fontSize: 20, color: OG.dim }}>{`IN FEES · ${review.charging_count} STOCKS`}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 28, color: OG.dim, marginTop: 22 }}>Dividends for the best weeks, share fees for the worst.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 28 }}>
            {rows.map((row) => (
              <div key={row.symbol} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
                <Arrow up={row.rate >= 0} color={row.rate >= 0 ? OG.up : OG.down} size={16} />
                <div style={{ display: "flex", width: 76, color: OG.ink }}>{row.symbol}</div>
                <div style={{ display: "flex", width: 380, color: OG.dim }}>{cardText(row.display_name, 26)}</div>
                <div style={{ display: "flex", color: row.rate >= 0 ? OG.up : OG.down }}>{pct(row.rate)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
