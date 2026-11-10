import type { Metadata } from "next";
import { RulesPage } from "@/app/components/games/mahjong/learn/rules-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong rules", description: "The rule sheet this site plays by: calls, riichi, furiten, draws, scoring, clocks, rating and the money rules." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <RulesPage />;
}
