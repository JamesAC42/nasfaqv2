import type { Metadata } from "next";
import { GlossaryPage } from "@/app/components/games/mahjong/learn/glossary-page";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong glossary", description: "Japanese mahjong terms in plain English, A to Z." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <GlossaryPage />;
}
