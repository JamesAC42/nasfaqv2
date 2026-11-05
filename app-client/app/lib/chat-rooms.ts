import { unitName } from "@/app/lib/market-units";
import { stickerPreview } from "@/app/lib/stickers";
import type { AuthUser, ChatChannel, MarketAsset } from "@/app/lib/types";

// What /chat and the floating window agree on: which rooms there are, what they're called, and
// whether the viewer may post in one.

export type Room = {
  channel: ChatChannel;
  section: "global" | "unit" | "asset";
  key: string;
  label: string;
  short: string;
  symbol: string | null;
  icon: string | null;
  subtitle: string | null;
  unit: string | null;
};

export const GLOBAL_ROOM = "market:global";

export function buildRooms(channels: ChatChannel[], assets: MarketAsset[]): Room[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const rooms: Room[] = [];
  for (const channel of channels) {
    if (!channel.is_active || channel.scope_type === "meta") continue;
    if (channel.scope_type === "market") {
      rooms.push({ channel, section: "global", key: channel.channel_key, label: "Global", short: "ALL", symbol: null, icon: null, subtitle: channel.description || "The whole floor", unit: null });
    } else if (channel.scope_type === "unit") {
      const unit = channel.metadata.unit || channel.display_name.replace(/\s+Unit Chat$/i, "");
      rooms.push({ channel, section: "unit", key: channel.channel_key, label: unitName(unit), short: unitName(unit), symbol: null, icon: null, subtitle: channel.metadata.asset_count ? `${channel.metadata.asset_count} talents` : channel.description, unit });
    } else if (channel.scope_type === "asset") {
      const asset = channel.metadata.asset_id ? byId.get(channel.metadata.asset_id) : undefined;
      const symbol = (channel.metadata.symbol || asset?.symbol || "").toUpperCase() || null;
      rooms.push({ channel, section: "asset", key: channel.channel_key, label: channel.metadata.display_name || asset?.display_name || channel.display_name, short: symbol ?? "CHAT", symbol, icon: channel.metadata.icon || asset?.icon || null, subtitle: channel.metadata.unit || asset?.unit || null, unit: channel.metadata.unit || asset?.unit || null });
    }
  }
  // One room per talent: if an old room for the same ticker is still around (its asset was
  // re-created under a new id), keep the one tied to a listed asset.
  const best = new Map<string, Room>();
  for (const room of rooms) {
    if (room.section !== "asset" || !room.symbol) continue;
    const current = best.get(room.symbol);
    const listed = (candidate: Room) => byId.has(Number(candidate.channel.metadata.asset_id));
    if (!current || (!listed(current) && listed(room))) best.set(room.symbol, room);
  }
  const deduped = rooms.filter((room) => room.section !== "asset" || !room.symbol || best.get(room.symbol) === room);
  const order = { global: 0, unit: 1, asset: 2 };
  return deduped.sort((a, b) => order[a.section] - order[b.section] || a.short.localeCompare(b.short));
}

/** #global, #myth, #pek. */
export function roomTag(room: Pick<Room, "section" | "short">) {
  if (room.section === "global") return "#global";
  return `#${room.short.toLowerCase().replace(/\s+/g, "-")}`;
}

/** The same tag from just what the popup settings carry about a room. */
export function tagFromChannel(scopeType: string, displayName: string, metadata: { unit?: unknown; symbol?: unknown }) {
  if (scopeType === "market") return "#global";
  if (scopeType === "unit") return roomTag({ section: "unit", short: unitName(String(metadata.unit || displayName.replace(/\s+Unit Chat$/i, ""))) });
  return roomTag({ section: "asset", short: String(metadata.symbol || displayName || "chat") });
}

/** One line of a message, for room lists and popups. */
export function messagePreview(body: string | null | undefined, max = 60) {
  const sticker = stickerPreview(body);
  if (sticker) return sticker;
  const text = String(body || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Why the viewer can't post in this room, in words; null when they can (or it isn't known yet). */
export function postingBlockedReason(channel: ChatChannel | null, user: AuthUser | null) {
  if (!channel) return null;
  if (user?.suspension) return "Your account is suspended, so you can't post.";
  const restriction = channel.chat_restriction;
  if (restriction?.type === "ban") {
    return restriction.until ? `You're banned from chat until ${new Date(restriction.until).toLocaleString()}.` : "You're banned from chat.";
  }
  if (restriction?.type === "mute" || channel.muted_until) {
    return restriction?.until || channel.muted_until ? `You're muted here until ${new Date(String(restriction?.until || channel.muted_until)).toLocaleString()}.` : "You're muted in chat until an admin lifts it.";
  }
  if (channel.posting_policy === "read_only") return "This room is read-only.";
  if (channel.posting_policy === "admins_only" && !user?.is_admin) return "Only admins can post in this room right now.";
  return null;
}
