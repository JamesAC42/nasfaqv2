"use client";

import { schedulerLabel } from "./admin-api";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  asArray,
  fetchAdjustmentHealth,
  fetchLiveOrderHealth,
  toNumber,
  type AdjustmentHealth,
  type LiveOrderHealth,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, Switch, Tabs, adminErrorText, adminUi as ui, etTime, fmtCount, marketDateKey, until, useHashTab } from "@/app/components/admin/admin-ui";
import { EvaluationNow } from "@/app/components/admin/evaluation-now";
import { Oshimark } from "@/app/components/common/oshimark";
import { apiFetch } from "@/app/lib/api";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/admin/admin-market-tuning-page.module.scss";

// /admin/market-tuning: the base-rate tick schedule (force the next tick, regenerate a day, the
// session matrix), live-order batch health, per-stock guardrails, the weekly evaluation on demand
// (playtests) and the reset/rebuild controls.
// Every list from the API goes through asArray(): a missing field used to crash the page with
// "Cannot read properties of undefined (reading 'map')".

type MarketTuningConfig = {
  interval_strength_total_pct?: number;
  intervals?: Array<{ key: string; label: string; time: string; timezone: string; next_day?: boolean }>;
  asset_tuning_defaults?: {
    adjustment_min_pct: number;
    adjustment_max_pct: number;
    adjustment_enabled: boolean;
    supply_evaluation_cadence: string;
    broker_buffer_pct: number;
  };
  phase?: { status: string; description: string };
};

type MarketTuningAsset = {
  id: number;
  symbol: string;
  display_name: string;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  base_rate?: number | null;
  market_price?: number | null;
  premium_discount_pct?: number | null;
  adjustment_min_pct?: number | null;
  adjustment_max_pct?: number | null;
  adjustment_enabled?: boolean | null;
  supply_evaluation_cadence?: string | null;
  broker_buffer_pct?: number | null;
  adjustment_ready?: boolean | null;
};

type ForceAdjustmentResponse = {
  applied_count?: number;
  skipped_count?: number;
  skipped_prior_count?: number;
  market_date?: string;
  target?: { interval_key: string; scheduled_at: string; applied_at: string } | null;
};

type ForceRegenerateDayResponse = {
  market_date?: string;
  settled_count?: number;
  adjustment_session?: {
    session?: { id?: number | string; market_date?: string; status?: string };
    created?: boolean;
    interval_count?: number;
  };
};

type AdjustmentSession = {
  id: number;
  market_date: string;
  status: string;
  interval_count: number;
  asset_count: number;
  scheduled_count: number;
  applied_count: number;
  skipped_count: number;
  cancelled_count: number;
  completion_pct: number | null;
};

type AdjustmentInterval = {
  id: number;
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
  move_pct: number | null;
  gap_compression_pct: number | null;
};

type TabKey = (typeof TAB_KEYS)[number];
const TAB_KEYS = ["ticks", "live-orders", "stocks", "evaluation", "reset"] as const;
const INTERVAL_KEYS = ["open", "lunch", "late", "overnight"] as const;
const CADENCE_OPTIONS = ["weekly", "monthly", "quarterly", "manual"];

const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

function toAsset(row: Record<string, unknown> | null | undefined): MarketTuningAsset {
  const r = row ?? {};
  return {
    id: Number(r.id || 0),
    symbol: String(r.symbol || ""),
    display_name: String(r.display_name || ""),
    unit: str(r.unit),
    icon: str(r.icon),
    color: str(r.color),
    base_rate: toNumber(r.base_rate ?? r.current_fair_value),
    market_price: toNumber(r.market_price ?? r.current_mid_price),
    premium_discount_pct: toNumber(r.premium_discount_pct ?? r.current_premium_pct),
    adjustment_min_pct: toNumber(r.adjustment_min_pct),
    adjustment_max_pct: toNumber(r.adjustment_max_pct),
    adjustment_enabled: typeof r.adjustment_enabled === "boolean" ? r.adjustment_enabled : null,
    supply_evaluation_cadence: str(r.supply_evaluation_cadence),
    broker_buffer_pct: toNumber(r.broker_buffer_pct),
    adjustment_ready: typeof r.adjustment_ready === "boolean" ? r.adjustment_ready : null,
  };
}

function normalizeSession(row: Record<string, unknown> | null | undefined): AdjustmentSession {
  const r = row ?? {};
  const n = (value: unknown) => Number(toNumber(value) || 0);
  return {
    id: n(r.id),
    market_date: String(r.market_date || ""),
    status: String(r.status || ""),
    interval_count: n(r.interval_count),
    asset_count: n(r.asset_count),
    scheduled_count: n(r.scheduled_count),
    applied_count: n(r.applied_count),
    skipped_count: n(r.skipped_count),
    cancelled_count: n(r.cancelled_count),
    completion_pct: toNumber(r.completion_pct),
  };
}

