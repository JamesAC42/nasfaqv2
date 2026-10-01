import type { Metadata } from "next";
import { MarketHub } from "@/app/components/market/market-hub";
import { DividendsTab } from "@/app/components/market/dividends-tab";

export const metadata: Metadata = { title: "Dividend Review", description: "Every Saturday: who paid dividends, who charged share fees, and how max shares changed." };

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  return (
    <MarketHub tab="dividends">
      <DividendsTab initialDate={week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : undefined} />
    </MarketHub>
  );
}
