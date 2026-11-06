import type { Metadata } from "next";
import { MomentView } from "@/app/components/games/share/moment-view";
import { fetchMoment } from "@/app/lib/og-moment";
import { cleanSymbol, isMomentKind, momentCardPath, momentSummary, type MomentKind } from "@/app/lib/games/moments";

type Props = { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load({ params, searchParams }: Props) {
  const [{ kind, id }, query] = await Promise.all([params, searchParams]);
  const talent = cleanSymbol(typeof query.t === "string" ? query.t : null);
  const decoded = decodeURIComponent(id);
  const moment = isMomentKind(kind) ? await fetchMoment(kind, decoded) : null;
  return { kind: kind as MomentKind, id: decoded, talent, moment };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { kind, id, talent, moment } = await load(props);
  if (!moment) return { title: "Moment not found · Arcade" };
  const title = moment.kind === "blackjack" ? `${moment.player.username} at blackjack` : `${moment.player.username}'s ${moment.best.rarity} pull`;
  const description = `${momentSummary(moment)} Play the hololive fan stock market's arcade on play money.`;
  const image = { url: momentCardPath(kind, id, talent), width: 1200, height: 630, alt: momentSummary(moment) };
  return {
    title,
    description,
    openGraph: { title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function Page(props: Props) {
  const { kind, id, talent, moment } = await load(props);
  return <MomentView kind={kind} id={id} talent={talent} moment={moment} />;
}
