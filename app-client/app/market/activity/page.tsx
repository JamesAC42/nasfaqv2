import type { Metadata } from "next";
import { ActivityTab } from "@/app/components/market/activity-tab";
import { MarketHub } from "@/app/components/market/market-hub";

export const metadata: Metadata = { title: "Market activity" };

export default function Page() {
  return (
    <MarketHub tab="activity">
      <ActivityTab />
    </MarketHub>
  );
}
