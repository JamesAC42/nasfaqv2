import type { Metadata } from "next";
import { IndexesTab } from "@/app/components/market/indexes-tab";
import { MarketHub } from "@/app/components/market/market-hub";

export const metadata: Metadata = { title: "Indexes" };

export default async function Page({ searchParams }: { searchParams: Promise<{ index?: string }> }) {
  const { index } = await searchParams;
  return (
    <MarketHub tab="indexes">
      <IndexesTab initialIndex={index} />
    </MarketHub>
  );
}
