import type { Metadata } from "next";
import { Leaderboard } from "@/app/components/leaderboard/leaderboard";

export const metadata: Metadata = { title: "Leaderboard", description: "The richest players on the hololive stock market, by net worth." };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; coin?: string }> }) {
  const { tab, coin } = await searchParams;
  return <Leaderboard tab={tab === "talent" ? "talent" : "players"} coin={typeof coin === "string" ? coin : undefined} />;
}
