import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevTileBoard } from "@/app/components/games/mahjong/dev-tile-board";

export const metadata: Metadata = { title: "Mahjong tiles", robots: { index: false } };

// Local development only (like the other /dev pages): every tile at four sizes, dark and light.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevTileBoard />;
}
