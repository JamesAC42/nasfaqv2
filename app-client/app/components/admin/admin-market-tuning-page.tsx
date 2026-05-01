"use client";

import { useEffect, useMemo, useState } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/admin/admin-market-tuning-page.module.scss";

type MarketTuningConfig = {
  interval_strength_total_pct?: number;
  intervals?: Array<{
    key: string;
    label: string;
    time: string;
    timezone: string;
    next_day?: boolean;
  }>;
  asset_tuning_defaults?: {
    adjustment_min_pct: number;
    adjustment_max_pct: number;
    adjustment_enabled: boolean;
    supply_evaluation_cadence: string;
    broker_buffer_pct: number;
  };
  phase?: {
    status: string;
    description: string;
  };
};

type MarketTuningAsset = {
  id: number;
  symbol: string;
  display_name: string;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  current_fair_value?: number | null;
  current_mid_price?: number | null;
  base_rate?: number | null;
  market_price?: number | null;
  current_premium_pct?: number | null;
  premium_discount_pct?: number | null;
  adjustment_min_pct?: number | null;
  adjustment_max_pct?: number | null;
  adjustment_enabled?: boolean | null;
  supply_evaluation_cadence?: string | null;
  broker_buffer_pct?: number | null;
  adjustment_ready?: boolean | null;
};

type MarketTuningResponse = {
  asset: MarketTuningAsset;
};

type MarketResetAction = "reset" | "rebuild";

type ForceAdjustmentResponse = {
  applied_count: number;
  skipped_count: number;
  skipped_prior_count?: number;
  market_date?: string;
  target?: {
    interval_key: string;
    scheduled_at: string;
    applied_at: string;
  } | null;
};

type ForceRegenerateDayResponse = {
  market_date?: string;
  settled_count?: number;
  adjustment_session?: {
    session?: {
      id?: number;
      market_date?: string;
      status?: string;
    };
    created?: boolean;
    interval_count?: number;
    skipped_assets?: Array<Record<string, unknown>>;
  };
};

type AdjustmentAdminSession = {
  id: number;
  market_date: string;
  status: string;
  generated_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  interval_count: number;
  asset_count: number;
  scheduled_count: number;
  applied_count: number;
  skipped_count: number;
  cancelled_count: number;
  first_scheduled_at?: string | null;
  last_scheduled_at?: string | null;
  last_applied_at?: string | null;
  completion_pct: number | null;
};

type AdjustmentAdminInterval = {
  id: number;
  session_id: number;
  asset_id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  interval_key: string;
  scheduled_at: string | null;
  applied_at: string | null;
  status: string;
  strength_pct: number | null;
  base_rate: number | null;
  price_before: number | null;
  price_after: number | null;
  metadata_json: Record<string, unknown> | null;
  skip_reason: string | null;
  price_event_id: number | null;
  price_event_at: string | null;
  move_pct: number | null;
  gap_compression_pct: number | null;
};

type AdjustmentAdminSessionDetail = {
  session: AdjustmentAdminSession;
  intervals: AdjustmentAdminInterval[];
};

type AdjustmentAdminHealth = {
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
};

type LiveOrderAdminBatch = {
  id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  orders_attempted: number;
  orders_filled: number;
  orders_rejected: number;
  error_text: string | null;
};

type LiveOrderAdminHealth = {
  generated_at: string | null;
  scheduler_enabled: boolean;
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
  recent_batches: LiveOrderAdminBatch[];
};

