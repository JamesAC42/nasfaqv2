import { cardKey, RARITIES, rarityRank } from "@/app/lib/games/rarity";
import type { CollectionResponse, Rarity, Talent, TalentCard, UnitSet } from "@/app/lib/games/types";
import { UNIT_ORDER, unitName } from "@/app/lib/market-units";

// Derived views over the collection response: what's owned, each talent's best card, units in
// debut order. Pure functions so the binder, showcase and sheet agree on the same numbers.

export type Pocket = {
  talent: Talent;
  unit: string;
  /** Owned cards for this talent keyed by rarity. */
  owned: Partial<Record<Rarity, TalentCard>>;
  best: TalentCard | null;
  /** Newest first_obtained_at across the talent's cards (ms), 0 if none. */
  newest: number;
};

export type CollectionModel = {
  pockets: Pocket[];
  bySymbol: Map<string, Pocket>;
  ownedByKey: Map<string, TalentCard>;
  units: string[];
  counts: Record<Rarity, number>;
  unique: number;
  total: number;
  basePower: Record<Rarity, number>;
  craftCost: Record<Rarity, number>;
  dupShards: Record<Rarity, number>;
  dropBps: Record<Rarity, number>;
};

const FALLBACK_POWER: Record<Rarity, number> = { C: 10, R: 14, SR: 19, SSR: 25, UR: 32 };
const FALLBACK_CRAFT: Record<Rarity, number> = { C: 50, R: 150, SR: 500, SSR: 2000, UR: 8000 };
const FALLBACK_DUP: Record<Rarity, number> = { C: 5, R: 15, SR: 50, SSR: 200, UR: 800 };
const FALLBACK_DROP: Record<Rarity, number> = { C: 5500, R: 3000, SR: 1100, SSR: 350, UR: 50 };

export function unitOrderIndex(unit: string) {
  const index = UNIT_ORDER.indexOf(unit);
  return index === -1 ? UNIT_ORDER.length : index;
}

export function buildModel(collection: CollectionResponse): CollectionModel {
  const ownedByKey = new Map(collection.cards.map((card) => [card.key, card]));
  const pockets: Pocket[] = collection.talents.map((talent) => {
    const owned: Pocket["owned"] = {};
    let best: TalentCard | null = null;
    let newest = 0;
    for (const rarity of RARITIES) {
      const card = ownedByKey.get(cardKey(talent.symbol, rarity));
      if (!card) continue;
      owned[rarity] = card;
      best = card;
      const at = card.obtained_at ? Date.parse(card.obtained_at) : 0;
      if (at > newest) newest = at;
    }
    return { talent, unit: unitName(talent.unit) || "Other", owned, best, newest };
  });

  const unitSet = new Set(pockets.map((pocket) => pocket.unit));
  const units = [...unitSet].sort((a, b) => unitOrderIndex(a) - unitOrderIndex(b) || a.localeCompare(b));

  const counts = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<Rarity, number>;
  for (const card of collection.cards) counts[card.rarity] += 1;

  const rate = (field: "power" | "craft_shards" | "duplicate_shards" | "rate_bps", fallback: Record<Rarity, number>) =>
    Object.fromEntries(RARITIES.map((rarity) => [rarity, collection.rates.find((entry) => entry.rarity === rarity)?.[field] ?? fallback[rarity]])) as Record<Rarity, number>;

  return {
    pockets,
    bySymbol: new Map(pockets.map((pocket) => [pocket.talent.symbol, pocket])),
    ownedByKey,
    units,
    counts,
    unique: collection.cards.length,
    total: collection.total_cards || collection.talents.length * RARITIES.length,
    basePower: rate("power", FALLBACK_POWER),
    craftCost: rate("craft_shards", FALLBACK_CRAFT),
    dupShards: rate("duplicate_shards", FALLBACK_DUP),
    dropBps: rate("rate_bps", FALLBACK_DROP),
  };
}

/** Sets in debut order, using the unit of their first member. */
export function orderedSets(sets: UnitSet[], model: CollectionModel) {
  const unitOf = (set: UnitSet) => model.bySymbol.get(set.members[0]?.symbol ?? "")?.unit ?? set.label;
  return [...sets].sort((a, b) => unitOrderIndex(unitOf(a)) - unitOrderIndex(unitOf(b)));
}

export function bestRarityRank(pocket: Pocket) {
  return pocket.best ? rarityRank(pocket.best.rarity) : -1;
}
