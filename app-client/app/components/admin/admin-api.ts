import { apiFetch } from "@/app/lib/api";
import type { MarketStatus } from "@/app/lib/types";

// Typed fetchers for the admin console. The scheduler health endpoints return loosely typed rows
// (numbers as strings, optional arrays), so everything goes through a normalizer that never
// assumes a field exists.

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const int = (value: unknown) => Number(toNumber(value) || 0);
const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
export const asArray = <T = Record<string, unknown>>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// ── /api/admin/overview ──────────────────────────────────────────────────

export type RoleFlag =
  | "is_admin"
  | "can_manage_assets"
  | "can_create_prediction_markets"
  | "can_approve_prediction_markets"
  | "can_resolve_prediction_markets"
  | "can_void_prediction_markets";

export type AdminOverviewStats = {
  generated_at: string;
  users: { total: number; signups_24h: number; signups_7d: number; verified: number; roles: Record<RoleFlag | "staff", number> };
  market: { trades_24h: number; active_traders_24h: number; volume_cash_24h: number };
  games: {
    rounds_24h: number;
    rounds_by_game: { key: string; name: string; rounds: number }[];
    card_pulls_24h: number;
    card_pullers_24h: number;
    card_spend_24h: number;
    capsule_pulls_24h: number;
    capsule_pullers_24h: number;
    capsule_spend_24h: number;
  };
  predictions: { trades_24h: number; traders_24h: number; volume_cash_24h: number };
  stuck: { game_sessions: number; pvp_matches: number; blackjack_rounds: number };
};

export const fetchAdminStats = () => apiFetch<AdminOverviewStats>("/api/admin/overview", { cache: "no-store" });

// ── /api/admin/users ─────────────────────────────────────────────────────

export type AdminUser = {
  id: number;
  username: string;
  email_masked: string | null;
  has_email: boolean;
  email_verified: boolean;
  email_verified_at: string | null;
  profile_color: string | null;
  profile_picture_url: string | null;
  created_at: string;
  cash: number | null;
  last_seen_at: string | null;
} & Record<RoleFlag, boolean>;

