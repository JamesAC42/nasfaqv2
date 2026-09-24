import type { Metadata } from "next";
import { ActivityTab } from "@/app/components/market/activity-tab";
import { MarketHub } from "@/app/components/market/market-hub";

export const metadata: Metadata = { title: "Market activity" };

export default async function Page({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  return (
    <MarketHub tab="activity">
      <ActivityTab initialSymbol={typeof symbol === "string" ? symbol : ""} />
    </MarketHub>
  );
}
