import type { Rarity } from "@/app/lib/games/types";

// Card rarities (docs/games/GAMES_DESIGN.md §1). Colours live in talent-card.module.scss as
// --r-* tokens; this is the data side.

export const RARITIES: Rarity[] = ["C", "R", "SR", "SSR", "UR"];

export const RARITY_NAME: Record<Rarity, string> = {
  C: "Standard",
  R: "On stream",
  SR: "Outfit",
  SSR: "Idol",
  UR: "Legend",
};

/** Accent per rarity, for text and small marks outside the card frame. */
export const RARITY_COLOR: Record<Rarity, string> = {
  C: "#8d95a8",
  R: "#3fb8f5",
  SR: "#b28cff",
  SSR: "#f5c542",
  UR: "#ff7ad9",
};

export const rarityRank = (rarity: Rarity) => RARITIES.indexOf(rarity);

export const isHighRarity = (rarity: Rarity) => rarity === "SSR" || rarity === "UR";

export function parseCardKey(key: string): { symbol: string; rarity: Rarity } | null {
  const match = /^card:([A-Z0-9]+):(C|R|SR|SSR|UR)$/.exec(key);
  return match ? { symbol: match[1], rarity: match[2] as Rarity } : null;
}

export const cardKey = (symbol: string, rarity: Rarity) => `card:${symbol}:${rarity}`;

export const MAX_STARS = 5;
