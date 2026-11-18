import type { NextRequest } from "next/server";
import { requireFeature } from "@/app/lib/features-server";
import { gameCard, handCard } from "@/app/components/games/mahjong/share/cards";
import { mahjongServerGet } from "@/app/components/games/mahjong/share/server-api";
import type { GameRecord } from "@/app/lib/games/mahjong/types";

export const runtime = "nodejs";

/**
 * The share card for a mahjong replay, 1200x630 PNG: `?hand=n` is a winning hand of the game, no
 * `hand` is the game's result. `?download` makes the browser save it as a file.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireFeature("mahjong");
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) return new Response("Not found", { status: 404 });
  const record = await mahjongServerGet<GameRecord>(`/games/${id}`);
  if (!record || record.game.status !== "completed") return new Response("Not found", { status: 404 });
  const handParam = request.nextUrl.searchParams.get("hand");
  let image: Response | null = null;
  if (handParam !== null) {
    const hand = record.hands.find((entry) => String(entry.index) === handParam);
    image = hand ? await handCard(record, hand) : null;
  } else {
    image = await gameCard(record);
  }
  if (!image) return new Response("Not found", { status: 404 });
  const headers = new Headers(image.headers);
  // A finished game never changes.
  headers.set("Cache-Control", "public, max-age=86400");
  if (request.nextUrl.searchParams.has("download")) {
    headers.set("Content-Disposition", `attachment; filename="nasfaq-mahjong-${id}${handParam !== null ? `-hand-${handParam.replace(/\D/g, "")}` : ""}.png"`);
  }
  return new Response(image.body, { status: 200, headers });
}
