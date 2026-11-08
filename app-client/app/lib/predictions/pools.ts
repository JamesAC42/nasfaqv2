import { apiFetch, rateLimitedMessage } from "@/app/lib/api";
import { API_BASE } from "@/app/lib/config";
import type { PredictionApiError } from "@/app/lib/predictions/api";
import type { Outcome, PredictionMarket } from "@/app/lib/predictions/types";

// Prediction pools and margin (docs/design/predictions-pools.md; api/src/services/predictions/pools.js).
// Players stake Credit (then Cash, then margin) on an option; the winners split the whole pool in
// proportion to stake. Behind the prediction-pools flag (usePoolAccess says whether this player sees
// them yet).

const BASE = "/api/prediction-markets";

export type PoolOption = Outcome & {
  pool_stake: number;
  /** What $1 on it pays if it wins and the pool closed now; null while nobody's on it. */
  multiplier: number | null;
  bettors: { username: string; profile_color: string | null; stake: number; payout: number | null }[];
};

export type MarginStatus = {
  in_red: boolean;
  owed: number;
  eligible: boolean;
  reason: string | null;
  available_at: string | null;
  share_value: number;
  line: number;
  /** What a bet could borrow right now (0 in the red, too new, or with no shares). */
  available: number;
  line_share: number;
  line_max: number;
};

export type BettorState = {
  wallet: { credit: number; cash: number; spendable: number };
  margin: MarginStatus;
  new_account: { cap: number; staked: number; until: string } | null;
};

export type PoolRecordEntry = {
  id: number;
  action: "resolved" | "corrected" | "voided";
  outcome_code: string | null;
  outcome_label: string | null;
  previous_label: string | null;
  actor: { username: string } | null;
  automatic: boolean;
  source_url: string | null;
  note: string | null;
  evidence: Record<string, unknown>;
  pool_total: number;
  paid_out: number;
  refunded: number;
  clawed_back: number;
  no_winner_refund: boolean;
  at: string;
};

export type PoolBet = {
  id: number;
  outcome_code: string;
  outcome_label: string;
  amount: number;
  stake_after: number;
  raise: boolean;
  username: string;
  profile_color: string | null;
  at: string;
};

export type PoolDetail = PredictionMarket & {
  pricing: "pool";
  pool_total: number;
  description: string | null;
  rules_text: string;
  resolution_source_text: string;
  auto_data: Record<string, unknown>;
  bookie: { username: string } | null;
  min_bet: number;
  bettors_count: number;
  betting_open: boolean;
  betting_lock: string | null;
  options: PoolOption[];
  bets: PoolBet[];
  record: PoolRecordEntry[];
  correction_until: string | null;
  mine?: BettorState & { stakes: { outcome_id: number; stake: number; borrowed: number; payout: number | null }[] };
  can?: { bet: boolean; own_pool: boolean; manage: boolean; resolve: boolean; extend: boolean; void: boolean; correct: boolean };
};

export type PoolHistoryItem = {
  id: number;
  slug: string;
  title: string;
  status: "resolved" | "voided";
  kind: "event" | "auto";
  bookie: string | null;
  pool_total: number;
  winner_label: string | null;
  winner_multiplier: number | null;
  no_winner: boolean;
  bettors: number;
  corrected: boolean;
  note: string | null;
  finished_at: string;
  mine: { staked: number; paid: number; net: number } | null;
};

export type MyPoolStake = {
  market_id: number;
  slug: string;
  title: string;
  status: string;
  closes_at: string;
  outcome_id: number;
  outcome_label: string;
  stake: number;
  borrowed: number;
  pool_total: number;
  option_total: number;
  payout_if_wins: number | null;
  payout: number | null;
  won: boolean | null;
  finished_at: string | null;
};

export type MyPools = BettorState & {
  open: MyPoolStake[];
  settled: MyPoolStake[];
  totals: { staked_open: number; net_settled: number };
  settings: { min_bet: number; new_account_cap: number };
};

export type BookiePool = PredictionMarket & { pricing: "pool"; pool_total: number; bookie: string | null; bettors: number; min_bet: number; can_correct: boolean };

export type CreatePoolInput = { title: string; options: string[]; closes_at: string; rules_text?: string; description?: string; category?: string; min_bet?: number };

