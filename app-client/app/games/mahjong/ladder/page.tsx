import type { Metadata } from "next";
import { LadderView } from "@/app/components/games/mahjong/records/ladder-view";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong ladder", description: "The season’s mahjong ladder, biggest hands and the yakuman wall." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <LadderView />;
}
