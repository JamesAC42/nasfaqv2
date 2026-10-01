import type { Metadata } from "next";
import { FloorTab } from "@/app/components/market/floor-tab";
import { MarketHub } from "@/app/components/market/market-hub";

export const metadata: Metadata = { title: "Market", description: "Today's movers, the order flow, and every talent's price on the hololive stock market." };

export default function Page() {
  return (
    <MarketHub tab="floor">
      <FloorTab />
    </MarketHub>
  );
}
