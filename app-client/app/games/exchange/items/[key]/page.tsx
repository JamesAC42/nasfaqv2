import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemPage } from "@/app/components/games/exchange/item-page";

export const metadata: Metadata = { title: "Capsule item · Exchange" };

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const cosmeticKey = decodeURIComponent(key);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,79}$/.test(cosmeticKey)) notFound();
  return <ItemPage cosmeticKey={cosmeticKey} />;
}
