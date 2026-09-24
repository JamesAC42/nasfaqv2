import { create } from "zustand";

// Full-screen "moments": the scheduled tick landing (and, later, fills).
// Fed by the market websocket (market.adjustments_applied).

export type TickMove = { symbol: string; name: string; before: number; after: number; pct: number };

export type TickMoment = {
  id: string;
  intervalKey: string;
  at: string;
  forced: boolean;
  moves: TickMove[];
};

export type FillMoment = {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  fee: number;
  gross: number;
  /** Realized P/L for sells when known. */
  realized: number | null;
  /** Average cost after the fill (buys) or before it (sells). */
  avgCost: number | null;
  at: string;
};

type MomentStore = {
  fill: FillMoment | null;
  pushFill: (fill: FillMoment) => void;
  dismissFill: () => void;
  tick: TickMoment | null;
  /** A tick that landed while the tab was hidden; shown when the player comes back. */
  missedTick: TickMoment | null;
  pushTick: (payload: Record<string, unknown>) => void;
  revealMissed: () => void;
  dismissTick: () => void;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTickPayload(payload: Record<string, unknown>): TickMoment | null {
  const rows = Array.isArray(payload.adjustments) ? (payload.adjustments as Array<Record<string, unknown>>) : [];
  const moves: TickMove[] = [];
  let intervalKey = "";
  for (const row of rows) {
    const before = toNumber(row.price_before);
    const after = toNumber(row.price_after);
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol || before === null || after === null || before <= 0) continue;
    intervalKey ||= String(row.interval_key || "");
    moves.push({ symbol, name: String(row.display_name || symbol), before, after, pct: (after - before) / before });
  }
  if (!moves.length) return null;
  const at = String(payload.at || new Date().toISOString());
  return { id: `${intervalKey}:${at}`, intervalKey, at, forced: Boolean(payload.forced), moves };
}

export const useMomentStore = create<MomentStore>((set, get) => ({
  fill: null,
  pushFill: (fill) => set({ fill }),
  dismissFill: () => set({ fill: null }),
  tick: null,
  missedTick: null,
  pushTick: (payload) => {
    const tick = parseTickPayload(payload);
    if (!tick) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") set({ missedTick: tick });
    else set({ tick, missedTick: null });
  },
  revealMissed: () => {
    const missed = get().missedTick;
    if (missed) set({ tick: missed, missedTick: null });
  },
  dismissTick: () => set({ tick: null }),
}));