function normalizeInterval(row: Record<string, unknown>): AdjustmentInterval {
  return {
    id: Number(row.id || 0),
    symbol: String(row.symbol || ""),
    display_name: String(row.display_name || ""),
    icon: str(row.icon),
    color: str(row.color),
    interval_key: String(row.interval_key || ""),
    scheduled_at: str(row.scheduled_at),
    applied_at: str(row.applied_at),
    status: String(row.status || ""),
    strength_pct: toNumber(row.strength_pct),
    base_rate: toNumber(row.base_rate),
    price_before: toNumber(row.price_before),
    price_after: toNumber(row.price_after),
    metadata_json: row.metadata_json && typeof row.metadata_json === "object" ? (row.metadata_json as Record<string, unknown>) : null,
    skip_reason: str(row.skip_reason),
    price_event_id: toNumber(row.price_event_id),
    move_pct: toNumber(row.move_pct),
    gap_compression_pct: toNumber(row.gap_compression_pct),
  };
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value >= 100 ? 2 : 4 })}`;
}

function formatPct(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  const text = `${Math.abs(pct).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (!signed) return `${pct < 0 ? "−" : ""}${text}`;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${text}`;
}

const plain = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "" : String(value));

const intervalLabel = (key: string | null | undefined) => ({ open: "Open", lunch: "Lunch", late: "Late", overnight: "Overnight" })[key ?? ""] ?? key ?? "—";

function getEasternDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Per-stock row ─────────────────────────────────────────────────────────

type Defaults = NonNullable<MarketTuningConfig["asset_tuning_defaults"]>;

function TuningRow({ asset, defaults, onSaved }: { asset: MarketTuningAsset; defaults: Defaults | null; onSaved: (asset: MarketTuningAsset) => void }) {
  const initial = useMemo(
    () => ({
      min: plain(asset.adjustment_min_pct ?? defaults?.adjustment_min_pct),
      max: plain(asset.adjustment_max_pct ?? defaults?.adjustment_max_pct),
      enabled: asset.adjustment_enabled ?? defaults?.adjustment_enabled ?? true,
      cadence: asset.supply_evaluation_cadence || defaults?.supply_evaluation_cadence || "weekly",
      buffer: plain(asset.broker_buffer_pct ?? defaults?.broker_buffer_pct),
    }),
    [asset, defaults],
  );
  const [draft, setDraft] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setDraft(initial);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = draft.min !== initial.min || draft.max !== initial.max || draft.enabled !== initial.enabled || draft.cadence !== initial.cadence || draft.buffer !== initial.buffer;
  const usingDefaults = asset.adjustment_min_pct === null && asset.adjustment_max_pct === null && asset.broker_buffer_pct === null;

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  async function save() {
    const min = Number(draft.min);
    const max = Number(draft.max);
    const buffer = Number(draft.buffer);
    if (draft.min.trim() === "" || !Number.isFinite(min) || min < 0) return setError("Min has to be zero or more.");
    if (draft.max.trim() === "" || !Number.isFinite(max) || max < min) return setError("Max has to be at least the min.");
    if (draft.buffer.trim() === "" || !Number.isFinite(buffer) || buffer < 0 || buffer >= 1) return setError("Buffer is a fraction between 0 and 1.");
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ asset?: Record<string, unknown> }>(`/api/market/assets/${encodeURIComponent(asset.symbol)}/tuning`, {
        method: "PATCH",
        body: JSON.stringify({
          adjustment_min_pct: min,
          adjustment_max_pct: max,
          adjustment_enabled: draft.enabled,
          supply_evaluation_cadence: draft.cadence,
          broker_buffer_pct: buffer,
        }),
      });
      if (!result?.asset) throw new Error("The API didn't send the stock back.");
      // Keep the prices we already have if the tuning payload leaves them out.
      const next = toAsset(result.asset);
      onSaved({ ...asset, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== "")), id: asset.id });
      setSaved(true);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const premium = asset.premium_discount_pct;
  return (
    <div className={styles.stockRow} role="row" data-dirty={dirty || undefined} data-off={!draft.enabled || undefined}>
      <div className={styles.stockName} role="cell">
        <Oshimark icon={asset.icon} symbol={asset.symbol} size={22} />
        <div>
          <b>{asset.symbol}</b>
          <span>{asset.display_name}</span>
        </div>
      </div>
      <div className={styles.num} role="cell" data-label="Base">
        {formatPrice(asset.base_rate)}
      </div>
      <div className={styles.num} role="cell" data-label="Market">
        {formatPrice(asset.market_price)}
        <small data-tone={premium && premium > 0 ? "up" : premium && premium < 0 ? "down" : undefined}>{formatPct(premium, true)}</small>
      </div>
      <div role="cell" data-label="Ticks" className={styles.cellSwitch}>
        <Switch checked={draft.enabled} onChange={(next) => setDraft({ ...draft, enabled: next })} label={`${asset.symbol} ticks`} on="On" off="Paused" />
      </div>
      <label role="cell" className={styles.cellInput} data-label="Min %">
        <span className={ui.srOnly}>{asset.symbol} minimum strength %</span>
        <input className={ui.inputNum} inputMode="decimal" value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} />
      </label>
      <label role="cell" className={styles.cellInput} data-label="Max %">
        <span className={ui.srOnly}>{asset.symbol} maximum strength %</span>
        <input className={ui.inputNum} inputMode="decimal" value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} />
      </label>
      <label role="cell" className={styles.cellInput} data-label="Supply check">
        <span className={ui.srOnly}>{asset.symbol} supply check cadence</span>
        <select className={ui.select} value={draft.cadence} onChange={(event) => setDraft({ ...draft, cadence: event.target.value })}>
          {CADENCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label role="cell" className={styles.cellInput} data-label="Buffer">
        <span className={ui.srOnly}>{asset.symbol} broker buffer</span>
        <input className={ui.inputNum} inputMode="decimal" value={draft.buffer} onChange={(event) => setDraft({ ...draft, buffer: event.target.value })} />
      </label>
      <div role="cell" className={styles.cellSave}>
        <button type="button" className={dirty ? ui.btnPrimary : ui.btn} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "…" : "Save"}
        </button>
        {saved ? (
          <span className={ui.inlineOk}>Saved</span>
        ) : asset.adjustment_ready === false ? (
          <span className={ui.pill} data-tone="warn">
            No price
          </span>
        ) : usingDefaults ? (
          <span className={ui.pill} data-tone="dim">
            Default
          </span>
        ) : null}
      </div>
      {error ? (
        <p className={`${ui.inlineError} ${styles.rowError}`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function AdminMarketTuningPage() {
  const access = useAdminAccess();
  const now = useNow(1000);
  const adminBusy = useProfileStore((state) => state.adminBusy);
  const adminStatus = useProfileStore((state) => state.adminStatus);
  const adminError = useProfileStore((state) => state.adminError);
  const resetMarket = useProfileStore((state) => state.resetMarket);
  const rebuildMarket = useProfileStore((state) => state.rebuildMarket);
  const refreshMarketOverview = useMarketStore((state) => state.refreshOverview);

  const [tab, setTabState] = useState<TabKey>("ticks");
  const setTab = useHashTab(TAB_KEYS, "ticks", setTabState);
  const [assets, setAssets] = useState<MarketTuningAsset[]>([]);
  const [config, setConfig] = useState<MarketTuningConfig | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<AdjustmentHealth | null>(null);
  const [liveHealth, setLiveHealth] = useState<LiveOrderHealth | null>(null);
  const [sessions, setSessions] = useState<AdjustmentSession[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ session: AdjustmentSession; intervals: AdjustmentInterval[] } | null>(null);
  const [picked, setPicked] = useState<AdjustmentInterval | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);

  const [forceBusy, setForceBusy] = useState(false);
  const [forceResult, setForceResult] = useState<ForceAdjustmentResponse | null>(null);
  const [forceError, setForceError] = useState<string | null>(null);
  const [regenDate, setRegenDate] = useState(() => getEasternDateKey());
  const [regenArmed, setRegenArmed] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState<ForceRegenerateDayResponse | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"reset" | "rebuild" | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const isAdmin = access.isAdmin;

  const loadAssets = useCallback(async () => {
    const rows = await apiFetch<unknown>("/api/market/assets", { cache: "no-store" });
    setAssets(asArray(rows).map(toAsset).filter((asset) => asset.symbol));
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const result = await apiFetch<{ session?: Record<string, unknown>; intervals?: unknown }>(`/api/market/adjustments/admin/sessions/${id}`, { cache: "no-store" });
    setDetail({ session: normalizeSession(result?.session), intervals: asArray(result?.intervals).map(normalizeInterval) });
  }, []);

  const loadOps = useCallback(
    async (preferSessionId?: number | null) => {
      try {
        const [sessionsResult, adjust, live] = await Promise.all([
          apiFetch<{ sessions?: unknown }>("/api/market/adjustments/admin/sessions?limit=30", { cache: "no-store" }),
          fetchAdjustmentHealth(),
          fetchLiveOrderHealth(8),
        ]);
        const list = asArray(sessionsResult?.sessions).map(normalizeSession);
        setSessions(list);
        setHealth(adjust);
        setLiveHealth(live);
        setOpsError(null);
        const next = preferSessionId && list.some((session) => session.id === preferSessionId) ? preferSessionId : null;
        setSessionId((current) => next ?? (current && list.some((session) => session.id === current) ? current : (list[0]?.id ?? null)));
        return next;
      } catch (caught) {
        setOpsError(adminErrorText(caught));
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!access.initialized || !isAdmin) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [, tuning] = await Promise.all([loadAssets(), apiFetch<MarketTuningConfig>("/api/market/tuning/config", { cache: "no-store" })]);
        if (!cancelled) setConfig(tuning ?? null);
      } catch (caught) {
        if (!cancelled) setError(adminErrorText(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) await loadOps();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [access.initialized, isAdmin, loadAssets, loadOps]);

  useEffect(() => {
    if (!sessionId || !isAdmin) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadDetail(sessionId)
        .then(() => {
          if (!cancelled) setPicked(null);
        })
        .catch((caught) => {
          if (!cancelled) setOpsError(adminErrorText(caught));
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, isAdmin, loadDetail]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter((asset) => `${asset.symbol} ${asset.display_name} ${asset.unit || ""}`.toLowerCase().includes(needle));
  }, [assets, query]);

  const matrix = useMemo(() => {
    const byAsset = new Map<string, { symbol: string; display_name: string; icon: string | null; intervals: Record<string, AdjustmentInterval> }>();
    for (const interval of detail?.intervals ?? []) {
      const current = byAsset.get(interval.symbol) ?? { symbol: interval.symbol, display_name: interval.display_name, icon: interval.icon, intervals: {} };
      current.intervals[interval.interval_key] = interval;
      byAsset.set(interval.symbol, current);
    }
    return [...byAsset.values()];
  }, [detail?.intervals]);

  async function forceNext() {
    setForceBusy(true);
    setForceError(null);
    setForceResult(null);
    try {
      const result = await apiFetch<ForceAdjustmentResponse>("/api/market/adjustments/force-next", { method: "POST", body: JSON.stringify({}) });
      await loadAssets();
      const id = await loadOps();
      if (id ?? sessionId) await loadDetail((id ?? sessionId) as number);
      setForceResult(result ?? {});
    } catch (caught) {
      setForceError(adminErrorText(caught));
    } finally {
      setForceBusy(false);
    }
  }

  async function regenerate() {
    const marketDate = regenDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      setRegenError("Use a YYYY-MM-DD market date.");
      return;
    }
    setRegenBusy(true);
    setRegenError(null);
    setRegenResult(null);
    setForceResult(null);
    try {
      const result = await apiFetch<ForceRegenerateDayResponse>(`/internal/market/settle/${marketDate}`, {
        method: "POST",
        body: JSON.stringify({ force: true, force_adjustments: true }),
      });
      await loadAssets();
      const nextId = Number(result?.adjustment_session?.session?.id || 0) || null;
      const id = await loadOps(nextId);
      if (id) await loadDetail(id);
      setRegenResult(result ?? {});
      setRegenArmed(false);
    } catch (caught) {
      setRegenError(adminErrorText(caught));
    } finally {
      setRegenBusy(false);
    }
  }

  async function confirmedReset() {
    if (!confirmAction || confirmText.trim() !== confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setConfirmText("");
    try {
      if (action === "reset") await resetMarket("reset");
      else await rebuildMarket("rebuild");
      if (useProfileStore.getState().adminError) return;
      await loadAssets();
      await Promise.allSettled([loadOps(), refreshMarketOverview()]);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }

  useEffect(() => {
    if (!confirmAction) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmAction(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmAction]);

  if (!access.initialized) return <AdminLoading title="Market tuning" />;
  if (!isAdmin) return <AdminGate title="Market tuning" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const enabledCount = assets.filter((asset) => asset.adjustment_enabled ?? config?.asset_tuning_defaults?.adjustment_enabled ?? true).length;
  const readyCount = assets.filter((asset) => asset.adjustment_ready).length;
  const readyKnown = assets.some((asset) => asset.adjustment_ready !== null);
  const stuck = health ? health.stuck_scheduled_count + health.overdue_scheduled_count : 0;
  const session = detail?.session ?? null;
  const intervals = asArray<NonNullable<MarketTuningConfig["intervals"]>[number]>(config?.intervals);
  const defaults = config?.asset_tuning_defaults ?? null;

  const tabs = [
    { key: "ticks" as const, label: "Ticks", count: stuck ? `${stuck} stuck` : undefined, tone: stuck ? ("warn" as const) : undefined },
    { key: "live-orders" as const, label: "Live orders", count: liveHealth ? liveHealth.health.pending_count : undefined },
    { key: "stocks" as const, label: "Per-stock", count: assets.length || undefined },
    { key: "evaluation" as const, label: "Weekly evaluation" },
    { key: "reset" as const, label: "Reset & rebuild" },
  ];

  return (
    <AdminFrame
      title="Market tuning"
      blurb={
        loading ? (
          "Loading the tape…"
        ) : (
          <>
            <b>{assets.length}</b> stocks, <b>{enabledCount}</b> ticking{readyKnown ? <>, <b>{readyCount}</b> ready</> : null}.
            {health?.next_scheduled_at ? (
              <>
                {" "}
                Next tick <b>{etTime(health.next_scheduled_at, false)}</b>, {until(health.next_scheduled_at, now)}.
              </>
            ) : null}
          </>
        )
      }
    >
      {error ? <Notice>{error}</Notice> : null}

      <div className={ui.stripWrap}>
        <div className={ui.strip} style={{ ["--cols" as string]: 6, ["--cols-tablet" as string]: 3 }}>
          <div className={ui.stat} data-tone={health && health.scheduler_status !== "running" ? "warn" : "blue"}>
            <small>Tick scheduler</small>
            <b>{health ? schedulerLabel(health) : "—"}</b>
            <em>{health ? `every ${Math.round(health.scheduler_interval_ms / 1000)}s${health.scheduler_lock_held ? " · lock held" : ""}` : " "}</em>
          </div>
          <div className={ui.stat}>
            <small>Next tick</small>
            <b>{health?.next_scheduled_at ? etTime(health.next_scheduled_at, false).replace(" ET", "") : "—"}</b>
            <em>{health?.next_scheduled_at ? `ET · ${until(health.next_scheduled_at, now)}` : `${fmtCount(health?.scheduled_count)} scheduled`}</em>
          </div>
          <div className={ui.stat} data-tone={stuck ? "warn" : undefined}>
            <small>Stuck</small>
            <b>{health ? fmtCount(health.stuck_scheduled_count) : "—"}</b>
            <em>{health ? `${fmtCount(health.overdue_scheduled_count)} over 10m late` : " "}</em>
          </div>
          <div className={ui.stat}>
            <small>Ticks 24h</small>
            <b>{health ? fmtCount(health.applied_24h_count) : "—"}</b>
            <em>{health ? `${fmtCount(health.skipped_24h_count)} skipped` : " "}</em>
          </div>
          <div className={ui.stat} data-tone={liveHealth?.health.overdue_pending_count ? "warn" : undefined}>
            <small>Queued orders</small>
            <b>{liveHealth ? fmtCount(liveHealth.health.pending_count) : "—"}</b>
            <em>{liveHealth ? `${fmtCount(liveHealth.health.overdue_pending_count)} overdue` : " "}</em>
          </div>
          <div className={ui.stat}>
            <small>Orders 24h</small>
            <b>{liveHealth ? fmtCount(liveHealth.health.filled_24h_count) : "—"}</b>
            <em>{liveHealth ? `${fmtCount(liveHealth.health.rejected_24h_count)} rejected` : " "}</em>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Market tuning sections" />
      {opsError && tab !== "stocks" && tab !== "reset" ? <Notice>{opsError}</Notice> : null}

      {tab === "ticks" ? (
        <div role="tabpanel" id="panel-ticks" aria-labelledby="tab-ticks">
          <Section title="Schedule" hint={`Tick strengths add up to ${config?.interval_strength_total_pct ?? 200}% a day, pulling price toward base.`}>
            <ol className={styles.intervals}>
              {intervals.map((interval) => (
                <li key={interval.key} data-next={health?.next_scheduled_at && etTime(health.next_scheduled_at, false).startsWith(interval.time) ? true : undefined}>
                  <span>{interval.label}</span>
                  <b>{interval.time}</b>
                  <small>{interval.next_day ? "ET, next day" : "ET"}</small>
                </li>
              ))}
              {!intervals.length ? <li className={styles.muted}>No interval config from the API.</li> : null}
            </ol>

            <div className={styles.actions}>
              <div className={styles.action}>
                <h3>Force the next tick</h3>
                <p>Applies the next scheduled interval now and drops that future tick.</p>
                <div className={styles.actionRow}>
                  <button type="button" className={ui.btnPrimary} disabled={forceBusy || regenBusy || loading} onClick={() => void forceNext()}>
                    {forceBusy ? "Ticking…" : "Force next tick"}
                  </button>
                </div>
                <div aria-live="polite">
                  {forceResult ? (
                    <p className={styles.result}>
                      {forceResult.target
                        ? `${intervalLabel(forceResult.target.interval_key)} applied to ${forceResult.applied_count ?? 0} stocks`
                        : "No scheduled tick to force."}
                      {forceResult.skipped_prior_count ? ` · skipped ${forceResult.skipped_prior_count} missed rows` : ""}
                    </p>
                  ) : null}
                  {forceError ? <p className={ui.inlineError}>{forceError}</p> : null}
                </div>
              </div>

              <div className={styles.action} data-danger>
                <h3>Regenerate a day</h3>
                <p>Re-runs settlement for that date and replaces its tick session. For same-day debugging.</p>
                <div className={styles.actionRow}>
                  <label className={ui.field}>
                    <span>Market date</span>
                    <input
                      className={ui.inputNum}
                      type="date"
                      value={regenDate}
                      onChange={(event) => {
                        setRegenDate(event.target.value);
                        setRegenArmed(false);
                      }}
                    />
                  </label>
                  {regenArmed ? (
                    <>
                      <button type="button" className={ui.btnDangerSolid} disabled={regenBusy || forceBusy} onClick={() => void regenerate()}>
                        {regenBusy ? "Regenerating…" : `Yes, redo ${regenDate}`}
                      </button>
                      <button type="button" className={ui.btnGhost} onClick={() => setRegenArmed(false)} disabled={regenBusy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={ui.btnDanger} disabled={regenBusy || forceBusy || loading} onClick={() => setRegenArmed(true)}>
                      Regenerate day
                    </button>
                  )}
                </div>
                <div aria-live="polite">
                  {regenResult ? (
                    <p className={styles.result}>
                      {marketDateKey(regenResult.market_date) !== "—" ? marketDateKey(regenResult.market_date) : regenDate} regenerated
                      {regenResult.adjustment_session?.interval_count !== undefined ? ` · ${regenResult.adjustment_session.interval_count} interval rows` : ""}
                    </p>
                  ) : null}
                  {regenError ? <p className={ui.inlineError}>{regenError}</p> : null}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Session"
            hint={session ? `${marketDateKey(session.market_date)} · ${session.status}` : undefined}
            actions={
              <label className={styles.sessionPick}>
                <span className={ui.srOnly}>Session</span>
                <select className={ui.select} value={sessionId ?? ""} onChange={(event) => setSessionId(Number(event.target.value) || null)}>
                  {sessions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {marketDateKey(entry.market_date)} · {entry.status}
                    </option>
                  ))}
                  {!sessions.length ? <option value="">No sessions</option> : null}
                </select>
              </label>
            }
          >
            {session ? (
              <div className={styles.progress}>
                <div className={styles.progressBar} aria-hidden="true">
                  <i data-kind="applied" style={{ flexGrow: session.applied_count }} />
                  <i data-kind="skipped" style={{ flexGrow: session.skipped_count }} />
                  <i data-kind="scheduled" style={{ flexGrow: session.scheduled_count }} />
                  <i data-kind="cancelled" style={{ flexGrow: session.cancelled_count }} />
                </div>
                <ul className={styles.progressLegend}>
                  <li data-kind="applied">
                    <i aria-hidden="true" />
                    applied <b>{fmtCount(session.applied_count)}</b>
                  </li>
                  <li data-kind="skipped">
                    <i aria-hidden="true" />
                    skipped <b>{fmtCount(session.skipped_count)}</b>
                  </li>
                  <li data-kind="scheduled">
                    <i aria-hidden="true" />
                    scheduled <b>{fmtCount(session.scheduled_count)}</b>
                  </li>
                  {session.cancelled_count ? (
                    <li data-kind="cancelled">
                      <i aria-hidden="true" />
                      cancelled <b>{fmtCount(session.cancelled_count)}</b>
                    </li>
                  ) : null}
                  <li>
                    done <b>{session.completion_pct === null ? "—" : `${Math.round(session.completion_pct)}%`}</b>
                  </li>
                </ul>
              </div>
            ) : null}

            {matrix.length ? (
              <div className={styles.matrixWrap}>
                <table className={styles.matrix}>
                  <thead>
                    <tr>
                      <th scope="col">Stock</th>
                      {INTERVAL_KEYS.map((key) => (
                        <th scope="col" key={key}>
                          {intervalLabel(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row) => (
                      <tr key={row.symbol}>
                        <th scope="row">
                          <span className={styles.matrixStock}>
                            <Oshimark icon={row.icon} symbol={row.symbol} size={16} />
                            <b>{row.symbol}</b>
                          </span>
                        </th>
                        {INTERVAL_KEYS.map((key) => {
                          const cell = row.intervals[key];
                          return (
                            <td key={key}>
                              {cell ? (
                                <button
                                  type="button"
                                  className={styles.cell}
                                  data-status={cell.status}
                                  aria-pressed={picked?.id === cell.id}
                                  aria-label={`${row.symbol} ${intervalLabel(key)}: ${cell.status}`}
                                  onClick={() => setPicked(picked?.id === cell.id ? null : cell)}
                                >
                                  <span className={styles.cellStatus}>{cell.status}</span>
                                  <span className={styles.cellMove}>
                                    {cell.move_pct !== null ? formatPct(cell.move_pct, true) : cell.strength_pct !== null ? `${cell.strength_pct}%` : "—"}
                                  </span>
                                </button>
                              ) : (
                                <span className={styles.cellEmpty}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={ui.empty}>{sessions.length ? "No interval rows in this session." : "No tick sessions yet. Regenerate a day to make one."}</p>
            )}
          </Section>
        </div>
      ) : null}

      {tab === "live-orders" ? (
        <div role="tabpanel" id="panel-live-orders" aria-labelledby="tab-live-orders">
          <Section title="Batches" hint="Queued market orders fill in best-effort batches. Rejections mean price, cash, holdings or the interval limit failed at fill time.">
            <dl className={styles.facts}>
              <div>
                <dt>Scheduler</dt>
                <dd data-tone={liveHealth && liveHealth.scheduler_status !== "running" ? "warn" : "blue"}>{liveHealth ? schedulerLabel(liveHealth) : "—"}</dd>
                <dd>
                  <small>{liveHealth ? `${Math.round(liveHealth.scheduler_interval_ms / 1000)}s poll · ${liveHealth.batch_limit} per batch` : ""}</small>
                </dd>
              </div>
              <div>
                <dt>Next batch</dt>
                <dd>{liveHealth?.health.next_execute_after ? etTime(liveHealth.health.next_execute_after, false) : "—"}</dd>
                <dd>
                  <small>{liveHealth?.health.next_execute_after ? until(liveHealth.health.next_execute_after, now) : "nothing queued"}</small>
                </dd>
              </div>
              <div>
                <dt>Due / overdue</dt>
                <dd data-tone={liveHealth?.health.overdue_pending_count ? "warn" : undefined}>
                  {liveHealth ? `${fmtCount(liveHealth.health.due_pending_count)} / ${fmtCount(liveHealth.health.overdue_pending_count)}` : "—"}
                </dd>
                <dd>
                  <small>overdue = 10m past execute_after</small>
                </dd>
              </div>
              <div>
                <dt>Oldest queued</dt>
                <dd>{liveHealth?.health.oldest_pending_at ? etTime(liveHealth.health.oldest_pending_at) : "—"}</dd>
              </div>
            </dl>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Batch</th>
                    <th scope="col">Status</th>
                    <th scope="col">Started</th>
                    <th scope="col" className={styles.r}>
                      Tried
                    </th>
                    <th scope="col" className={styles.r}>
                      Filled
                    </th>
                    <th scope="col" className={styles.r}>
                      Rejected
                    </th>
                    <th scope="col">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(liveHealth?.recent_batches ?? []).map((batch) => (
                    <tr key={batch.id} data-bad={batch.error_text || batch.status === "failed" || undefined}>
                      <td className={styles.mono}>#{batch.id}</td>
                      <td>{batch.status}</td>
                      <td className={styles.mono}>{etTime(batch.started_at)}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{batch.orders_attempted}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{batch.orders_filled}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{batch.orders_rejected}</td>
                      <td className={styles.err}>{batch.error_text || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!liveHealth?.recent_batches.length ? <p className={ui.empty}>No batches have run yet.</p> : null}
            </div>
          </Section>
        </div>
      ) : null}

      {tab === "stocks" ? (
        <div role="tabpanel" id="panel-stocks" aria-labelledby="tab-stocks">
          <Section
            title="Guardrails"
            hint="Min/max bound each tick's strength. Saving clears the cached asset list."
            actions={
              <label className={styles.filter}>
                <span className={ui.srOnly}>Filter stocks</span>
                <input className={ui.input} type="search" value={query} placeholder="Ticker, name or unit" onChange={(event) => setQuery(event.target.value)} />
              </label>
            }
          >
            {loading ? (
              <p className={ui.empty}>Loading stocks…</p>
            ) : filtered.length ? (
              <div className={styles.stocks} role="table" aria-label="Per-stock tuning">
                <div className={styles.stockHead} role="row">
                  <span role="columnheader">Stock</span>
                  <span role="columnheader">Base</span>
                  <span role="columnheader">Market</span>
                  <span role="columnheader">Ticks</span>
                  <span role="columnheader">Min %</span>
                  <span role="columnheader">Max %</span>
                  <span role="columnheader">Supply check</span>
                  <span role="columnheader">Buffer</span>
                  <span role="columnheader">
                    <span className={ui.srOnly}>Save</span>
                  </span>
                </div>
                {filtered.map((asset) => (
                  <TuningRow
                    key={asset.symbol}
                    asset={asset}
                    defaults={defaults}
                    onSaved={(next) => setAssets((current) => current.map((entry) => (entry.symbol === next.symbol ? next : entry)))}
                  />
                ))}
              </div>
            ) : (
              <p className={ui.empty}>No stocks match that.</p>
            )}
          </Section>
        </div>
      ) : null}

      {tab === "evaluation" ? (
        <div role="tabpanel" id="panel-evaluation" aria-labelledby="tab-evaluation">
          <EvaluationNow />
        </div>
      ) : null}

      {tab === "reset" ? (
        <div role="tabpanel" id="panel-reset" aria-labelledby="tab-reset">
          <Section title="Reset & rebuild">
            <div className={styles.actions}>
              <div className={styles.action} data-danger>
                <h3>Reset the market</h3>
                <p>Wipes everything players own or earned: holdings, orders, cash (back to starter), leaderboards, achievements, every prediction market, and all game currencies, cards, pulls and cosmetics. Accounts, profiles, oshi, chat, comments and articles stay, and so do the stocks. Then rebuild.</p>
                <div className={styles.actionRow}>
                  <button type="button" className={ui.btnDanger} onClick={() => setConfirmAction("reset")} disabled={adminBusy !== false}>
                    {adminBusy === "reset" ? "Resetting…" : "Reset market"}
                  </button>
                </div>
              </div>
              <div className={styles.action} data-danger>
                <h3>Rebuild the market</h3>
                <p>Recalculates fundamentals and replays every day&apos;s settlement and price adjustments from the YouTube data. Takes a minute or more.</p>
                <div className={styles.actionRow}>
                  <button type="button" className={ui.btnDanger} onClick={() => setConfirmAction("rebuild")} disabled={adminBusy !== false}>
                    {adminBusy === "rebuild" ? "Rebuilding…" : "Rebuild market"}
                  </button>
                </div>
              </div>
            </div>
            <div aria-live="polite">
              {adminError ? <Notice>{adminError}</Notice> : null}
              {adminStatus ? <Notice tone="ok">{adminStatus}</Notice> : null}
            </div>
          </Section>
        </div>
      ) : null}

      {picked ? (
        <aside className={styles.drawer} aria-label={`${picked.symbol} ${intervalLabel(picked.interval_key)} tick`}>
          <header>
            <div>
              <h3>
                <Oshimark icon={picked.icon} symbol={picked.symbol} size={18} /> {picked.symbol} · {intervalLabel(picked.interval_key)}
              </h3>
              <p>
                <span className={styles.statusTag} data-status={picked.status}>
                  {picked.status}
                </span>{" "}
                scheduled {etTime(picked.scheduled_at)}
                {picked.applied_at ? ` · applied ${etTime(picked.applied_at)}` : ""}
              </p>
            </div>
            <button type="button" className={ui.btnGhost} onClick={() => setPicked(null)} aria-label="Close tick details">
              ✕
            </button>
          </header>
          <dl className={styles.drawerGrid}>
            <div>
              <dt>Base</dt>
              <dd>{formatPrice(picked.base_rate)}</dd>
            </div>
            <div>
              <dt>Toward base</dt>
              <dd>{picked.strength_pct === null ? "—" : `${picked.strength_pct}%`}</dd>
            </div>
            <div>
              <dt>Before</dt>
              <dd>{formatPrice(picked.price_before)}</dd>
            </div>
            <div>
              <dt>After</dt>
              <dd>{formatPrice(picked.price_after)}</dd>
            </div>
            <div>
              <dt>Move</dt>
              <dd data-tone={picked.move_pct && picked.move_pct > 0 ? "up" : picked.move_pct && picked.move_pct < 0 ? "down" : undefined}>{formatPct(picked.move_pct, true)}</dd>
            </div>
            <div>
              <dt>Gap closed</dt>
              <dd>{formatPct(picked.gap_compression_pct)}</dd>
            </div>
            <div>
              <dt>Price event</dt>
              <dd>{picked.price_event_id ? `#${picked.price_event_id}` : "—"}</dd>
            </div>
          </dl>
          <pre className={styles.meta}>{JSON.stringify({ skip_reason: picked.skip_reason, ...picked.metadata_json }, null, 2)}</pre>
        </aside>
      ) : null}

      {confirmAction ? (
        <div className={styles.scrim} onClick={() => setConfirmAction(null)}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(event) => event.stopPropagation()}>
            <span className={styles.dialogKicker}>Can&apos;t be undone</span>
            <h2 id="reset-title">{confirmAction === "reset" ? "Reset the market?" : "Rebuild the market?"}</h2>
            <p>
              Type <code>{confirmAction}</code> to go ahead. Nothing is sent until it matches.
            </p>
            <input
              className={ui.input}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={confirmAction}
              aria-label={`Type ${confirmAction} to confirm`}
              autoFocus
            />
            <div className={styles.dialogBtns}>
              <button type="button" className={ui.btnGhost} onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
              <button type="button" className={ui.btnDangerSolid} onClick={() => void confirmedReset()} disabled={adminBusy !== false || confirmText.trim() !== confirmAction}>
                {confirmAction === "reset" ? "Reset market" : "Rebuild market"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminFrame>
  );
}
