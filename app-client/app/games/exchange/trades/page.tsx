import type { Metadata } from "next";
import { TradesPage } from "@/app/components/games/exchange/trades-page";

export const metadata: Metadata = { title: "Trades · Card Exchange" };

export default function Page() {
  return <TradesPage />;
}
