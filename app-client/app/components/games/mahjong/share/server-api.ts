import { cookies, headers } from "next/headers";

// Reads from the mahjong API on the server (page metadata and share cards). While the `mahjong`
// flag is on only for some people the API answers only them, so the request carries the visitor's
// cookie; a crawler has none and sees a 404 until the flag is on for everyone. Server only.

const API_BASE = process.env.SERVER_API_BASE || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";
const FORWARDED = ["cf-connecting-ip", "x-forwarded-for", "user-agent"];

export async function mahjongServerGet<T>(path: string): Promise<T | null> {
  try {
    const incoming = await headers();
    const forward: Record<string, string> = {};
    for (const name of FORWARDED) {
      const value = incoming.get(name);
      if (value) forward[name] = value;
    }
    const cookie = (await cookies()).toString();
    if (cookie) forward.cookie = cookie;
    const response = await fetch(`${API_BASE}/api/games/mahjong${path}`, { headers: forward, cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
