import type { BadgeKey } from "@/app/lib/games/mahjong/types";

// First-time badges (the API's games.mahjong_badges): each is earned once, at any table but the
// tutorial. Names and one-line descriptions live here so the lobby, the player record and the
// game-over screen word them the same way.

export type BadgeInfo = { key: BadgeKey; name: string; description: string };

export const BADGES: BadgeInfo[] = [
  { key: "first_game", name: "First game", description: "Played a game through to the end." },
  { key: "first_win", name: "First win", description: "Won a hand." },
  { key: "first_riichi_win", name: "First riichi win", description: "Won a hand after declaring riichi." },
  { key: "first_tsumo", name: "First self-draw", description: "Won a hand by drawing the winning tile yourself (tsumo)." },
  { key: "first_mangan", name: "First mangan", description: "Won a hand worth a mangan or more." },
  { key: "first_table_win", name: "First table win", description: "Finished a game in first place." },
];

const BY_KEY = new Map<string, BadgeInfo>(BADGES.map((badge) => [badge.key, badge]));

/** The name and one-line description for a badge key. An unknown key (a newer server) still reads sensibly. */
export function badgeText(key: string): { name: string; description: string } {
  const found = BY_KEY.get(key);
  if (found) return { name: found.name, description: found.description };
  const name = key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  return { name, description: "A badge from the beta." };
}

/** Badge keys in display order, unknown ones last. */
export function sortBadges<T extends { badge: string }>(rows: readonly T[]): T[] {
  const order = (key: string) => {
    const index = BADGES.findIndex((badge) => badge.key === key);
    return index < 0 ? BADGES.length : index;
  };
  return [...rows].sort((a, b) => order(a.badge) - order(b.badge));
}
