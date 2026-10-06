import type { Metadata } from "next";
import { MarketHub } from "@/app/components/market/market-hub";
import { IpoTab } from "@/app/components/market/ipo-tab";

export const metadata: Metadata = { title: "IPO", description: "New talents coming to market: their channels as we track them, and the window to subscribe at the IPO price." };

export default function Page() {
  return (
    <MarketHub tab="ipo">
      <IpoTab />
    </MarketHub>
  );
}
