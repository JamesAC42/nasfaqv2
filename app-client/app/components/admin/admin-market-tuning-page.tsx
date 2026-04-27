"use client";

import { useEffect, useMemo, useState } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
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
  const [assets, setAssets] = useState<MarketTuningAsset[]>([]);
  const [config, setConfig] = useState<MarketTuningConfig | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceBusy, setForceBusy] = useState(false);
  const [forceResult, setForceResult] = useState<ForceAdjustmentResponse | null>(null);
  const [forceError, setForceError] = useState<string | null>(null);

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
      setForceResult(result);
    } catch (nextError) {
      setForceError(String((nextError as Error).message || nextError));
    } finally {
      setForceBusy(false);
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
      </div>
    </SiteShell>
  );
}
