import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/lib/config";
import type {
  AdminOverview,
  AutoTemplate,
  Category,
  Chart,
  ChartRange,
  CreateMarketInput,
  FloorTab,
  Fill,
  Forecaster,
  LimitOrder,
  Portfolio,
  PredictionMarket,
  PredictionMarketDetail,
  Quote,
  Trade,
} from "@/app/lib/predictions/types";

// Typed client for predictions v2. Money moves only through trade() and the limit-order calls.

const BASE = "/api/prediction-markets";

/** An API error that keeps the response body (the fresh quote on price_moved, the field on form errors). */
export type PredictionApiError = Error & { status?: number; body?: { error?: string; quote?: unknown; field?: string } };

async function send<T>(path: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: PredictionApiError["body"] = {};
    try {
      payload = await response.json();
    } catch {}
    const error = new Error(payload?.error || String(response.status)) as PredictionApiError;
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) => send<T>(path, "POST", body ?? {});

export const fetchFloor = (params: { tab?: FloorTab; category?: string; q?: string; page?: number; limit?: number } = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<{ items: PredictionMarket[]; counts?: Partial<Record<FloorTab | "all", number>>; pagination: { total: number; page: number; page_count: number } }>(`${BASE}?${query}`, { cache: "no-store" });
};
export const fetchCategories = () => apiFetch<{ categories: Category[] }>(`${BASE}/categories`, { cache: "no-store" });
export const fetchTape = (limit = 40) => apiFetch<{ trades: Trade[] }>(`${BASE}/tape?limit=${limit}`, { cache: "no-store" });
export const fetchForecasters = (limit = 10) => apiFetch<{ forecasters: Forecaster[] }>(`${BASE}/leaderboard?limit=${limit}`, { cache: "no-store" });
export const fetchPortfolio = () => apiFetch<Portfolio>(`${BASE}/portfolio`, { cache: "no-store" });

export const fetchMarket = (slug: string) => apiFetch<{ market: PredictionMarketDetail }>(`${BASE}/${encodeURIComponent(slug)}`, { cache: "no-store" });
export const fetchChart = (slug: string, range: ChartRange) => apiFetch<Chart>(`${BASE}/${encodeURIComponent(slug)}/chart?range=${range}`, { cache: "no-store" });
export const fetchTrades = (slug: string, limit = 40) => apiFetch<{ trades: Trade[] }>(`${BASE}/${encodeURIComponent(slug)}/trades?limit=${limit}`, { cache: "no-store" });
export const fetchQuote = (slug: string, params: { outcome: string; side: "buy" | "sell"; amount?: number; shares?: number }) => {
  const query = new URLSearchParams({ outcome: params.outcome, side: params.side });
  if (params.amount !== undefined) query.set("amount", String(params.amount));
  if (params.shares !== undefined) query.set("shares", String(params.shares));
  return apiFetch<Quote>(`${BASE}/${encodeURIComponent(slug)}/quote?${query}`, { cache: "no-store" });
};

/** Buy by cash (amount) or sell by shares. The avg-price guard makes a moved price fail with `price_moved`. */
export const trade = (slug: string, body: { outcome: string; side: "buy" | "sell"; amount?: number; shares?: number; max_avg_price?: number; min_avg_price?: number }) =>
  post<{ fill: Fill; cash_balance: number; triggered: number }>(`/${encodeURIComponent(slug)}/trade`, body);
export const placeLimitOrder = (slug: string, body: { outcome: string; side: "buy" | "sell"; limit_price: number; amount?: number; shares?: number }) =>
  post<{ order: LimitOrder; fills: Fill[] }>(`/${encodeURIComponent(slug)}/limit-orders`, body);
export const cancelLimitOrder = (slug: string, orderId: number) => send<{ order: LimitOrder }>(`/${encodeURIComponent(slug)}/limit-orders/${orderId}`, "DELETE");
export const disputeMarket = (marketId: number, reason: string) => post<{ market: { id: number; slug: string } }>(`/${marketId}/dispute`, { reason });

// Staff
type Action = { market: { id: number; slug: string } };
export const fetchAdminOverview = () => apiFetch<AdminOverview>(`${BASE}/admin/overview`, { cache: "no-store" });
export const updateTemplate = (key: string, body: { enabled?: boolean; params?: Record<string, number> }) =>
  apiFetch<{ template: AutoTemplate }>(`${BASE}/admin/templates/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(body) });
export const createMarket = (input: CreateMarketInput) => post<{ market: { id: number; slug: string; status: string } }>("", input);
export const submitMarket = (id: number) => post<Action>(`/${id}/submit`);
export const approveMarket = (id: number) => post<Action>(`/${id}/approve`);
export const rejectMarket = (id: number, reason: string) => post<Action>(`/${id}/reject`, { reason });
export const closeMarket = (id: number) => post<Action>(`/${id}/close`);
export const haltMarket = (id: number) => post<Action>(`/${id}/halt`);
export const resumeMarket = (id: number) => post<Action>(`/${id}/resume`);
export const proposeResolution = (id: number, body: { outcome: string; source_url: string; note?: string }) => post<Action>(`/${id}/propose`, body);
export const overturnResolution = (id: number, body: { outcome: string; source_url: string; note?: string }) => post<Action>(`/${id}/overturn`, body);
export const withdrawResolution = (id: number) => post<Action>(`/${id}/withdraw`);
export const confirmResolution = (id: number) => post<Action>(`/${id}/confirm`);
export const voidMarket = (id: number, reason: string) => post<Action>(`/${id}/void`, { reason });
