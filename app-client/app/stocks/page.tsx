import type { Metadata } from "next";
import { Screener } from "@/app/components/stocks/screener";

export const metadata: Metadata = { title: "Stocks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <Screener initialView={view} />;
}
