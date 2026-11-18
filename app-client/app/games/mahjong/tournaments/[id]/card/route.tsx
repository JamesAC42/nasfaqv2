import type { NextRequest } from "next/server";
import { requireFeature } from "@/app/lib/features-server";
import { tournamentCard } from "@/app/components/games/mahjong/share/cards";
import { mahjongServerGet } from "@/app/components/games/mahjong/share/server-api";
import type { TournamentResponse } from "@/app/lib/games/mahjong/types";

export const runtime = "nodejs";

/** The share card for a mahjong tournament, 1200x630 PNG: the champion and podium once it is over. `?download` saves it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireFeature("mahjong");
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) return new Response("Not found", { status: 404 });
  const payload = await mahjongServerGet<TournamentResponse>(`/tournaments/${id}`);
  if (!payload) return new Response("Not found", { status: 404 });
  const image = await tournamentCard(payload);
  const headers = new Headers(image.headers);
  headers.set("Cache-Control", payload.tournament.status === "completed" ? "public, max-age=86400" : "public, max-age=300");
  if (request.nextUrl.searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="nasfaq-mahjong-tournament-${id}.png"`);
  return new Response(image.body, { status: 200, headers });
}
