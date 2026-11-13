import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StageMock } from "@/app/components/games/mahjong/stage/stage-mock";

export const metadata: Metadata = { title: "Mahjong stage", robots: { index: false } };

// Local development only (like the other /dev pages): a visual mock of a 3D mahjong table.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StageMock />;
}
