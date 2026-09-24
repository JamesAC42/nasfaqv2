import type { Metadata } from "next";
import { MarketHub } from "@/app/components/market/market-hub";
import { ReportTab } from "@/app/components/market/report-tab";

export const metadata: Metadata = { title: "Settlement report" };

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const { date, view } = await searchParams;
  return (
    <MarketHub tab="report">
      <ReportTab initialDate={date} initialView={view} />
    </MarketHub>
  );
}
