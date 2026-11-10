import type { Metadata } from "next";
import { Tutorial } from "@/app/components/games/mahjong/learn/tutorial";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong walkthrough", description: "From “what is a tile” to a first win: ten short lessons with a question in each." };
}

export default async function Page() {
  await requireFeature("mahjong");
  return <Tutorial />;
}
