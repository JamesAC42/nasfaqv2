import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardPage } from "@/app/components/games/exchange/card-page";
import type { Rarity } from "@/app/lib/games/types";

const RARITIES = ["C", "R", "SR", "SSR", "UR"];

export async function generateMetadata({ params }: { params: Promise<{ symbol: string; rarity: string }> }): Promise<Metadata> {
  const { symbol, rarity } = await params;
  return { title: `${symbol.toUpperCase()} ${rarity.toUpperCase()} · Card Exchange` };
}

export default async function Page({ params }: { params: Promise<{ symbol: string; rarity: string }> }) {
  const { symbol, rarity } = await params;
  const upper = rarity.toUpperCase();
  if (!RARITIES.includes(upper) || !/^[A-Za-z0-9]{1,12}$/.test(symbol)) notFound();
  return <CardPage symbol={symbol.toUpperCase()} rarity={upper as Rarity} />;
}
