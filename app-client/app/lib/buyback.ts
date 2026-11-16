"use client";

import { useMemo } from "react";
import { buybackPlan } from "@/app/lib/buyback-plan.mjs";
import { useFeature } from "@/app/lib/features";
import type { MarketAsset, MarketBuyback } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";

// Buybacks you can't miss (the buyback-spotlight flag, api/src/features): the badge, the strips, the
// stock page's banner and the holders' heads-up. Every asset payload already carries its buyback, so
// the flag only decides whether these show.

export const BUYBACK_FLAG = "buyback-spotlight";

export type BuybackPlan = ReturnType<typeof buybackPlan>;

/** Whether this viewer gets the buyback visuals. */
export function useBuybackSpotlight() {
  return useFeature(BUYBACK_FLAG);
}

/** The asset's buyback, if it's frozen in one. */
export function activeBuyback(asset: MarketAsset | null | undefined): MarketBuyback | null {
  return asset && asset.trading_state === "buyback" && asset.buyback ? asset.buyback : null;
}

/** Today's offer, the steps, the shares still over the max and when it ends, worked out at `now`. */
export function planOf(asset: MarketAsset, now: number): BuybackPlan | null {
  const buyback = activeBuyback(asset);
  if (!buyback) return null;
  return buybackPlan({ buyback, circulating: asset.circulating_supply, max: asset.max_supply ?? null }, now);
}

/** "120%". */
export function pctLabel(pct: number) {
  return `${Math.round(pct * 100)}%`;
}

/** Every stock in a buyback right now, best offer first (empty without the flag). */
export function useBuybackAssets(): MarketAsset[] {
  const shown = useBuybackSpotlight();
  const assets = useMarketStore((state) => state.assets);
  return useMemo(() => {
    if (!shown) return [];
    return assets
      .filter((asset) => activeBuyback(asset))
      .sort((a, b) => (b.buyback?.multiplier ?? 0) - (a.buyback?.multiplier ?? 0) || a.symbol.localeCompare(b.symbol));
  }, [assets, shown]);
}

/** Whether this stock is in a buyback, for the badge (false without the flag). */
export function useInBuyback(symbol: string | null | undefined): boolean {
  const shown = useBuybackSpotlight();
  const upper = symbol?.toUpperCase() ?? "";
  const frozen = useMarketStore((state) => (upper ? state.assets.some((asset) => asset.symbol === upper && asset.trading_state === "buyback" && Boolean(asset.buyback)) : false));
  return shown && frozen;
}
