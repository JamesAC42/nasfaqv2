import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Backdrop, Wordmark, accentOf, artDataUri, cardText, fetchApi, loadAssets, loadFonts, loadManifest, moneyShort, signed } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 300;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ: the net worth leaderboard";

type Entry = { rank: number; username: string; profile_color: string | null; total_equity: number; change_pct: number | null; largest_position: { symbol: string } | null };

const MEDAL = ["#f5c542", "#c9d3e0", "#d08a4f"];

/** The leaderboard's share card: the top five by net worth (all-time change), the leader's biggest bag behind. */
export default async function Image() {
  const [board, assets, manifest, fonts] = await Promise.all([
    fetchApi<{ entries: Entry[] }>("/api/leaderboard?limit=5&window=all", 300),
    loadAssets(),
    loadManifest(),
    loadFonts(),
  ]);
  const entries = (board?.entries ?? []).slice(0, 5);
  const bag = entries[0]?.largest_position?.symbol?.toUpperCase() ?? null;
  const accent = bag ? accentOf(assets.find((asset) => asset.symbol.toUpperCase() === bag)) : OG.blue;
  const keyart = bag ? await artDataUri(manifest, `${bag}/keyart/default`, 600) : null;

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="84% 42%" />
        {keyart ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyart} width={460} height={600} alt="" style={{ position: "absolute", right: 0, top: 30, objectFit: "contain", opacity: 0.9 }} />
        ) : null}
        <div style={{ position: "absolute", left: 700, top: 0, width: 200, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 15%, rgba(10,12,17,0))` }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 820, height: "100%" }}>
          <Wordmark size={36} />
          <div style={{ display: "flex", marginTop: 38, fontSize: 24, letterSpacing: 4, color: OG.blue }}>LEADERBOARD · NET WORTH</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 70, lineHeight: 1.02, marginTop: 10 }}>{"Who's on top"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 30 }}>
            {entries.length ? (
              entries.map((entry, index) => {
                const change = entry.change_pct;
                const tone = change === null || Math.abs(change) < 0.00005 ? OG.dim : change > 0 ? OG.up : OG.down;
                return (
                  <div key={`${entry.rank}-${entry.username}`} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
                    <div style={{ display: "flex", width: 54, fontFamily: "Chicago", color: MEDAL[index] ?? OG.dim }}>{`#${entry.rank}`}</div>
                    <div style={{ display: "flex", width: 330, color: entry.profile_color || OG.ink }}>{cardText(entry.username, 18) || "player"}</div>
                    <div style={{ display: "flex", width: 150, fontFamily: "Chicago" }}>{moneyShort(entry.total_equity)}</div>
                    <div style={{ display: "flex", fontSize: 24, color: tone }}>{signed(change)}</div>
                  </div>
                );
              })
            ) : (
              <div style={{ display: "flex", fontSize: 28, color: OG.dim }}>Climb the board: buy your oshi, ride the ticks.</div>
            )}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
