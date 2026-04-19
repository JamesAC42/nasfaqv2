import { GameDetailPage } from "@/app/components/games/game-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  return <GameDetailPage gameKey={decodeURIComponent(game)} />;
}
