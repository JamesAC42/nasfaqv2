import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReplayView } from "@/app/components/games/mahjong/records/replay-view";
import { replayCardPath } from "@/app/components/games/mahjong/share/share-links";
import { mahjongServerGet } from "@/app/components/games/mahjong/share/server-api";
import { requireFeature } from "@/app/lib/features-server";
import { handLabel, outcomeText } from "@/app/lib/games/mahjong/replay";
import type { GameRecord } from "@/app/lib/games/mahjong/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const idOf = (value: string) => (/^[1-9]\d{0,9}$/.test(value) ? Number(value) : null);
const handOf = (value: string | string[] | undefined) => (typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : null);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  await requireFeature("mahjong");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const gameId = idOf(id);
  const record = gameId ? await mahjongServerGet<GameRecord>(`/games/${gameId}`) : null;
  if (!record) return { title: "Mahjong replay" };
  const hand = handOf(query.hand);
  const recorded = hand === null ? null : record.hands.find((entry) => entry.index === hand);
  const names = [0, 1, 2, 3].map((seat) => record.players.find((player) => player.seat === seat)?.username ?? `Seat ${seat + 1}`);
  const title = recorded ? `Mahjong hand: ${handLabel(recorded)}` : record.game.tournament_name ? `${record.game.tournament_name}: mahjong replay` : "Mahjong replay";
  const description = recorded ? outcomeText(recorded.result, names) : `${names.join(", ")}. Every hand, face up, with the seed to check the wall.`;
  const image = { url: replayCardPath(record.game.id, recorded ? recorded.index : null), width: 1200, height: 630, alt: description };
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image.url] } };
}

export default async function Page({ params, searchParams }: Props) {
  await requireFeature("mahjong");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const gameId = idOf(id);
  if (!gameId) notFound();
  return <ReplayView id={gameId} initialHand={handOf(query.hand)} />;
}
