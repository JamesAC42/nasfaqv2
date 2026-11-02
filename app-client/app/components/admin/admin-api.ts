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
  credit?: number | null;
  last_seen_at: string | null;
  /** Shut out of the card and item exchange (set by an admin). */
  exchange_frozen_at?: string | null;
  exchange_frozen_note?: string | null;
  has_bio?: boolean;
  /** Site-wide suspension in force: read-only until `until` (null: until lifted). */
  suspension?: AdminSuspension | null;
  /** Other accounts that have used the same IP address (only a salted hash is kept; never shown). */
  shared_ip_accounts?: LinkedAccount[];
} & Record<RoleFlag, boolean>;

/** An account tied to another by a shared IP hash (api/src/services/ipHash.js). */
export type LinkedAccount = { id: number; username: string; created_at: string; email_verified: boolean; suspended: boolean };

export type AdminSuspension = { reason: string | null; since: string; until: string | null; permanent: boolean; by: string | null };

export const searchAdminUsers = (q: string, role: string) => {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (role) params.set("role", role);
  // ip_linking: false while the API has no IP_HASH_SALT (nothing recorded, nothing linked).
  return apiFetch<{ users: AdminUser[]; ip_linking?: boolean }>(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
};

export const patchUserRoles = (userId: number, body: Partial<Record<RoleFlag | "email_verified" | "confirm", boolean>>) =>
  apiFetch<{ user: AdminUser; changed: string[] }>(`/api/admin/users/${userId}/roles`, { method: "PATCH", body: JSON.stringify(body) });

/** Freeze (or unfreeze) a player's exchange access: no listing, bidding, buying or trading. */
export const patchExchangeFreeze = (userId: number, body: { frozen: boolean; note?: string }) =>
  apiFetch<{ user: AdminUser }>(`/api/admin/users/${userId}/exchange`, { method: "PATCH", body: JSON.stringify(body) });

// ── Moderation (api/src/services/moderation.js) ─────────────────────────

export type SuspensionDuration = "24h" | "7d" | "30d" | "permanent";

/** Suspend (read-only, signed out everywhere, off the leaderboards) or reinstate a player. */
export const patchSuspension = (userId: number, body: { suspended: true; duration: SuspensionDuration; reason: string } | { suspended: false; reason?: string }) =>
  apiFetch<{ user: AdminUser; sessions_revoked: number }>(`/api/admin/users/${userId}/suspension`, { method: "PATCH", body: JSON.stringify(body) });

/** Rename to player_<id> and clear the bio and banner. */
export const resetUserProfile = (userId: number, reason?: string) =>
  apiFetch<{ user: AdminUser; before: { username: string }; after: { username: string } }>(`/api/admin/users/${userId}/reset-profile`, {
    method: "POST",
    body: JSON.stringify({ reason: reason?.trim() || undefined }),
  });

export type AdminAction = {
  id: number;
  actor: { id: number; username: string | null } | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export const fetchAdminActions = (limit = 50) => apiFetch<{ actions: AdminAction[] }>(`/api/admin/moderation/actions?limit=${limit}`, { cache: "no-store" });

export type ChatReportStatus = "open" | "resolved" | "dismissed";

export type ChatReport = {
  id: number;
  reason: string;
  details: string | null;
  status: ChatReportStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reporter: { id: number; username: string };
  /** Open reports on the same message (this one included while it's open). */
  open_reports: number;
  message: {
    id: number;
    body: string;
    status: "active" | "deleted" | "moderated";
    created_at: string;
    channel_key: string;
    channel_name: string;
    author: { id: number; username: string };
  };
};

export const fetchChatReports = (status: ChatReportStatus) =>
  apiFetch<{ reports: ChatReport[]; open_count: number }>(`/api/chat/reports?status=${status}`, { cache: "no-store" });

export const setChatReportStatus = (id: number, status: ChatReportStatus) =>
  apiFetch<{ report: { id: number; status: ChatReportStatus } }>(`/api/chat/reports/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });

export type ChatRestrictionEntry = {
  id: number;
  action_type: "mute" | "ban";
  reason: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string | null;
  user: { id: number; username: string };
  channel_key: string | null;
  channel_name: string | null;
};

export const fetchActiveChatRestrictions = () => apiFetch<{ actions: ChatRestrictionEntry[] }>("/api/chat/moderation/active", { cache: "no-store" });

/** The banner under every page's header: post one (replacing any other) or clear it. */
export const postAnnouncement = (body: { text: string; tone: "info" | "warning"; link?: string; expires_in_hours?: number | null }) =>
  apiFetch<{ site: unknown }>("/internal/site/announcement", { method: "POST", body: JSON.stringify(body) });
export const clearAnnouncement = () => apiFetch<{ site: unknown }>("/internal/site/announcement", { method: "DELETE" });

// ── Market status + scheduler health ─────────────────────────────────────

export const fetchMarketStatus = () => apiFetch<Partial<MarketStatus>>("/api/market/status", { cache: "no-store" });

/** Pause trading by hand (message shown to players) and bring it back. */
export const closeTrading = (message: string) =>
  apiFetch<{ status: Partial<MarketStatus> }>("/internal/market/close", { method: "POST", body: JSON.stringify({ message }) });
export const reopenTrading = () => apiFetch<{ status: Partial<MarketStatus> }>("/internal/market/open", { method: "POST", body: JSON.stringify({}) });

/** A report from the "Report a bug" button (api/src/services/bugReports.js). */
export type BugReport = {
  id: number;
  user_id: number | null;
  username: string | null;
  message: string;
  page_path: string | null;
  user_agent: string | null;
  release_version: string | null;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
};

export const fetchBugReports = (status: "open" | "resolved") =>
  apiFetch<{ reports: BugReport[]; open_count: number }>(`/internal/site/bug-reports?status=${status}`);

export const setBugReportResolved = (id: number, resolved: boolean) =>
  apiFetch<{ report: BugReport }>(`/internal/site/bug-reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ resolved }) });

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

