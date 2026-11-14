import type { Metadata } from "next";
import { TournamentsList } from "@/app/components/games/mahjong/tournaments/tournaments-list";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong tournaments", description: "Knockout mahjong tournaments: four to a table, the top two go through." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <TournamentsList />;
}
