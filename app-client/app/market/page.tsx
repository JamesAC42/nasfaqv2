import type { Metadata } from "next";
import { FloorTab } from "@/app/components/market/floor-tab";
import { MarketHub } from "@/app/components/market/market-hub";

export const metadata: Metadata = { title: "Market" };

export default function Page() {
  return (
    <MarketHub tab="floor">
      <FloorTab />
    </MarketHub>
  );
}