// ── /api/admin/schedulers ───────────────────────────────────────────────

/** One scheduler's heartbeat; `problem` is what the watchdog (and its Discord alert) makes of it. */
export type SchedulerBeat = {
  name: string;
  label: string;
  scheduler_status: string;
  scheduler_enabled: boolean;
  scheduler_interval_ms: number | null;
  scheduler_last_seen_at: string | null;
  scheduler_last_success_at: string | null;
  scheduler_error_code: string | null;
  problem: "missing" | "gone" | "stalled" | "failing" | null;
  problem_detail: string | null;
  consecutive_failures: number;
  retry_at: string | null;
};

export type SchedulerHealth = { generated_at: string | null; alerts_configured: boolean; schedulers: SchedulerBeat[] };

export function normalizeSchedulerHealth(row: Record<string, unknown> | null | undefined): SchedulerHealth {
  const r = row ?? {};
  const problems = new Set(["missing", "gone", "stalled", "failing"]);
  return {
    generated_at: str(r.generated_at),
    alerts_configured: Boolean(r.alerts_configured),
    schedulers: asArray(r.schedulers).map((beat) => ({
      name: String(beat.name || ""),
      label: String(beat.label || beat.name || ""),
      scheduler_status: str(beat.scheduler_status) || "unknown",
      scheduler_enabled: Boolean(beat.scheduler_enabled),
      scheduler_interval_ms: toNumber(beat.scheduler_interval_ms),
      scheduler_last_seen_at: str(beat.scheduler_last_seen_at),
      scheduler_last_success_at: str(beat.scheduler_last_success_at),
      scheduler_error_code: str(beat.scheduler_error_code),
      problem: problems.has(String(beat.problem)) ? (beat.problem as SchedulerBeat["problem"]) : null,
      problem_detail: str(beat.problem_detail),
      consecutive_failures: int(beat.consecutive_failures),
      retry_at: str(beat.retry_at),
    })),
  };
}

export const fetchSchedulerHealth = async () => normalizeSchedulerHealth(await apiFetch<Record<string, unknown>>("/api/admin/schedulers", { cache: "no-store" }));

// ── /api/admin/exchange-review ─────────────────────────────────────────

/** same_ip (funnel accounts): has used the same IP address as the hub. */
export type ReviewParty = { id: number; username: string; age_days: number; same_ip?: boolean };
/** Two accounts that keep trading with each other (sales and trades, any price). */
export type ReviewPair = { a: ReviewParty; b: ReviewParty; transfers: number; last_at: string; same_ip?: boolean };
/** Accounts tied together by shared IP hashes, one of them used within the window. */
export type IpCluster = { accounts: LinkedAccount[]; last_at: string };
/** One account dealing with several new ones. */
export type ReviewFunnel = { hub: ReviewParty; accounts: ReviewParty[]; transfers: number; last_at: string };
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
  /** The two accounts have used the same IP address. */
  same_ip?: boolean;
};
export type ExchangeReview = {
  window_days: number;
  new_account_days: number;
  ratio: number;
  pair_min?: number;
  funnel_min?: number;
  flags: ReviewFlag[];
  pairs?: ReviewPair[];
  funnels?: ReviewFunnel[];
  ip_linking?: boolean;
  ip_clusters?: IpCluster[];
};

