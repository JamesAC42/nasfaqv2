import type { Metadata } from "next";
import { Leaderboard, type LeaderboardTab } from "@/app/components/leaderboard/leaderboard";
import { serverFeatures } from "@/app/lib/features-server";

export const metadata: Metadata = { title: "Leaderboard", description: "The richest players on the hololive stock market, by net worth." };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; coin?: string }> }) {
  const { tab, coin } = await searchParams;
  // The Dividends tab is behind a flag: anyone without it who follows a link gets the players board.
  const dividends = tab === "dividends" && (await serverFeatures())["dividend-spotlight"] === true;
  const shown: LeaderboardTab = dividends ? "dividends" : tab === "talent" ? "talent" : "players";
  return <Leaderboard tab={shown} coin={typeof coin === "string" ? coin : undefined} />;
}
