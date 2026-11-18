import type { Metadata } from "next";
import { YakuPage } from "@/app/components/games/mahjong/learn/yaku-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong yaku", description: "Every yaku with its han, open and closed, and a pictured hand. Filter and search." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <YakuPage />;
}
