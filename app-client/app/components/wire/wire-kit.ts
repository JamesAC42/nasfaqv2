import { timeAgo } from "@/app/lib/time";
import type { WireItem } from "@/app/lib/types";

/** Short tags for Wire kinds (the front page and the Wire page). */
export const WIRE_TAGS: Record<string, string> = {
  stream_three_d: "3D",
  stream_new_outfit: "Outfit",
  stream_original_song: "Original",
  stream_cover_song: "Cover",
  stream_birthday: "Birthday",
  stream_anniversary: "Anniversary",
  stream_milestone: "Milestone",
  stream_announcement: "Announcement",
  stream_endurance: "Endurance",
  subscriber_milestone: "Subs",
  viewer_record: "Record",
  superchat_leader: "Superchats",
  market_mover: "Market",
  dividend_review: "Divs",
  buyback: "Buyback",
  sold_out: "Sold out",
  ipo: "IPO",
  exchange_sale: "Exchange",
  ur_pull: "Pull",
  prediction_resolved: "Called",
  chatter_spike: "/vt/",
};

/** Stream events that feed fair value at the next settlement (see STREAM_EVENT_WEIGHTS in the API). */
export const LIFTS_FAIR_VALUE = new Set(["stream_three_d", "stream_new_outfit", "stream_original_song", "stream_anniversary", "stream_birthday", "stream_milestone", "stream_cover_song"]);

/** The color family of a Wire kind: streams, market, games, or records (everything else). */
export function wireTone(kind: string) {
  if (kind.startsWith("stream_")) return "stream";
  if (kind === "market_mover" || kind === "dividend_review" || kind === "buyback" || kind === "sold_out" || kind === "ipo") return "market";
  if (kind === "exchange_sale" || kind === "ur_pull" || kind === "prediction_resolved") return "games";
  return "record";
}

/** Live now, starting soon, or how long ago. */
export function wireWhen(item: WireItem, now: number): { text: string; live?: boolean } {
  if (item.meta?.status === "live") return { text: "Live", live: true };
  const at = Date.parse(item.meta?.status === "upcoming" && item.meta.starts_at ? item.meta.starts_at : item.occurred_at);
  if (Number.isFinite(at) && at > now + 60_000) {
    const minutes = Math.round((at - now) / 60_000);
    return { text: minutes < 60 ? `in ${minutes}m` : minutes < 60 * 36 ? `in ${Math.round(minutes / 60)}h` : `in ${Math.round(minutes / 1440)}d` };
  }
  return { text: timeAgo(item.occurred_at, now).replace(" ago", "") };
}
