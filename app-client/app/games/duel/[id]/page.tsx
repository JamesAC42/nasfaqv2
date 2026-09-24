import type { Metadata } from "next";
import { DuelTable } from "@/app/components/games/tables/duel-table";

export const metadata: Metadata = { title: "Oshi Card Duel" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DuelTable id={Number.parseInt(id, 10)} />;
}
