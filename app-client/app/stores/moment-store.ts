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
  /** The fills on screen as one moment: a single fill, or everything that landed in one batch. */
  fills: FillMoment[];
  pushFill: (fill: FillMoment) => void;
  dismissFill: () => void;
  /** Popups for fills can be turned off; fills then go to the toast. */
  fillPopups: boolean;
  setFillPopups: (on: boolean) => void;
  /** The small toast in the corner (batch results, rejections, fills when popups are off). */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  tick: TickMoment | null;
  /** A tick that landed while the tab was hidden; shown when the player comes back. */
  missedTick: TickMoment | null;
  pushTick: (payload: Record<string, unknown>) => void;
  revealMissed: () => void;
  dismissTick: () => void;
};

const shownFills = new Set<string>();
const POPUP_KEY = "nasfaq-fill-popups";
// Fills from one batch arrive within a moment of each other; wait for the burst to finish so they
// open as one popup instead of twenty.
const GATHER_MS = 900;
let gathered: FillMoment[] = [];
let gatherTimer: ReturnType<typeof setTimeout> | null = null;

function readPopupPref() {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(POPUP_KEY) !== "off";
  } catch {
    return true;
  }
}

function fillLine(fill: FillMoment) {
  return `${fill.side === "buy" ? "Bought" : "Sold"} ${fill.quantity.toLocaleString("en-US")} ${fill.symbol} @ ${fill.price.toFixed(2)}`;
}

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
  fills: [],
  // A fill can arrive twice (the live socket and the order-poll fallback); show it once.
  pushFill: (fill) => {
    if (shownFills.has(fill.id)) return;
    shownFills.add(fill.id);
    if (!get().fillPopups) {
      gathered.push(fill);
      if (gatherTimer) clearTimeout(gatherTimer);
      gatherTimer = setTimeout(() => {
        const batch = gathered;
        gathered = [];
        gatherTimer = null;
        set({ notice: batch.length === 1 ? `${fillLine(batch[0])}.` : `${batch.length} orders filled. ${fillLine(batch[0])}, +${batch.length - 1} more.` });
      }, GATHER_MS);
      return;
    }
    // A popup already open for this batch takes late arrivals.
    if (get().fills.length) {
      set({ fills: [...get().fills, fill] });
      return;
    }
    gathered.push(fill);
    if (gatherTimer) clearTimeout(gatherTimer);
    gatherTimer = setTimeout(() => {
      const batch = gathered;
      gathered = [];
      gatherTimer = null;
      set({ fills: batch });
    }, GATHER_MS);
  },
  dismissFill: () => set({ fills: [] }),
  fillPopups: readPopupPref(),
  setFillPopups: (on) => {
    try {
      window.localStorage.setItem(POPUP_KEY, on ? "on" : "off");
    } catch {}
    set({ fillPopups: on });
  },
  notice: null,
  setNotice: (notice) => set({ notice }),
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
