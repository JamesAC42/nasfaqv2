import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Backdrop, Wordmark, artDataUri, cardText, fetchApi, loadFonts, loadManifest, remoteImageDataUri } from "@/app/lib/og";
import { talentAccent } from "@/app/lib/talent-color";

export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A NASFAQ article";

type Article = {
  title: string;
  thumbnail_url: string | null;
  is_news: boolean;
  related_assets?: Array<{ symbol: string; display_name: string; color: string | null }>;
};

/**
 * An article's share card: its thumbnail full-bleed under the headline when it has one (news
 * thumbnails are drawn for the story); otherwise the first talent it's about, on their colour.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [body, manifest, fonts] = await Promise.all([fetchApi<{ article: Article }>(`/api/articles/${encodeURIComponent(decodeURIComponent(slug))}`, 3600), loadManifest(), loadFonts()]);
  const article = body?.article ?? null;
  const talent = article?.related_assets?.[0] ?? null;
  const accent = talent ? talentAccent(talent.color, "dark") : OG.blue;
  const [thumbnail, keyart] = await Promise.all([
    remoteImageDataUri(article?.thumbnail_url, 1200),
    article?.thumbnail_url || !talent ? null : artDataUri(manifest, `${talent.symbol.toUpperCase()}/keyart/default`, 600),
  ]);
  const title = cardText(article?.title ?? "NASFAQ news", 110);
  const kicker = article?.is_news ? "HOLOLIVE NEWS" : "ARTICLE";

  if (thumbnail) {
    return new ImageResponse(
      (
        <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: "absolute", inset: 0, objectFit: "cover" }} />
          {/* Shade the corner under the wordmark, and a solid band under the headline (thumbnails are bright). */}
          <div style={{ position: "absolute", left: 0, top: 0, width: 520, height: 160, display: "flex", background: "radial-gradient(ellipse at 0% 0%, rgba(10,12,17,0.85) 0%, rgba(10,12,17,0) 70%)" }} />
          <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 300, display: "flex", background: "linear-gradient(180deg, rgba(10,12,17,0) 0%, rgba(10,12,17,0.88) 38%, rgba(10,12,17,0.96) 100%)" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 56px", width: "100%", height: "100%" }}>
            <Wordmark size={34} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: OG.blue }}>{kicker}</div>
              <div style={{ display: "flex", fontFamily: "Chicago", fontSize: title.length > 70 ? 42 : 52, lineHeight: 1.1, marginTop: 10, maxWidth: 1080 }}>{title}</div>
            </div>
          </div>
        </div>
      ),
      { ...size, fonts }
    );
  }

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="82% 45%" />
        {keyart ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={keyart} width={500} height={640} alt="" style={{ position: "absolute", right: 0, top: -10, objectFit: "contain" }} />
        ) : (
          // Nothing to picture: the wordmark's diamond, large, in outline.
          <div style={{ position: "absolute", right: 150, top: 175, width: 280, height: 280, display: "flex", border: `10px solid ${OG.blue}`, borderRadius: 18, transform: "rotate(45deg)", opacity: 0.55 }} />
        )}
        <div style={{ position: "absolute", left: 640, top: 0, width: 200, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 15%, rgba(10,12,17,0))` }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 800, height: "100%" }}>
          <Wordmark size={36} />
          <div style={{ display: "flex", marginTop: 60, fontSize: 24, letterSpacing: 4, color: OG.blue }}>{kicker}</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: title.length > 60 ? 46 : 58, lineHeight: 1.1, marginTop: 14 }}>{title}</div>
          {talent ? <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: accent }}>{`${talent.symbol} · ${cardText(talent.display_name, 36)}`}</div> : null}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
