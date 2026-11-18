// Art pictures served from the site, for the few places that draw them into WebGL (the 3D mahjong
// table). A plain <img> from the CDN never needed CORS, but a WebGL texture does, and the CDN sends no
// CORS headers; read same-origin, the picture is always usable. Only files under the art folder, by
// their names: a hashed name is cached for good, anything else for an hour.
import { ART_MANIFEST_URL } from "@/app/lib/art-manifest";

const FILE = /^[A-Za-z0-9_@-]+(?:\/[A-Za-z0-9_@.-]+)*\.(webp|png|jpg)$/;
const TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  // Served from public/ (no CDN): the pictures are on this site already.
  if (!/^https?:\/\//.test(ART_MANIFEST_URL)) return new Response(null, { status: 404 });
  const path = (await params).path.join("/");
  const match = FILE.exec(path);
  if (!match || path.split("/").some((part) => part === "." || part === "..")) return new Response(null, { status: 404 });
  const base = new URL(".", ART_MANIFEST_URL);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return new Response(null, { status: 404 });
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });
    return new Response(response.body, {
      headers: { "Content-Type": TYPES[match[1]], "Cache-Control": /\.[0-9a-f]{8}\.\w+$/.test(path) ? "public, max-age=31536000, immutable" : "public, max-age=3600" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
