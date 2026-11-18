import type { Metadata } from "next";
import { LearnHub } from "@/app/components/games/mahjong/learn/learn-hub";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Learn mahjong", description: "Learn riichi mahjong from the tiles up: a walkthrough, guided hands, practice against bots, and the rule sheet, yaku, glossary and tips for reference." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <LearnHub />;
}
