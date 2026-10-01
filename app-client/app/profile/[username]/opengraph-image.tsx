import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Arrow, Backdrop, Wordmark, alpha, artDataUri, cardText, fetchApi, loadFonts, loadManifest, moneyShort, remoteImageDataUri, signed } from "@/app/lib/og";
import { talentAccent } from "@/app/lib/talent-color";

export const runtime = "nodejs";
export const revalidate = 600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A NASFAQ player";

type Profile = {
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
  rank: number | null;
  oshi_coin: { symbol: string; display_name: string; color: string | null } | null;
  stats: {
    cash_balance: number;
    credit_balance?: number;
    total_market_value: number;
    total_equity: number;
    starting_net_worth?: number | null;
    trade_count: number;
  };
};

/** A player's share card: avatar, rank, net worth and all-time change, with their oshi's key art. */
export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [bundle, manifest, fonts] = await Promise.all([fetchApi<{ profile: Profile }>(`/api/profiles/${encodeURIComponent(decodeURIComponent(username))}`, 600), loadManifest(), loadFonts()]);
  const profile = bundle?.profile ?? null;
  const oshi = profile?.oshi_coin?.symbol?.toUpperCase() ?? null;
  const accent = oshi ? talentAccent(profile?.oshi_coin?.color, "dark") : profile?.profile_color || OG.blue;
  const [avatar, keyart] = await Promise.all([remoteImageDataUri(profile?.profile_picture_url, 400), oshi ? artDataUri(manifest, `${oshi}/keyart/default`, 600) : null]);
  const bigAvatar = keyart ? null : avatar;
  const stats = profile?.stats;
  const start = stats?.starting_net_worth ?? null;
  const change = stats && start ? (stats.total_equity - start) / start : null;
  const tone = change === null || Math.abs(change) < 0.00005 ? OG.dim : change > 0 ? OG.up : OG.down;
  const name = cardText(profile?.username ?? decodeURIComponent(username), 22) || "player";

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="82% 45%" />
        {keyart ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyart} width={520} height={660} alt="" style={{ position: "absolute", right: 0, top: -14, objectFit: "contain" }} />
        ) : bigAvatar ? (
          // No oshi: their avatar, large, on their colour.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bigAvatar} width={380} height={380} alt="" style={{ position: "absolute", right: 90, top: 125, borderRadius: 190, border: `8px solid ${accent}`, objectFit: "cover" }} />
        ) : null}
        <div style={{ position: "absolute", left: 640, top: 0, width: 200, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 15%, rgba(10,12,17,0))` }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 780, height: "100%" }}>
          <Wordmark size={36} />
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 44 }}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} width={128} height={128} alt="" style={{ borderRadius: 64, border: `4px solid ${profile?.profile_color || accent}`, objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", width: 128, height: 128, borderRadius: 64, background: alpha(accent, 0.25), border: `4px solid ${accent}` }} />
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, color: OG.blue }}>
                {profile?.rank ? `PLAYER · RANK #${profile.rank}` : "PLAYER"}
              </div>
              <div style={{ display: "flex", fontFamily: "Chicago", fontSize: name.length > 14 ? 52 : 66, lineHeight: 1.04, marginTop: 6, color: profile?.profile_color || OG.ink }}>{name}</div>
            </div>
          </div>
          {stats ? (
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: 40 }}>
                <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 92, lineHeight: 1 }}>{moneyShort(stats.total_equity)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 32, color: tone, marginBottom: 10 }}>
                  {change !== null && Math.abs(change) >= 0.00005 ? <Arrow up={change > 0} color={tone} /> : null}
                  {`${signed(change)} all time`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 30, fontSize: 24, color: OG.dim, marginTop: 22 }}>
                <div style={{ display: "flex" }}>{`${moneyShort(stats.cash_balance)} cash`}</div>
                {stats.credit_balance !== undefined ? <div style={{ display: "flex" }}>{`${moneyShort(stats.credit_balance)} Credit`}</div> : null}
                <div style={{ display: "flex" }}>{`${moneyShort(stats.total_market_value)} in stocks`}</div>
              </div>
              <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: OG.dim }}>
                {`${stats.trade_count.toLocaleString("en-US")} trades${profile?.oshi_coin ? ` · oshi: ${cardText(profile.oshi_coin.display_name, 30)}` : ""}`}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 28, color: OG.dim, marginTop: 30 }}>A player on the hololive stock market.</div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