const CADENCE_OPTIONS = ["weekly", "monthly", "quarterly", "manual"];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toAsset(row: Record<string, unknown>): MarketTuningAsset {
  return {
    id: Number(row.id),
    symbol: String(row.symbol || ""),
    display_name: String(row.display_name || ""),
    unit: row.unit ? String(row.unit) : null,
    icon: row.icon ? String(row.icon) : null,
    color: row.color ? String(row.color) : null,
    current_fair_value: toNumber(row.current_fair_value),
    current_mid_price: toNumber(row.current_mid_price),
    base_rate: toNumber(row.base_rate ?? row.current_fair_value),
    market_price: toNumber(row.market_price ?? row.current_mid_price),
    current_premium_pct: toNumber(row.current_premium_pct),
    premium_discount_pct: toNumber(row.premium_discount_pct ?? row.current_premium_pct),
    adjustment_min_pct: toNumber(row.adjustment_min_pct),
    adjustment_max_pct: toNumber(row.adjustment_max_pct),
    adjustment_enabled: typeof row.adjustment_enabled === "boolean" ? row.adjustment_enabled : null,
    supply_evaluation_cadence: row.supply_evaluation_cadence ? String(row.supply_evaluation_cadence) : null,
    broker_buffer_pct: toNumber(row.broker_buffer_pct),
    adjustment_ready: typeof row.adjustment_ready === "boolean" ? row.adjustment_ready : null,
  };
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 2 : 4 })}`;
}

function formatPct(value: number | null | undefined, scale = 100) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${(value * scale).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatPlainPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}

function formatStrengthPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatIntervalLabel(value: string | null | undefined) {
  switch (value) {
    case "open":
      return "Open";
    case "lunch":
      return "Lunch";
    case "late":
      return "Late";
    case "overnight":
      return "Overnight";
    default:
      return value || "N/A";
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getEasternDateKey(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeSession(row: Record<string, unknown>): AdjustmentAdminSession {
  return {
    id: Number(row.id || 0),
    market_date: String(row.market_date || ""),
    status: String(row.status || ""),
    generated_at: row.generated_at ? String(row.generated_at) : null,
    opened_at: row.opened_at ? String(row.opened_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    interval_count: Number(toNumber(row.interval_count) || 0),
    asset_count: Number(toNumber(row.asset_count) || 0),
    scheduled_count: Number(toNumber(row.scheduled_count) || 0),
    applied_count: Number(toNumber(row.applied_count) || 0),
    skipped_count: Number(toNumber(row.skipped_count) || 0),
    cancelled_count: Number(toNumber(row.cancelled_count) || 0),
    first_scheduled_at: row.first_scheduled_at ? String(row.first_scheduled_at) : null,
    last_scheduled_at: row.last_scheduled_at ? String(row.last_scheduled_at) : null,
    last_applied_at: row.last_applied_at ? String(row.last_applied_at) : null,
    completion_pct: toNumber(row.completion_pct),
  };
}

function normalizeInterval(row: Record<string, unknown>): AdjustmentAdminInterval {
  return {
    id: Number(row.id || 0),
    session_id: Number(row.session_id || 0),
    asset_id: Number(row.asset_id || 0),
    symbol: String(row.symbol || ""),
    display_name: String(row.display_name || ""),
    icon: row.icon ? String(row.icon) : null,
    color: row.color ? String(row.color) : null,
    interval_key: String(row.interval_key || ""),
    scheduled_at: row.scheduled_at ? String(row.scheduled_at) : null,
    applied_at: row.applied_at ? String(row.applied_at) : null,
    status: String(row.status || ""),
    strength_pct: toNumber(row.strength_pct),
    base_rate: toNumber(row.base_rate),
    price_before: toNumber(row.price_before),
    price_after: toNumber(row.price_after),
    metadata_json: row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json as Record<string, unknown> : null,
    skip_reason: row.skip_reason ? String(row.skip_reason) : null,
    price_event_id: toNumber(row.price_event_id),
    price_event_at: row.price_event_at ? String(row.price_event_at) : null,
    move_pct: toNumber(row.move_pct),
    gap_compression_pct: toNumber(row.gap_compression_pct),
  };
}

function normalizeHealth(row: Record<string, unknown>): AdjustmentAdminHealth {
  return {
    next_scheduled_at: row.next_scheduled_at ? String(row.next_scheduled_at) : null,
    last_applied_at: row.last_applied_at ? String(row.last_applied_at) : null,
    scheduled_count: Number(toNumber(row.scheduled_count) || 0),
    overdue_scheduled_count: Number(toNumber(row.overdue_scheduled_count) || 0),
    stuck_scheduled_count: Number(toNumber(row.stuck_scheduled_count) || 0),
    applied_24h_count: Number(toNumber(row.applied_24h_count) || 0),
    skipped_24h_count: Number(toNumber(row.skipped_24h_count) || 0),
    open_session_count: Number(toNumber(row.open_session_count) || 0),
    scheduler_lock_held: Boolean(row.scheduler_lock_held),
    scheduler_interval_ms: Number(toNumber(row.scheduler_interval_ms) || 0),
    scheduler_enabled: Boolean(row.scheduler_enabled),
  };
}

function normalizeLiveOrderHealth(row: Record<string, unknown>): LiveOrderAdminHealth {
  const health = (row.health || {}) as Record<string, unknown>;
  return {
    generated_at: row.generated_at ? String(row.generated_at) : null,
    scheduler_enabled: Boolean(row.scheduler_enabled),
    scheduler_interval_ms: Number(toNumber(row.scheduler_interval_ms) || 0),
    batch_limit: Number(toNumber(row.batch_limit) || 0),
    health: {
      next_execute_after: health.next_execute_after ? String(health.next_execute_after) : null,
      oldest_pending_at: health.oldest_pending_at ? String(health.oldest_pending_at) : null,
      pending_count: Number(toNumber(health.pending_count) || 0),
      due_pending_count: Number(toNumber(health.due_pending_count) || 0),
      overdue_pending_count: Number(toNumber(health.overdue_pending_count) || 0),
      rejected_24h_count: Number(toNumber(health.rejected_24h_count) || 0),
      filled_24h_count: Number(toNumber(health.filled_24h_count) || 0),
    },
    recent_batches: ((row.recent_batches || []) as Array<Record<string, unknown>>).map((batch) => ({
      id: Number(batch.id || 0),
      status: String(batch.status || ""),
      started_at: batch.started_at ? String(batch.started_at) : null,
      completed_at: batch.completed_at ? String(batch.completed_at) : null,
      orders_attempted: Number(toNumber(batch.orders_attempted) || 0),
      orders_filled: Number(toNumber(batch.orders_filled) || 0),
      orders_rejected: Number(toNumber(batch.orders_rejected) || 0),
      error_text: batch.error_text ? String(batch.error_text) : null,
    })),
  };
}

function AssetMark({ asset }: { asset: MarketTuningAsset }) {
  return (
    <div className={styles.assetMark}>
      <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.assetCoin} shape="circle" />
      <div>
        <strong>{asset.symbol}</strong>
        <span>{asset.display_name}</span>
      </div>
    </div>
  );
}

function TuningRow({
  asset,
  onSaved,
}: {
  asset: MarketTuningAsset;
  onSaved: (asset: MarketTuningAsset) => void;
}) {
  const [minPct, setMinPct] = useState(formatPlainPct(asset.adjustment_min_pct));
  const [maxPct, setMaxPct] = useState(formatPlainPct(asset.adjustment_max_pct));
  const [enabled, setEnabled] = useState(Boolean(asset.adjustment_enabled));
  const [cadence, setCadence] = useState(asset.supply_evaluation_cadence || "weekly");
  const [bufferPct, setBufferPct] = useState(formatPlainPct(asset.broker_buffer_pct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setMinPct(formatPlainPct(asset.adjustment_min_pct));
    setMaxPct(formatPlainPct(asset.adjustment_max_pct));
    setEnabled(Boolean(asset.adjustment_enabled));
    setCadence(asset.supply_evaluation_cadence || "weekly");
    setBufferPct(formatPlainPct(asset.broker_buffer_pct));
    setSuccess(false);
  }, [
    asset.adjustment_enabled,
    asset.adjustment_max_pct,
    asset.adjustment_min_pct,
    asset.broker_buffer_pct,
    asset.id,
    asset.supply_evaluation_cadence,
  ]);

  async function handleSave() {
    const nextMinPct = Number(minPct);
    const nextMaxPct = Number(maxPct);
    const nextBufferPct = Number(bufferPct);

    if (!Number.isFinite(nextMinPct) || nextMinPct < 0) {
      setError("Minimum adjustment must be zero or higher.");
      return;
    }
    if (!Number.isFinite(nextMaxPct) || nextMaxPct < nextMinPct) {
      setError("Maximum adjustment must be at least the minimum.");
      return;
    }
    if (!Number.isFinite(nextBufferPct) || nextBufferPct < 0 || nextBufferPct >= 1) {
      setError("Broker buffer must be between 0 and 1.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await apiFetch<MarketTuningResponse>(`/api/market/assets/${encodeURIComponent(asset.symbol)}/tuning`, {
        method: "PATCH",
        body: JSON.stringify({
          adjustment_min_pct: nextMinPct,
          adjustment_max_pct: nextMaxPct,
          adjustment_enabled: enabled,
          supply_evaluation_cadence: cadence,
          broker_buffer_pct: nextBufferPct,
        }),
      });
      onSaved(toAsset(result.asset as unknown as Record<string, unknown>));
      setSuccess(true);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <AssetMark asset={asset} />
      </td>
      <td className={styles.metricCell}>
        <span>Base</span>
        <strong>{formatPrice(asset.base_rate ?? asset.current_fair_value)}</strong>
      </td>
      <td className={styles.metricCell}>
        <span>Market</span>
        <strong>{formatPrice(asset.market_price ?? asset.current_mid_price)}</strong>
        <em>{formatPct(asset.premium_discount_pct ?? asset.current_premium_pct)}</em>
      </td>
      <td>
        <label className={styles.switch}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>{enabled ? "Enabled" : "Paused"}</span>
        </label>
      </td>
      <td>
        <div className={styles.inlineFields}>
          <label>
            <span>Min %</span>
            <input className={styles.compactInput} inputMode="decimal" value={minPct} onChange={(event) => setMinPct(event.target.value)} />
          </label>
          <label>
            <span>Max %</span>
            <input className={styles.compactInput} inputMode="decimal" value={maxPct} onChange={(event) => setMaxPct(event.target.value)} />
          </label>
        </div>
      </td>
      <td>
        <label className={styles.compactField}>
          <span>Supply Check</span>
          <select className={styles.select} value={cadence} onChange={(event) => setCadence(event.target.value)}>
            {CADENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </td>
      <td>
        <label className={styles.compactField}>
          <span>Broker Buffer</span>
          <input className={styles.compactInput} inputMode="decimal" value={bufferPct} onChange={(event) => setBufferPct(event.target.value)} />
        </label>
      </td>
      <td>
        <div className={styles.rowActions}>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void handleSave()}>
            {busy ? "Saving..." : "Save"}
          </button>
          <span className={asset.adjustment_ready ? styles.ready : styles.notReady}>
            {asset.adjustment_ready ? "Ready" : "Needs price"}
          </span>
        </div>
        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
        {success ? <div className="statusMessage statusMessageSuccess">Saved.</div> : null}
      </td>
    </tr>
  );
}

export function AdminMarketTuningPage() {
  const { initialized, isLoading: isAuthLoading, user } = useAuth();
  const adminBusy = useProfileStore((state) => state.adminBusy);
  const adminStatus = useProfileStore((state) => state.adminStatus);
  const adminError = useProfileStore((state) => state.adminError);
  const resetMarket = useProfileStore((state) => state.resetMarket);
  const rebuildMarket = useProfileStore((state) => state.rebuildMarket);
  const refreshMarketOverview = useMarketStore((state) => state.refreshOverview);
  const [assets, setAssets] = useState<MarketTuningAsset[]>([]);
  const [config, setConfig] = useState<MarketTuningConfig | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceBusy, setForceBusy] = useState(false);
  const [forceResult, setForceResult] = useState<ForceAdjustmentResponse | null>(null);
  const [forceError, setForceError] = useState<string | null>(null);
  const [regenerateDate, setRegenerateDate] = useState(() => getEasternDateKey());
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [regenerateResult, setRegenerateResult] = useState<ForceRegenerateDayResponse | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [adminSessions, setAdminSessions] = useState<AdjustmentAdminSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionDetail, setSessionDetail] = useState<AdjustmentAdminSessionDetail | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<AdjustmentAdminInterval | null>(null);
  const [adminHealth, setAdminHealth] = useState<AdjustmentAdminHealth | null>(null);
  const [liveOrderHealth, setLiveOrderHealth] = useState<LiveOrderAdminHealth | null>(null);
  const [adminAdjustmentError, setAdminAdjustmentError] = useState<string | null>(null);
  const [isLoadingAdminAdjustments, setIsLoadingAdminAdjustments] = useState(false);
  const [confirmAction, setConfirmAction] = useState<MarketResetAction | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!initialized || !user?.is_admin) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [assetRows, tuningConfig] = await Promise.all([
          apiFetch<Record<string, unknown>[]>("/api/market/assets", { signal: controller.signal }),
          apiFetch<MarketTuningConfig>("/api/market/tuning/config", { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setAssets(assetRows.map(toAsset));
        setConfig(tuningConfig);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [initialized, user?.is_admin]);

  useEffect(() => {
    if (!initialized || !user?.is_admin) return;
    let cancelled = false;

    async function loadAdminAdjustments() {
      setIsLoadingAdminAdjustments(true);
      setAdminAdjustmentError(null);
      try {
        const [sessionsResult, healthResult, liveOrderHealthResult] = await Promise.all([
          apiFetch<{ sessions: Array<Record<string, unknown>> }>("/api/market/adjustments/admin/sessions?limit=30"),
          apiFetch<Record<string, unknown>>("/api/market/adjustments/admin/health"),
          apiFetch<Record<string, unknown>>("/api/market/live-orders/admin/health?batch_limit=8"),
        ]);
        if (cancelled) return;
        const sessions = sessionsResult.sessions.map(normalizeSession);
        setAdminSessions(sessions);
        setAdminHealth(normalizeHealth(healthResult));
        setLiveOrderHealth(normalizeLiveOrderHealth(liveOrderHealthResult));
        setSelectedSessionId((current) => current || sessions[0]?.id || null);
      } catch (nextError) {
        if (!cancelled) setAdminAdjustmentError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) setIsLoadingAdminAdjustments(false);
      }
    }

    void loadAdminAdjustments();
    return () => {
      cancelled = true;
    };
  }, [initialized, user?.is_admin]);

  useEffect(() => {
    if (!selectedSessionId || !user?.is_admin) {
      setSessionDetail(null);
      return;
    }
    let cancelled = false;
    async function loadSessionDetail() {
      setAdminAdjustmentError(null);
      try {
        const result = await apiFetch<{ session: Record<string, unknown>; intervals: Array<Record<string, unknown>> }>(
          `/api/market/adjustments/admin/sessions/${selectedSessionId}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        setSessionDetail({
          session: normalizeSession(result.session),
          intervals: result.intervals.map(normalizeInterval),
        });
        setSelectedInterval(null);
      } catch (nextError) {
        if (!cancelled) setAdminAdjustmentError(String((nextError as Error).message || nextError));
      }
    }
    void loadSessionDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, user?.is_admin]);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return assets;
    return assets.filter((asset) => {
      const haystack = `${asset.symbol} ${asset.display_name} ${asset.unit || ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [assets, query]);

  const enabledCount = assets.filter((asset) => asset.adjustment_enabled).length;
  const readyCount = assets.filter((asset) => asset.adjustment_ready).length;
  const sessionAssetRows = useMemo(() => {
    const byAsset = new Map<string, { symbol: string; display_name: string; icon: string | null; color: string | null; intervals: Record<string, AdjustmentAdminInterval> }>();
    for (const interval of sessionDetail?.intervals || []) {
      const current = byAsset.get(interval.symbol) || {
        symbol: interval.symbol,
        display_name: interval.display_name,
        icon: interval.icon,
        color: interval.color,
        intervals: {},
      };
      current.intervals[interval.interval_key] = interval;
      byAsset.set(interval.symbol, current);
    }
    return [...byAsset.values()];
  }, [sessionDetail?.intervals]);

  async function refreshAdminAdjustmentData(nextSessionId = selectedSessionId) {
    const [sessionsResult, healthResult, liveOrderHealthResult] = await Promise.all([
      apiFetch<{ sessions: Array<Record<string, unknown>> }>("/api/market/adjustments/admin/sessions?limit=30", { cache: "no-store" }),
      apiFetch<Record<string, unknown>>("/api/market/adjustments/admin/health", { cache: "no-store" }),
      apiFetch<Record<string, unknown>>("/api/market/live-orders/admin/health?batch_limit=8", { cache: "no-store" }),
    ]);
    const sessions = sessionsResult.sessions.map(normalizeSession);
    setAdminSessions(sessions);
    setAdminHealth(normalizeHealth(healthResult));
    setLiveOrderHealth(normalizeLiveOrderHealth(liveOrderHealthResult));
    const resolvedSessionId = nextSessionId || sessions[0]?.id || null;
    setSelectedSessionId(resolvedSessionId);
    if (resolvedSessionId) {
      const detail = await apiFetch<{ session: Record<string, unknown>; intervals: Array<Record<string, unknown>> }>(
        `/api/market/adjustments/admin/sessions/${resolvedSessionId}`,
        { cache: "no-store" }
      );
      setSessionDetail({
        session: normalizeSession(detail.session),
        intervals: detail.intervals.map(normalizeInterval),
      });
    }
  }

  async function handleForceNextAdjustment() {
    setForceBusy(true);
    setForceError(null);
    setForceResult(null);
    try {
      const result = await apiFetch<ForceAdjustmentResponse>("/api/market/adjustments/force-next", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const assetRows = await apiFetch<Record<string, unknown>[]>("/api/market/assets");
      setAssets(assetRows.map(toAsset));
      await refreshAdminAdjustmentData();
      setForceResult(result);
    } catch (nextError) {
      setForceError(String((nextError as Error).message || nextError));
    } finally {
      setForceBusy(false);
    }
  }

  async function handleRegenerateDay() {
    const marketDate = regenerateDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      setRegenerateError("Use a YYYY-MM-DD market date.");
      return;
    }

    setRegenerateBusy(true);
    setRegenerateError(null);
    setRegenerateResult(null);
    setForceResult(null);
    try {
      const result = await apiFetch<ForceRegenerateDayResponse>(`/internal/market/settle/${marketDate}`, {
        method: "POST",
        body: JSON.stringify({
          force: true,
          force_adjustments: true,
        }),
      });
      const assetRows = await apiFetch<Record<string, unknown>[]>("/api/market/assets", { cache: "no-store" });
      setAssets(assetRows.map(toAsset));
      const nextSessionId = Number(result.adjustment_session?.session?.id || 0) || null;
      await refreshAdminAdjustmentData(nextSessionId);
      setRegenerateResult(result);
    } catch (nextError) {
      setRegenerateError(String((nextError as Error).message || nextError));
    } finally {
      setRegenerateBusy(false);
    }
  }

  function openConfirmAction(action: MarketResetAction) {
    setConfirmAction(action);
    setConfirmText("");
  }

  function closeConfirmAction() {
    setConfirmAction(null);
    setConfirmText("");
  }

  async function handleConfirmedMarketReset() {
    if (!confirmAction || confirmText.trim() !== confirmAction) return;
    const action = confirmAction;
    closeConfirmAction();
    try {
      if (action === "reset") {
        await resetMarket("reset");
      } else {
        await rebuildMarket("rebuild");
      }
      if (useProfileStore.getState().adminError) return;
      const assetRows = await apiFetch<Record<string, unknown>[]>("/api/market/assets", { cache: "no-store" });
      setAssets(assetRows.map(toAsset));
      await Promise.allSettled([refreshAdminAdjustmentData(), refreshMarketOverview()]);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    }
  }

  if (!initialized || isAuthLoading) {
    return (
      <SiteShell>
        <div className={styles.empty}>Loading admin session...</div>
      </SiteShell>
    );
  }

  if (!user?.is_admin) {
    return (
      <SiteShell>
        <div className={styles.empty}>This page is limited to admin users.</div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>Market Admin</div>
            <h1 className={styles.title}>Market Tuning</h1>
            <p className={styles.copy}>
              Adjust per-asset interval guardrails, supply review cadence, broker buffer settings, and scheduled base-rate ticks.
            </p>
          </div>
          <div className={styles.heroStats}>
            <div><span>Assets</span><strong>{assets.length}</strong></div>
            <div><span>Enabled</span><strong>{enabledCount}</strong></div>
            <div><span>Ready</span><strong>{readyCount}</strong></div>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">{error}</div> : null}

        <section className={styles.configPanel}>
          <div>
            <h2 className={styles.sectionTitle}>Adjustment Schedule</h2>
            <p className={styles.sectionNote}>
              Strengths total {config?.interval_strength_total_pct ?? 200}% across the day. Force Next Tick applies the next scheduled interval now and replaces that future tick.
            </p>
            <div className={styles.regenerateActions}>
              <label className={styles.compactField}>
                <span>Regenerate Market Date</span>
                <input
                  className={styles.compactInput}
                  type="date"
                  value={regenerateDate}
                  onChange={(event) => setRegenerateDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={regenerateBusy || forceBusy || isLoading}
                onClick={() => void handleRegenerateDay()}
              >
                {regenerateBusy ? "Regenerating..." : "Regenerate Day"}
              </button>
              {regenerateResult ? (
                <span className={styles.forceResult}>
                  {regenerateResult.market_date || regenerateDate} regenerated
                  {regenerateResult.adjustment_session?.interval_count !== undefined
                    ? ` · ${regenerateResult.adjustment_session.interval_count} interval rows`
                    : ""}
                </span>
              ) : null}
              {regenerateError ? <span className={styles.forceError}>{regenerateError}</span> : null}
            </div>
            <p className={styles.warningNote}>
              This force-reruns settlement and replaces the adjustment session for that date. Use it for same-day debugging before forcing the next tick.
            </p>
            <div className={styles.forceActions}>
              <button type="button" className={styles.primaryButton} disabled={forceBusy || isLoading} onClick={() => void handleForceNextAdjustment()}>
                {forceBusy ? "Forcing tick..." : "Force Next Tick"}
              </button>
              {forceResult ? (
                <span className={styles.forceResult}>
                  {forceResult.target
                    ? `${formatIntervalLabel(forceResult.target.interval_key)} applied to ${forceResult.applied_count} assets`
                    : "No scheduled tick found"}
                  {forceResult.skipped_prior_count ? ` · skipped ${forceResult.skipped_prior_count} missed rows` : ""}
                </span>
              ) : null}
              {forceError ? <span className={styles.forceError}>{forceError}</span> : null}
            </div>
          </div>
          <div className={styles.intervalGrid}>
            {(config?.intervals || []).map((interval) => (
              <div key={interval.key} className={styles.intervalPill}>
                <span>{interval.label}</span>
                <strong>{interval.time}{interval.next_day ? " next day" : ""}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.toolbar}>
            <div>
              <h2 className={styles.sectionTitle}>Adjustment Operations</h2>
              <p className={styles.sectionNote}>Session status, interval completion, hidden tick strength, forced tick results, scheduler freshness, and drill-down metadata.</p>
            </div>
            <label className={styles.searchField}>
              <span>Session</span>
              <select
                className={styles.select}
                value={selectedSessionId ?? ""}
                onChange={(event) => setSelectedSessionId(Number(event.target.value) || null)}
              >
                {adminSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.market_date} · {session.status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {adminAdjustmentError ? <div className="statusMessage statusMessageError">{adminAdjustmentError}</div> : null}
          {isLoadingAdminAdjustments ? <div className={styles.empty}>Loading adjustment operations...</div> : null}

          <div className={styles.opsGrid}>
            <div className={styles.opsCard}>
              <span>Scheduler</span>
              <strong>{adminHealth?.scheduler_enabled ? "Enabled" : "Disabled"}</strong>
              <p>{adminHealth?.scheduler_lock_held ? "Scheduler lock is currently held." : "No active scheduler lock detected."}</p>
            </div>
            <div className={styles.opsCard}>
              <span>Next Due</span>
              <strong>{formatDateTime(adminHealth?.next_scheduled_at)}</strong>
              <p>{adminHealth?.scheduled_count ?? 0} scheduled rows open.</p>
            </div>
            <div className={styles.opsCard}>
              <span>Stuck Rows</span>
              <strong>{adminHealth?.stuck_scheduled_count ?? 0}</strong>
              <p>{adminHealth?.overdue_scheduled_count ?? 0} rows are more than 10 minutes overdue.</p>
            </div>
            <div className={styles.opsCard}>
              <span>24H Result</span>
              <strong>{adminHealth?.applied_24h_count ?? 0} / {adminHealth?.skipped_24h_count ?? 0}</strong>
              <p>Applied / skipped intervals over the last 24 hours.</p>
            </div>
          </div>

          <div className={styles.liveOrderAdminPanel}>
            <div className={styles.sectionHead}>
              <div>
                <h3 className={styles.sectionTitle}>Live Order Batch Health</h3>
                <p className={styles.sectionNote}>Queued market orders execute in best-effort batches. Rejections here usually mean price, cash, holding, or interval-limit checks failed at execution.</p>
              </div>
            </div>
            <div className={styles.opsGrid}>
              <div className={styles.opsCard}>
                <span>Scheduler</span>
                <strong>{liveOrderHealth?.scheduler_enabled ? "Enabled" : "Disabled"}</strong>
                <p>{liveOrderHealth?.scheduler_interval_ms ? `${Math.round(liveOrderHealth.scheduler_interval_ms / 1000)}s poll · ${liveOrderHealth.batch_limit} max per batch` : "No scheduler config loaded."}</p>
              </div>
              <div className={styles.opsCard}>
                <span>Next Batch</span>
                <strong>{formatDateTime(liveOrderHealth?.health.next_execute_after)}</strong>
                <p>{liveOrderHealth?.health.pending_count ?? 0} pending orders total.</p>
              </div>
              <div className={styles.opsCard}>
                <span>Due / Overdue</span>
                <strong>{liveOrderHealth?.health.due_pending_count ?? 0} / {liveOrderHealth?.health.overdue_pending_count ?? 0}</strong>
                <p>Overdue means execute_after is more than 10 minutes old.</p>
              </div>
              <div className={styles.opsCard}>
                <span>24H Results</span>
                <strong>{liveOrderHealth?.health.filled_24h_count ?? 0} / {liveOrderHealth?.health.rejected_24h_count ?? 0}</strong>
                <p>Filled / rejected live orders over the last 24 hours.</p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Attempted</th>
                    <th>Filled</th>
                    <th>Rejected</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(liveOrderHealth?.recent_batches || []).map((batch) => (
                    <tr key={batch.id}>
                      <td>#{batch.id}</td>
                      <td>{batch.status}</td>
                      <td>{formatDateTime(batch.started_at)}</td>
                      <td>{batch.orders_attempted}</td>
                      <td>{batch.orders_filled}</td>
                      <td>{batch.orders_rejected}</td>
                      <td>{batch.error_text || "N/A"}</td>
                    </tr>
                  ))}
                  {!liveOrderHealth?.recent_batches.length ? (
                    <tr>
                      <td colSpan={7}>No live-order batches have run yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {sessionDetail?.session ? (
            <div className={styles.sessionSummary}>
              <div>
                <span>Market date</span>
                <strong>{sessionDetail.session.market_date}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{sessionDetail.session.status}</strong>
              </div>
              <div>
                <span>Progress</span>
                <strong>{formatPct((sessionDetail.session.completion_pct ?? 0) / 100)}</strong>
              </div>
              <div>
                <span>Rows</span>
                <strong>{sessionDetail.session.applied_count} applied · {sessionDetail.session.skipped_count} skipped · {sessionDetail.session.scheduled_count} scheduled</strong>
              </div>
            </div>
          ) : null}

          {sessionAssetRows.length ? (
            <div className={styles.intervalGridWrap}>
              <table className={styles.intervalMatrix}>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Open</th>
                    <th>Lunch</th>
                    <th>Late</th>
                    <th>Overnight</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionAssetRows.map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <AssetMark asset={{ id: 0, symbol: row.symbol, display_name: row.display_name, icon: row.icon, color: row.color }} />
                      </td>
                      {["open", "lunch", "late", "overnight"].map((key) => {
                        const interval = row.intervals[key];
                        return (
                          <td key={key}>
                            {interval ? (
                              <button
                                type="button"
                                className={`${styles.intervalCell} ${styles[`intervalCell_${interval.status}`] || ""}`}
                                onClick={() => setSelectedInterval(interval)}
                              >
                                <strong>{interval.status}</strong>
                                <span>{formatDateTime(interval.applied_at || interval.scheduled_at)}</span>
                                <em>{formatStrengthPct(interval.strength_pct)} toward base</em>
                                {interval.price_before !== null ? <em>{formatPrice(interval.price_before)} to {formatPrice(interval.price_after)}</em> : null}
                              </button>
                            ) : (
                              <span className={styles.intervalEmpty}>N/A</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !isLoadingAdminAdjustments ? (
            <div className={styles.empty}>No interval rows are available for this session.</div>
          ) : null}

          {selectedInterval ? (
            <aside className={styles.detailDrawer}>
              <div className={styles.detailDrawerHead}>
                <div>
                  <h3>{selectedInterval.symbol} · {formatIntervalLabel(selectedInterval.interval_key)}</h3>
                  <p>{selectedInterval.status} · scheduled {formatDateTime(selectedInterval.scheduled_at)}</p>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={() => setSelectedInterval(null)}>Close</button>
              </div>
              <div className={styles.detailGrid}>
                <div><span>Base</span><strong>{formatPrice(selectedInterval.base_rate)}</strong></div>
                <div><span>Toward base</span><strong>{formatStrengthPct(selectedInterval.strength_pct)}</strong></div>
                <div><span>Before</span><strong>{formatPrice(selectedInterval.price_before)}</strong></div>
                <div><span>After</span><strong>{formatPrice(selectedInterval.price_after)}</strong></div>
                <div><span>Move</span><strong>{formatPct(selectedInterval.move_pct)}</strong></div>
                <div><span>Gap compression</span><strong>{formatPct(selectedInterval.gap_compression_pct)}</strong></div>
                <div><span>Price event</span><strong>{selectedInterval.price_event_id ? `#${selectedInterval.price_event_id}` : "N/A"}</strong></div>
              </div>
              <div className={styles.metadataBlock}>
                <span>Metadata / skip reason</span>
                <pre>{JSON.stringify({ skip_reason: selectedInterval.skip_reason, ...selectedInterval.metadata_json }, null, 2)}</pre>
              </div>
            </aside>
          ) : null}
        </section>

        <section className={styles.section}>
          <div className={styles.toolbar}>
            <div>
              <h2 className={styles.sectionTitle}>Asset Parameters</h2>
              <p className={styles.sectionNote}>Changes save one asset at a time and clear the cached market asset list.</p>
            </div>
            <label className={styles.searchField}>
              <span>Filter</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol, name, or unit" />
            </label>
          </div>

          {isLoading ? <div className={styles.empty}>Loading market tuning parameters...</div> : null}

          {!isLoading && filteredAssets.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Base Rate</th>
                    <th>Market Price</th>
                    <th>Adjustment</th>
                    <th>Strength Range</th>
                    <th>Cadence</th>
                    <th>Buffer</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => (
                    <TuningRow
                      key={asset.id}
                      asset={asset}
                      onSaved={(nextAsset) =>
                        setAssets((current) => current.map((entry) => (entry.id === nextAsset.id ? nextAsset : entry)))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {!isLoading && !filteredAssets.length ? (
            <div className={styles.empty}>No assets match that filter.</div>
          ) : null}
        </section>

        <section className={`${styles.section} ${styles.resetPanel}`}>
          <div>
            <h2 className={styles.sectionTitle}>Market Reset Controls</h2>
            <p className={styles.sectionNote}>
              Reset clears derived market and portfolio state. Rebuild recalculates assets, fundamentals, and settlement history.
            </p>
          </div>
          <div className={styles.resetActions}>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => openConfirmAction("reset")}
              disabled={adminBusy !== false}
            >
              {adminBusy === "reset" ? "Resetting..." : "Reset market"}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => openConfirmAction("rebuild")}
              disabled={adminBusy !== false}
            >
              {adminBusy === "rebuild" ? "Rebuilding..." : "Rebuild market"}
            </button>
          </div>
          {adminError ? <div className="statusMessage statusMessageError">Admin error: {adminError}</div> : null}
          {adminStatus ? <div className="statusMessage statusMessageSuccess">{adminStatus}</div> : null}
        </section>
      </div>
      {confirmAction ? (
        <div className={styles.modalOverlay} onClick={closeConfirmAction}>
          <div className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="market-reset-confirm-title" onClick={(event) => event.stopPropagation()}>
            <div>
              <div className={styles.eyebrow}>Destructive Market Action</div>
              <h2 id="market-reset-confirm-title" className={styles.sectionTitle}>
                {confirmAction === "reset" ? "Confirm market reset" : "Confirm market rebuild"}
              </h2>
              <p className={styles.sectionNote}>
                Type <strong>{confirmAction}</strong> to continue. The server request will not be sent until the typed confirmation matches.
              </p>
            </div>
            <input
              className={styles.confirmInput}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={confirmAction}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={closeConfirmAction}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleConfirmedMarketReset()}
                disabled={adminBusy !== false || confirmText.trim() !== confirmAction}
              >
                {confirmAction === "reset" ? "Reset market" : "Rebuild market"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