export type BetResult = {
  bet: { id: number; slug: string; outcome_code: string; outcome_label: string; amount: number; from_credit: number; from_cash: number; borrowed: number; stake_after: number; at: string };
  pool_total: number;
  wallet: { credit: number; cash: number; spendable: number; owed: number };
};

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: PredictionApiError["body"] & Record<string, unknown> = {};
    try {
      payload = await response.json();
    } catch {}
    const limited = payload?.error === "rate_limited" || response.status === 429;
    const error = new Error(limited ? rateLimitedMessage(payload?.retry_after ?? response.headers.get("retry-after")) : payload?.error || String(response.status)) as PredictionApiError;
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return (await response.json()) as T;
}

export const poolHref = (slug: string) => `/predictions/pools/${encodeURIComponent(slug)}`;

export const fetchPool = (slug: string) => apiFetch<{ pool: PoolDetail }>(`${BASE}/pools/${encodeURIComponent(slug)}`, { cache: "no-store" });
export const fetchMyPools = () => apiFetch<MyPools>(`${BASE}/pools/me`, { cache: "no-store" });
export const fetchBookiePools = (scope: "mine" | "all" = "mine") => apiFetch<{ pools: BookiePool[] }>(`${BASE}/pools/bookie?scope=${scope}`, { cache: "no-store" });
export const fetchPoolHistory = (params: { q?: string; mine?: boolean; page?: number } = {}) => {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.mine) query.set("mine", "1");
  if (params.page) query.set("page", String(params.page));
  return apiFetch<{ items: PoolHistoryItem[]; pagination: { total: number; page: number; page_count: number } }>(`${BASE}/pools/history?${query}`, { cache: "no-store" });
};

export const placeBet = (slug: string, body: { outcome: string; amount: number; use_margin?: boolean }) => post<BetResult>(`/pools/${encodeURIComponent(slug)}/bet`, body);
export const createPool = (input: CreatePoolInput) => post<{ pool: { id: number; slug: string } }>("/pools", input);
type PoolAction = { pool: { id: number; slug: string } };
export const closePool = (id: number) => post<PoolAction>(`/pools/${id}/close`);
export const extendPool = (id: number, closesAt: string) => post<PoolAction>(`/pools/${id}/extend`, { closes_at: closesAt });
export const resolvePool = (id: number, body: { outcome: string; source_url?: string; note?: string }) => post<PoolAction>(`/pools/${id}/resolve`, body);
export const correctPool = (id: number, body: { outcome: string; source_url?: string; note?: string }) => post<PoolAction>(`/pools/${id}/correct`, body);
export const voidPool = (id: number, body: { reason?: string; source_url?: string }) => post<PoolAction>(`/pools/${id}/void`, body);
export const repayMargin = () => post<{ repaid: number; owed: number; cash: number; credit: number }>("/margin/repay");

// ── The math, as the API does it (api/src/services/predictions/poolMath.js), in cents ──
const toCents = (value: number) => Math.round((value || 0) * 100);

/** What the player's whole stake on an option pays if the pool closed right after they add `amount`. */
export function previewBet({ total, optionTotal, mine = 0, amount }: { total: number; optionTotal: number; mine?: number; amount: number }) {
  const add = toCents(amount);
  const nextTotal = toCents(total) + add;
  const nextOption = toCents(optionTotal) + add;
  const stake = toCents(mine) + add;
  if (nextOption <= 0) return { stake: 0, payout: 0, profit: 0, multiplier: null as number | null };
  const payout = Math.floor((stake * nextTotal) / nextOption);
  return { stake: stake / 100, payout: payout / 100, profit: (payout - stake) / 100, multiplier: nextTotal / nextOption };
}

/** Where a bet's money comes from: Credit, then Cash, then the margin line. */
export function splitBet(amount: number, state: BettorState | undefined, usesCash: boolean) {
  const credit = Math.max(0, state?.wallet.credit ?? 0);
  const cash = usesCash ? Math.max(0, state?.wallet.cash ?? 0) : 0;
  const fromCredit = Math.min(amount, credit);
  const fromCash = Math.min(amount - fromCredit, cash);
  const borrowed = Math.max(0, Math.round((amount - fromCredit - fromCash) * 100) / 100);
  return { fromCredit, fromCash, borrowed };
}

export const multiplierText = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 100) return `${Math.round(value)}×`;
  return `${value.toFixed(value >= 10 ? 1 : 2)}×`;
};
