import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SelectPreview } from "@/app/components/games/mahjong/select/select-preview";

export const metadata: Metadata = { title: "Mahjong talent select", robots: { index: false } };

// Local development only (like the other /dev pages): the talent select with a pretend table.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SelectPreview />;
}
