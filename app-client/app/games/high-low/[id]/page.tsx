import type { Metadata } from "next";
import { HighLowTable } from "@/app/components/games/tables/high-low-table";

export const metadata: Metadata = { title: "High-low" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HighLowTable id={Number.parseInt(id, 10)} />;
}
