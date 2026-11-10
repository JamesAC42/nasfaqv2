import type { Metadata } from "next";
import { RoomRedirect } from "@/app/components/games/mahjong/table/room-redirect";
import { requireFeature } from "@/app/lib/features-server";

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("mahjong");
  return { title: "Mahjong friend room", description: "Join a friend’s mahjong room on NASFAQ." };
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  await requireFeature("mahjong");
  const { code } = await params;
  return <RoomRedirect code={decodeURIComponent(code)} />;
}
