import type { Metadata } from "next";
import { MarketPage } from "@/app/components/games/exchange/market-page";

export const metadata: Metadata = { title: "Card Exchange" };

export default function Page() {
  return <MarketPage />;
}
