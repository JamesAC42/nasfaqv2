import type { Metadata } from "next";
import { TipsPage } from "@/app/components/games/mahjong/learn/tips-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong tips", description: "Practical riichi advice for first games, getting better and table sense." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <TipsPage />;
}
