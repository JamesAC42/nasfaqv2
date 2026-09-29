import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeBuilder } from "@/app/components/games/exchange/trade-builder";

export const metadata: Metadata = { title: "New trade · Card Exchange" };

export default function Page() {
  return (
    <Suspense>
      <TradeBuilder />
    </Suspense>
  );
}
