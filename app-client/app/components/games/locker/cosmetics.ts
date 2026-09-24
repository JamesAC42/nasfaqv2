import { apiFetch } from "@/app/lib/api";
import { normalizeGameInventoryResponse } from "@/app/lib/normalizers";
import type { GameCosmetic, GameInventoryResponse, GameItemLockerEntry } from "@/app/lib/types";

// Capsule cosmetics (docs/games/GAMES_DESIGN.md §2): types, rarities and the equip call.

export const TYPE_ORDER = ["hat", "profile_frame", "profile_badge", "chat_flair", "item", "portfolio_theme"];

export const TYPE_LABEL: Record<string, string> = {
  hat: "Hats",
  profile_frame: "Frames",
  profile_badge: "Badges",
  chat_flair: "Chat flair",
  item: "Items",
  portfolio_theme: "Themes",
};

export const COSMETIC_RARITIES = ["common", "rare", "epic", "legendary"] as const;

/** Same ladder as the card rarities: steel, blue, violet, gold. */
export const COSMETIC_COLOR: Record<string, string> = {
  common: "#8d95a8",
  rare: "#3fb8f5",
  epic: "#b28cff",
  legendary: "#f5c542",
};

export const cosmeticRank = (rarity: string) => Math.max(0, COSMETIC_RARITIES.indexOf(rarity as (typeof COSMETIC_RARITIES)[number]));

export const typeLabel = (type: string) => TYPE_LABEL[type] ?? type.replace(/_/g, " ");

export const typeIndex = (type: string) => {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
};

/** The slot a cosmetic equips into (mirrors slotKeyForType in the API). */
export function slotFor(cosmetic: Pick<GameCosmetic, "cosmetic_type" | "metadata">) {
  const fromMeta = cosmetic.metadata?.slot_key;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return TYPE_ORDER.includes(cosmetic.cosmetic_type) ? cosmetic.cosmetic_type : "profile_badge";
}

export const displayName = (cosmetic: Pick<GameCosmetic, "cosmetic_key" | "metadata">) =>
  String(cosmetic.metadata?.display_name || cosmetic.cosmetic_key);

export const imageOf = (cosmetic: Pick<GameCosmetic, "metadata">) => String(cosmetic.metadata?.image_url || "");

/** A unit-set reward: "set:{unit}:{roster|spotlight}". */
export function setRewardOf(cosmetic: Pick<GameCosmetic, "cosmetic_key" | "source_type" | "metadata">) {
  const match = /^set:([a-z0-9-]+):(roster|spotlight)$/.exec(cosmetic.cosmetic_key);
  if (!match && cosmetic.source_type !== "set_reward") return null;
  return {
    unit: String(cosmetic.metadata?.unit || match?.[1] || ""),
    tier: (match?.[2] ?? "roster") as "roster" | "spotlight",
  };
}

export async function equipCosmetic(slotKey: string, userCosmeticId: number): Promise<GameInventoryResponse> {
  const result = await apiFetch<Record<string, unknown>>("/api/games/me/cosmetics/equip", {
    method: "POST",
    body: JSON.stringify({ slot_key: slotKey, user_cosmetic_id: userCosmeticId }),
  });
  return normalizeGameInventoryResponse(result);
}

/** Empty a slot (take the hat off). */
export async function unequipCosmetic(slotKey: string): Promise<GameInventoryResponse> {
  const result = await apiFetch<Record<string, unknown>>("/api/games/me/cosmetics/equip", {
    method: "POST",
    body: JSON.stringify({ slot_key: slotKey, user_cosmetic_id: null }),
  });
  return normalizeGameInventoryResponse(result);
}

export type LockerPrize = {
  key: string;
  type: string;
  rarity: string;
  name: string;
  imageUrl: string;
  pulls: number;
  firstAt: string;
};

/** Capsule pull history folded into one row per prize (the public locker only has pulls). */
export function foldPulls(items: GameItemLockerEntry[]): LockerPrize[] {
  const byKey = new Map<string, LockerPrize>();
  for (const item of items) {
    const key = item.reward_key;
    const current = byKey.get(key);
    if (current) {
      current.pulls += 1;
      if (item.created_at < current.firstAt) current.firstAt = item.created_at;
      continue;
    }
    byKey.set(key, {
      key,
      type: item.reward.type || item.reward_type,
      rarity: item.reward.rarity || "common",
      name: item.reward.display_name || key,
      imageUrl: item.reward.image_url || String(item.metadata?.image_url || ""),
      pulls: 1,
      firstAt: item.created_at,
    });
  }
  return [...byKey.values()];
}
