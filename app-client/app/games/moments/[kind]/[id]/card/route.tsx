import type { NextRequest } from "next/server";
import { momentImage } from "@/app/lib/og-moment";
import { cleanSymbol, isMomentKind } from "@/app/lib/games/moments";

export const runtime = "nodejs";

/**
 * The share card for a game moment, 1200×630 PNG. `?t=SYM` is the talent the player saw react (used
 * when they have no oshi); `?download` makes the browser save it as a file.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isMomentKind(kind)) return new Response("Not found", { status: 404 });
  const decoded = decodeURIComponent(id);
  const image = await momentImage(kind, decoded, cleanSymbol(request.nextUrl.searchParams.get("t")));
  if (!image) return new Response("Not found", { status: 404 });
  const headers = new Headers(image.headers);
  // A settled moment never changes, so the card can be cached for a day.
  headers.set("Cache-Control", "public, max-age=86400");
  if (request.nextUrl.searchParams.has("download")) {
    headers.set("Content-Disposition", `attachment; filename="nasfaq-${kind}-${decoded.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}.png"`);
  }
  return new Response(image.body, { status: 200, headers });
}
