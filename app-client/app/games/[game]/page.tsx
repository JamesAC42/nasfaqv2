import { notFound, redirect } from "next/navigation";

// Old /games/{catalog-key} links from before the games redesign.
const LEGACY_ROUTES: Record<string, string> = {
  "talent-cards": "/games/cards",
  "capsule-gacha": "/games/capsule",
  "oshi-duel": "/games/duel",
  "high-low": "/games/high-low",
  blackjack: "/games/blackjack",
  "ticker-tap": "/games/ticker-tap",
};

export default async function Page({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const target = LEGACY_ROUTES[decodeURIComponent(game)];
  if (!target) notFound();
  redirect(target);
}