export const searchAdminUsers = (q: string, role: string) => {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (role) params.set("role", role);
  return apiFetch<{ users: AdminUser[] }>(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
};

export const patchUserRoles = (userId: number, body: Partial<Record<RoleFlag | "email_verified" | "confirm", boolean>>) =>
  apiFetch<{ user: AdminUser; changed: string[] }>(`/api/admin/users/${userId}/roles`, { method: "PATCH", body: JSON.stringify(body) });

// ── Market status + scheduler health ─────────────────────────────────────

export const fetchMarketStatus = () => apiFetch<Partial<MarketStatus>>("/api/market/status", { cache: "no-store" });

/** Pause trading by hand (message shown to players) and bring it back. */
export const closeTrading = (message: string) =>
  apiFetch<{ status: Partial<MarketStatus> }>("/internal/market/close", { method: "POST", body: JSON.stringify({ message }) });
export const reopenTrading = () => apiFetch<{ status: Partial<MarketStatus> }>("/internal/market/open", { method: "POST", body: JSON.stringify({}) });

/** Maintenance by hand: pause (with a message for players) or reopen new games site-wide. */
export const setSiteMaintenance = (on: boolean, message = "") =>
  apiFetch<{ site: unknown }>("/internal/site/maintenance", { method: "POST", body: JSON.stringify({ on, message }) });

export type AdjustmentHealth = {
  next_scheduled_at: string | null;
  last_applied_at: string | null;
  scheduled_count: number;
  overdue_scheduled_count: number;
  stuck_scheduled_count: number;
  applied_24h_count: number;
  skipped_24h_count: number;
  open_session_count: number;
  scheduler_lock_held: boolean;
  scheduler_interval_ms: number;
  scheduler_enabled: boolean;
  scheduler_status: string;
};

export function normalizeAdjustmentHealth(row: Record<string, unknown> | null | undefined): AdjustmentHealth {
  const r = row ?? {};
  return {
    next_scheduled_at: str(r.next_scheduled_at),
    last_applied_at: str(r.last_applied_at),
    scheduled_count: int(r.scheduled_count),
    overdue_scheduled_count: int(r.overdue_scheduled_count),
    stuck_scheduled_count: int(r.stuck_scheduled_count),
    applied_24h_count: int(r.applied_24h_count),
    skipped_24h_count: int(r.skipped_24h_count),
    open_session_count: int(r.open_session_count),
    scheduler_lock_held: Boolean(r.scheduler_lock_held),
    scheduler_interval_ms: int(r.scheduler_interval_ms),
    scheduler_enabled: Boolean(r.scheduler_enabled),
    scheduler_status: str(r.scheduler_status) || "unknown",
  };
}

export type LiveOrderBatch = {
  id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  orders_attempted: number;
  orders_filled: number;
  orders_rejected: number;
  error_text: string | null;
};

export type LiveOrderHealth = {
  generated_at: string | null;
  scheduler_enabled: boolean;
  scheduler_status: string;
  scheduler_interval_ms: number;
  batch_limit: number;
  health: {
    next_execute_after: string | null;
    oldest_pending_at: string | null;
    pending_count: number;
    due_pending_count: number;
    overdue_pending_count: number;
    rejected_24h_count: number;
    filled_24h_count: number;
  };
  recent_batches: LiveOrderBatch[];
};

export function normalizeLiveOrderHealth(row: Record<string, unknown> | null | undefined): LiveOrderHealth {
  const r = row ?? {};
  const health = (r.health && typeof r.health === "object" ? r.health : {}) as Record<string, unknown>;
  return {
    generated_at: str(r.generated_at),
    scheduler_enabled: Boolean(r.scheduler_enabled),
    scheduler_status: str(r.scheduler_status) || "unknown",
    scheduler_interval_ms: int(r.scheduler_interval_ms),
    batch_limit: int(r.batch_limit),
    health: {
      next_execute_after: str(health.next_execute_after),
      oldest_pending_at: str(health.oldest_pending_at),
      pending_count: int(health.pending_count),
      due_pending_count: int(health.due_pending_count),
      overdue_pending_count: int(health.overdue_pending_count),
      rejected_24h_count: int(health.rejected_24h_count),
      filled_24h_count: int(health.filled_24h_count),
    },
    recent_batches: asArray(r.recent_batches).map((batch) => ({
      id: int(batch.id),
      status: String(batch.status || ""),
      started_at: str(batch.started_at),
      completed_at: str(batch.completed_at),
      orders_attempted: int(batch.orders_attempted),
      orders_filled: int(batch.orders_filled),
      orders_rejected: int(batch.orders_rejected),
      error_text: str(batch.error_text),
    })),
  };
}

export const fetchAdjustmentHealth = async () =>
  normalizeAdjustmentHealth(await apiFetch<Record<string, unknown>>("/api/market/adjustments/admin/health", { cache: "no-store" }));

export const fetchLiveOrderHealth = async (batchLimit = 8) =>
  normalizeLiveOrderHealth(await apiFetch<Record<string, unknown>>(`/api/market/live-orders/admin/health?batch_limit=${batchLimit}`, { cache: "no-store" }));

// ── /api/admin/exchange-review ─────────────────────────────────────────

export type ReviewParty = { id: number; username: string; age_days: number };
export type ReviewFlag = {
  type: "sale" | "trade";
  id: number;
  at: string;
  from: ReviewParty;
  to: ReviewParty;
  summary: string;
  paid: number;
  worth: number;
  ratio: number | null;
  favours: "from" | "to";
  pair_flags: number;
};
export type ExchangeReview = { window_days: number; new_account_days: number; ratio: number; flags: ReviewFlag[] };

export const fetchExchangeReview = (days: number) => apiFetch<ExchangeReview>(`/api/admin/exchange-review?days=${days}`, { cache: "no-store" });

export function schedulerLabel(health: { scheduler_status: string } | null | undefined) {
  const labels: Record<string, string> = { running: "Running", off: "Off", stale: "Not reporting", unknown: "Unknown", error: "Error", stalled: "Stalled" };
  return health ? labels[health.scheduler_status] || "Unknown" : "—";
}
