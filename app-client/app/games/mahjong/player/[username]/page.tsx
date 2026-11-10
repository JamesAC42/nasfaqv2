import type { Metadata } from "next";
import { PlayerView } from "@/app/components/games/mahjong/records/player-view";
import { requireFeature } from "@/app/lib/features-server";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireFeature("mahjong");
  const { username } = await params;
  return { title: `${decodeURIComponent(username)}: mahjong record` };
}

export default async function Page({ params }: Props) {
  await requireFeature("mahjong");
  const { username } = await params;
  return <PlayerView username={decodeURIComponent(username)} />;
}
