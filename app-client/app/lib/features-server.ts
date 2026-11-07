import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

// Feature flags for a gated page's server component: the API resolves them for whoever is asking
// (GET /api/features with the visitor's cookie). Never cached, so one visitor's answer is never
// another's. Server code only (it reads the request's headers).

const API_BASE = process.env.SERVER_API_BASE || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";
// The cookie says who's asking; the address headers keep the API's record of where the player was
// (their session's last address) from becoming this server's.
const FORWARDED = ["cookie", "cf-connecting-ip", "x-forwarded-for", "user-agent"];

/** Every flag for this request's visitor; all off ({}) when the API can't say. Once per request. */
export const serverFeatures = cache(async (): Promise<Record<string, boolean>> => {
  const incoming = await headers();
  const forward: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = incoming.get(name);
    if (value) forward[name] = value;
  }
  try {
    const response = await fetch(`${API_BASE}/api/features`, { headers: forward, cache: "no-store" });
    if (!response.ok) return {};
    const body = (await response.json()) as { features?: Record<string, boolean> };
    return body.features ?? {};
  } catch {
    return {};
  }
});

/** Renders the 404 page for anyone the flag isn't on for. Call it in a gated page (and its generateMetadata). */
export async function requireFeature(flag: string) {
  if ((await serverFeatures())[flag] !== true) notFound();
}