export const fetchExchangeReview = (days: number) => apiFetch<ExchangeReview>(`/api/admin/exchange-review?days=${days}`, { cache: "no-store" });

// ── /api/admin/analytics ─────────────────────────────────────────────────

export type AnalyticsSite = "v2" | "v1";
export type AnalyticsTotals = { visitors: number; visits: number; pageviews: number; bounces: number; total_time_sec: number };
/** `at` is a New York day ("2026-10-31") or hour ("2026-10-31 13"). */
export type AnalyticsPoint = { at: string; visitors: number; pageviews: number };
export type AnalyticsRow = { label: string; count: number };

export type SiteAnalytics = {
  site: AnalyticsSite;
  host: string;
  from: string;
  to: string;
  unit: "hour" | "day";
  time_zone: string;
  generated_at: string;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  series: AnalyticsPoint[];
  pages: AnalyticsRow[];
  referrers: AnalyticsRow[];
  countries: AnalyticsRow[];
  campaigns: AnalyticsRow[];
  /** Visitors who followed a link on v1. Only for v2. */
  from_v1: AnalyticsTotals | null;
};

export const fetchSiteAnalytics = (site: AnalyticsSite, from: string, to: string) =>
  apiFetch<SiteAnalytics>(`/api/admin/analytics?site=${site}&from=${from}&to=${to}`, { cache: "no-store" });

// ── /api/admin/v1-links ──────────────────────────────────────────────────

export type V1LinkRow = {
  user_id: number;
  username: string;
  v1_username: string;
  v1_joined_at: string;
  peak_net_worth: number | null;
  rank: number | null;
  linked_at: string;
};

export type V1LinkSummary = {
  eligible_accounts: number;
  joined_before: string;
  linked: number;
  active_7d: number;
  players_started: number;
  in_progress: number;
  by_day: { day: string; linked: number }[];
  /** Players who tried and haven't linked, by why their last try stopped. */
  not_finished: { reason: string; players: number }[];
  recent: V1LinkRow[];
};

export const fetchV1Links = (search = "") =>
  apiFetch<V1LinkSummary>(`/api/admin/v1-links?q=${encodeURIComponent(search)}`, { cache: "no-store" });

export const undoV1Link = (userId: number, reason: string) =>
  apiFetch<{ username: string; v1_username: string }>(`/api/admin/v1-links/${userId}`, { method: "DELETE", body: JSON.stringify({ reason }) });

// ── /api/admin/holonews/front-page ───────────────────────────────────────

/** A story pinned to the top of the home page. `status` "draft" ones stay pinned but aren't shown. */
export type FrontPagePin = {
  article_id: number;
  article_slug: string;
  headline: string;
  is_news: boolean;
  status: string;
  thumbnail_url: string | null;
  published_at: string | null;
  position: number;
  pinned_at: string | null;
  pinned_by: string | null;
};

export type FrontPagePins = { pins: FrontPagePin[]; limit: number };

function normalizeFrontPagePins(raw: unknown): FrontPagePins {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    limit: int(value.limit) || 6,
    pins: asArray(value.pins).map((pin) => ({
      article_id: int(pin.article_id),
      article_slug: String(pin.article_slug ?? ""),
      headline: String(pin.headline ?? ""),
      is_news: Boolean(pin.is_news),
      status: String(pin.status ?? "published"),
      thumbnail_url: str(pin.thumbnail_url),
      published_at: str(pin.published_at),
      position: int(pin.position),
      pinned_at: str(pin.pinned_at),
      pinned_by: str(pin.pinned_by),
    })),
  };
}

export const fetchFrontPagePins = async () => normalizeFrontPagePins(await apiFetch("/api/admin/holonews/front-page", { cache: "no-store" }));

/** Replaces the pins with these stories, in this order; [] unpins everything. */
export const saveFrontPagePins = async (slugs: string[]) => normalizeFrontPagePins(await apiFetch("/api/admin/holonews/front-page", { method: "PUT", body: JSON.stringify({ slugs }) }));

export function schedulerLabel(health: { scheduler_status: string } | null | undefined) {
  const labels: Record<string, string> = { running: "Running", off: "Off", stale: "Not reporting", unknown: "Unknown", error: "Error", stalled: "Stalled" };
  return health ? labels[health.scheduler_status] || "Unknown" : "—";
}
