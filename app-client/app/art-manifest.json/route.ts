// The art manifest, served from the site even when the art lives on the CDN. The browser then
// reads it same-origin, so it doesn't depend on the CDN sending CORS headers (CloudFront keeps one
// cached copy whatever the Origin, so the header it sends can name the wrong site). The images
// themselves are plain <img> loads from the CDN and never needed CORS.
import { ART_MANIFEST_URL } from "@/app/lib/art-manifest";

export const revalidate = 60;

export async function GET() {
  // Served from public/ (no CDN): the browser fetches that file directly.
  if (!/^https?:\/\//.test(ART_MANIFEST_URL)) return new Response(null, { status: 404 });
  try {
    const response = await fetch(ART_MANIFEST_URL, { next: { revalidate: 60 } });
    if (!response.ok) return new Response(null, { status: 502 });
    return new Response(await response.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
