import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MahjongTablePage } from "@/app/components/games/mahjong/table/mahjong-table";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong table", description: "Watch or play a live riichi mahjong table on NASFAQ." };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("mahjong");
  const { id } = await params;
  const tableId = Number(id);
  if (!Number.isInteger(tableId) || tableId <= 0) notFound();
  return <MahjongTablePage key={tableId} tableId={tableId} />;
}
