import type { Metadata } from "next";
import { Dossier } from "@/app/components/stock/dossier";

export async function generateMetadata({ params }: { params: Promise<{ stockName: string }> }): Promise<Metadata> {
  const { stockName } = await params;
  return { title: decodeURIComponent(stockName).toUpperCase() };
}

export default async function Page({ params }: { params: Promise<{ stockName: string }> }) {
  const { stockName } = await params;
  return <Dossier symbol={decodeURIComponent(stockName)} />;
}
