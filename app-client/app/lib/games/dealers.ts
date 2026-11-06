// Today's blackjack dealers: one talent per table, picked by the API from the ET date (the same for
// everyone, new at midnight ET), and which picture of them each moment of a round shows.

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";

export { DEALER_FALLBACK_POSE, dealerStateForOutcome, dealerStateOf, type DealerState } from "@/app/lib/games/dealer-states";

export type TableDealer = { table: string; symbol: string | null; name: string | null; color: string | null };
type DealersResponse = { blackjack: { date: string; changes_in_ms: number | null; dealers: TableDealer[] } };

let cached: { at: number; ttl: number; dealers: TableDealer[] } | null = null;
let inflight: Promise<TableDealer[]> | null = null;

async function loadDealers(): Promise<TableDealer[]> {
  if (cached && Date.now() - cached.at < cached.ttl) return cached.dealers;
  inflight ??= apiFetch<DealersResponse>("/api/games/dealers", { cache: "no-store" })
    .then((body) => {
      const dealers = Array.isArray(body?.blackjack?.dealers) ? body.blackjack.dealers : [];
      const changesIn = Number(body?.blackjack?.changes_in_ms);
      cached = { at: Date.now(), ttl: Number.isFinite(changesIn) && changesIn > 0 ? changesIn : 5 * 60_000, dealers };
      return dealers;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Today's dealers (empty until loaded or if the API is down); refreshes itself at midnight ET. */
export function useBlackjackDealers(): TableDealer[] {
  const [dealers, setDealers] = useState<TableDealer[]>(() => cached?.dealers ?? []);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = () => {
      loadDealers()
        .then((next) => {
          if (cancelled) return;
          setDealers(next);
          const left = cached ? cached.ttl - (Date.now() - cached.at) : 5 * 60_000;
          timer = window.setTimeout(refresh, Math.max(5_000, left + 2_000));
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(refresh, 60_000);
        });
    };
    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return dealers;
}

export function useTableDealer(tableKey: string): TableDealer | null {
  const dealers = useBlackjackDealers();
  return dealers.find((dealer) => dealer.table === tableKey && dealer.symbol) ?? null;
}
