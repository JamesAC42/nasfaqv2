import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TournamentView } from "@/app/components/games/mahjong/tournaments/tournament-view";
import { tournamentCardPath } from "@/app/components/games/mahjong/share/share-links";
import { mahjongServerGet } from "@/app/components/games/mahjong/share/server-api";
import { requireFeature } from "@/app/lib/features-server";
import type { TournamentResponse } from "@/app/lib/games/mahjong/types";

type Props = { params: Promise<{ id: string }> };

const idOf = (value: string) => (/^[1-9]\d{0,9}$/.test(value) ? Number(value) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireFeature("mahjong");
  const tournamentId = idOf((await params).id);
  const payload = tournamentId ? await mahjongServerGet<TournamentResponse>(`/tournaments/${tournamentId}`) : null;
  if (!payload) return { title: "Mahjong tournament" };
  const { tournament } = payload;
  const champion = tournament.result?.champion;
  const title = tournament.name;
  const description = champion ? `${champion.name} won this ${tournament.seats}-player mahjong knockout.` : `A ${tournament.seats}-player knockout mahjong tournament on NASFAQ. Four to a table, the top two go through.`;
  const image = { url: tournamentCardPath(tournament.id), width: 1200, height: 630, alt: description };
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image.url] } };
}

export default async function Page({ params }: Props) {
  await requireFeature("mahjong");
  const tournamentId = idOf((await params).id);
  if (!tournamentId) notFound();
  return <TournamentView id={tournamentId} />;
}
