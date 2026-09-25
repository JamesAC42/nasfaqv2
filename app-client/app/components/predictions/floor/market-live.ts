import { useMarketStore } from "@/app/stores/market-store";
import type { Fill, PredictionMarket } from "@/app/lib/predictions/types";

// Helpers shared by the floor: applying a live fill to a listed market, and finding the talent an
// auto market is about (the list view has no auto_data, so we read it off the title or outcome).

export type TalentMark = { symbol: string; icon: string | null; color: string | null };

/** Moves a listed market to the prices in a fill (24 h change and the sparkline's last point too). */
export function applyFill(market: PredictionMarket, fill: Fill): PredictionMarket {
  const next = new Map(fill.prices.map((row) => [String(row.outcome_id), row.price]));
  const outcomes = market.outcomes.map((outcome) => {
    const price = next.get(String(outcome.id));
    if (price === undefined) return outcome;
    const sparkline = outcome.sparkline.length ? [...outcome.sparkline.slice(0, -1), price] : [price];
    return { ...outcome, price, change_24h: outcome.change_24h + (price - outcome.price), sparkline };
  });
  const yes = outcomes.find((outcome) => outcome.outcome_code === "yes");
  const top = outcomes.reduce((best, outcome) => (outcome.price > best ? outcome.price : best), 0);
  return {
    ...market,
    outcomes,
    last_traded_probability: yes ? yes.price : top,
    last_trade_at: fill.at,
    total_volume_cash: market.total_volume_cash + fill.cash,
    volume_24h: market.volume_24h + fill.cash,
    trades_24h: market.trades_24h + 1,
  };
}

/** The talent behind a tick-direction or stream-peak market: "PEK up on…", "Marine's stream…". */
export function useMarketTalent(market: PredictionMarket): TalentMark | null {
  const assets = useMarketStore((state) => state.assets);
  if (market.auto_template !== "tick-direction" && market.auto_template !== "stream-peak") return null;
  const linked = market.outcomes.find((outcome) => outcome.asset)?.asset;
  if (linked) return linked;
  const ticker = market.title.match(/^([A-Z]{2,5})\b/)?.[1];
  if (ticker) {
    const asset = assets.find((row) => row.symbol === ticker);
    return { symbol: ticker, icon: asset?.icon ?? null, color: asset?.color ?? null };
  }
  const name = market.title.match(/^(.+?)['’]s\b/)?.[1]?.toLowerCase().trim();
  if (!name) return null;
  const asset = assets.find((row) => {
    const full = row.display_name.toLowerCase();
    return full === name || full.split(/\s+/).includes(name);
  });
  return asset ? { symbol: asset.symbol, icon: asset.icon ?? null, color: asset.color ?? null } : null;
}
