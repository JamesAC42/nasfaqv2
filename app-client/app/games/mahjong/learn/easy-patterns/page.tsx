import type { Metadata } from "next";
import { EasyPatternsPage } from "@/app/components/games/mahjong/learn/easy-patterns-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Five easy patterns", description: "The five mahjong yaku to reach for first, each with an example hand and the one trap to avoid." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <EasyPatternsPage />;
}
