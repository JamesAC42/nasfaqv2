"use client";

import { useEffect, useMemo } from "react";
import { buildModel, unitOrderIndex, type CollectionModel, type Pocket } from "@/app/components/games/collection/collection-model";
import { RARITIES } from "@/app/lib/games/rarity";
import type { CollectionResponse, Rarity, Talent } from "@/app/lib/games/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { useMarketStore } from "@/app/stores/market-store";

// The card gallery reads the same collection as the binder (GAMES_DESIGN.md §1). Every talent has
// seven pieces: key art (always shown), five card illustrations (one per owned rarity), a banner
// (owning her SSR or UR) and a reaction set (owning any of her cards). Signed-out visitors browse
// the listed talents from the market feed with everything locked.

export const REACTION_POSES = ["idle", "hype", "moon", "cope", "smug", "shock"] as const;
export type ReactionPose = (typeof REACTION_POSES)[number];

export const POSE_LABEL: Record<ReactionPose, string> = {
  idle: "Idle",
  hype: "Hype",
  moon: "Moon",
  cope: "Cope",
  smug: "Smug",
  shock: "Shock",
};

/** One line per rarity, for placards and the lightbox. */
export const RARITY_FLAVOUR: Record<Rarity, string> = {
  C: "Her everyday look. Page one of every binder.",
  R: "Headset on, chat going wild.",
  SR: "Off the clock in her other fit.",
  SSR: "Centre stage, penlights up.",
  UR: "Her legend, fully painted. The chase piece.",
};

export const BANNER_RARITIES: Rarity[] = ["SSR", "UR"];

export const ownedCount = (pocket: Pocket) => RARITIES.filter((rarity) => pocket.owned[rarity]).length;
export const isComplete = (pocket: Pocket) => ownedCount(pocket) === RARITIES.length;
export const bannerUnlocked = (pocket: Pocket) => BANNER_RARITIES.some((rarity) => pocket.owned[rarity]);
export const reactionsUnlocked = (pocket: Pocket) => ownedCount(pocket) > 0;

export const givenName = (name: string) => name.trim().split(/\s+/).pop() ?? name;

/** Debut order (unit, then the API's order inside a unit): the binder's "collection order". */
export function collectionOrder(model: CollectionModel): Pocket[] {
  return model.pockets
    .map((pocket, index) => ({ pocket, index }))
    .sort((a, b) => unitOrderIndex(a.pocket.unit) - unitOrderIndex(b.pocket.unit) || a.pocket.unit.localeCompare(b.pocket.unit) || a.index - b.index)
    .map((entry) => entry.pocket);
}

export type GalleryTotals = {
  unlocked: number;
  total: number;
  complete: number;
  banners: number;
  reactions: number;
  byRarity: Record<Rarity, number>;
  talents: number;
};

export function galleryTotals(model: CollectionModel): GalleryTotals {
  const byRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<Rarity, number>;
  let complete = 0;
  let banners = 0;
  let reactions = 0;
  for (const pocket of model.pockets) {
    for (const rarity of RARITIES) if (pocket.owned[rarity]) byRarity[rarity] += 1;
    if (isComplete(pocket)) complete += 1;
    if (bannerUnlocked(pocket)) banners += 1;
    if (reactionsUnlocked(pocket)) reactions += 1;
  }
  const unlocked = RARITIES.reduce((sum, rarity) => sum + byRarity[rarity], 0);
  return { unlocked, total: model.pockets.length * RARITIES.length, complete, banners, reactions, byRarity, talents: model.pockets.length };
}

/** A collection with nothing in it, for signed-out visitors. */
function emptyCollection(talents: Talent[]): CollectionResponse {
  const pity = { pulls_since_sr: 0, pulls_since_ssr: 0, next_sr_guaranteed_in: 10, ssr_guaranteed_in: 80, soft_pity_active: false, next_ssr_rate_bps: 400, featured_guaranteed: false, total_pulls: 0 };
  return {
    shards: 0,
    talents,
    cards: [],
    total_cards: talents.length * RARITIES.length,
    showcase: [],
    sets: [],
    starter_claimed: false,
    banners: [],
    rates: [],
    pity: { standard: pity, featured: pity, capsule: pity },
  };
}

export type GalleryData = {
  /** null until there's something to draw. */
  model: CollectionModel | null;
  signedIn: boolean;
  /** Auth has resolved. */
  ready: boolean;
  error: string | null;
  shards: number;
  collection: CollectionResponse | null;
};

export function useGallery(): GalleryData {
  const { user, initialized } = useAuth();
  const collection = useGamesStore((state) => state.collection);
  const error = useGamesStore((state) => state.error);
  const assets = useMarketStore((state) => state.assets);
  const signedIn = Boolean(user);

  useEffect(() => {
    if (user) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [user]);

  const publicTalents = useMemo<Talent[]>(
    () =>
      assets
        .filter((asset) => asset.symbol)
        .map((asset) => ({ symbol: asset.symbol, name: asset.display_name || asset.symbol, unit: asset.unit ?? null, icon: asset.icon ?? null, color: asset.color ?? null }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [assets],
  );

  const model = useMemo(() => {
    if (signedIn) return collection ? buildModel(collection) : null;
    if (!initialized || !publicTalents.length) return null;
    return buildModel(emptyCollection(publicTalents));
  }, [signedIn, collection, initialized, publicTalents]);

  return { model, signedIn, ready: initialized, error: signedIn ? error : null, shards: collection?.shards ?? 0, collection: signedIn ? collection : null };
}
