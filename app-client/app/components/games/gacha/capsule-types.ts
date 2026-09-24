import { apiFetch } from "@/app/lib/api";

// Capsule gacha (GAMES_DESIGN.md §2): shapes from api/src/routes/games.js + services/games/gacha.js.
// Kept here rather than in lib/games/types.ts because only the capsule page reads them.

export type CapsuleRarity = "common" | "rare" | "epic" | "legendary";

export const CAPSULE_RARITIES: CapsuleRarity[] = ["common", "rare", "epic", "legendary"];

export const CAPSULE_COLOR: Record<CapsuleRarity, string> = {
  common: "#8d95a8",
  rare: "#3fb8f5",
  epic: "#b28cff",
  legendary: "#f5c542",
};

export const CAPSULE_DUP_SHARDS: Record<CapsuleRarity, number> = { common: 3, rare: 10, epic: 40, legendary: 150 };
export const CAPSULE_EPIC_EVERY = 10;
export const CAPSULE_HARD_PITY = 60;

export const capsuleRank = (rarity: string) => Math.max(0, CAPSULE_RARITIES.indexOf(rarity as CapsuleRarity));

export type CapsuleReward = {
  id: number;
  key: string;
  cosmetic_key: string;
  type: string;
  cosmetic_type: string;
  rarity: CapsuleRarity;
  display_name: string;
  description: string;
  slot_key: string;
  pull_chance: number;
  image_url: string | null;
};

export type CapsuleCatalog = {
  game: {
    key: string;
    name: string;
    description: string;
    entry_fee_cash: number;
    config: { pull_cost_cash?: number; ten_pull_cost_cash?: number };
  };
  rewards: CapsuleReward[];
};

export type CapsulePull = {
  id: number;
  created_at: string;
  reward: {
    key: string;
    type: string;
    rarity: CapsuleRarity;
    display_name: string;
    slot_key: string;
    description: string;
    image_url: string | null;
    pull_chance: number;
  };
  duplicate: boolean;
  shards: number;
};

export type CapsulePity = {
  pulls_since_epic: number;
  pulls_since_legendary: number;
  epic_guaranteed_in: number;
  legendary_guaranteed_in: number;
};

export type CapsulePullResponse = {
  wallet: { debited_cash: number; cash_balance_after: number | null };
  shards: number;
  shards_awarded: number;
  pity: CapsulePity;
  pulls: CapsulePull[];
};

export type OwnedCosmetic = { id: number; cosmetic_key: string; cosmetic_type: string; rarity: string };

export const fetchCapsuleCatalog = () => apiFetch<CapsuleCatalog>("/api/games/capsule-gacha/catalog", { cache: "no-store" });
export const fetchInventory = () => apiFetch<{ cosmetics: OwnedCosmetic[] }>("/api/games/me/inventory", { cache: "no-store" });
export const pullCapsule = (count: 1 | 10) =>
  apiFetch<CapsulePullResponse>("/api/games/capsule-gacha/pull", { method: "POST", body: JSON.stringify({ count }) });

/** The collection store tracks capsule pity with the card field names (sr → epic, ssr → legendary). */
export function capsulePityFrom(sinceEpic: number, sinceLegendary: number): CapsulePity {
  return {
    pulls_since_epic: sinceEpic,
    pulls_since_legendary: sinceLegendary,
    epic_guaranteed_in: Math.max(1, CAPSULE_EPIC_EVERY - sinceEpic),
    legendary_guaranteed_in: Math.max(1, CAPSULE_HARD_PITY - sinceLegendary),
  };
}

export const TYPE_LABEL: Record<string, string> = {
  hat: "Hat",
  profile_frame: "Frame",
  chat_flair: "Chat flair",
  profile_badge: "Badge",
};
