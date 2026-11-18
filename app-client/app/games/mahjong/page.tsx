import type { Metadata } from "next";
import { MahjongLobby } from "@/app/components/games/mahjong/lobby/mahjong-lobby";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong", description: "Riichi mahjong on NASFAQ’s own tiles: practice against bots, play friends, sit at a table." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <MahjongLobby />;
}
