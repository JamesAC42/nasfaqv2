"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TopAlpha = {
  talent: string;
  ticker: string;
  action: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "WATCH" | string;
  reasoning: string;
};

type MerchStock = {
  name: string;
  stock_remaining: number;
};

type RiskFactor = {
  type: string;
  details: string;
};

type MarketReport = {
  summary?: string;
  top_alpha?: TopAlpha[];
  ccv_performance_tally?: {
    gold?: string;
    silver?: string;
    bronze?: string;
  };
  merch_inventory_stats?: {
    context?: string;
    low_stock_high_demand?: MerchStock[];
    high_stock_low_velocity?: MerchStock[];
  };
  sentiment_analysis?: {
    hololive_en?: string;
    hololive_jp?: string;
    hololive_id?: string;
  };
  risk_factors?: RiskFactor[];
};

type AnalysisBody = {
  market_report?: MarketReport;
};

type AnalysisEntry = {
  timestamp: string;
  thread_tag: string;
  thread_match?: string;
  thread_id: number;
  new_post_ids: number[];
  analysis?: AnalysisBody;
  analysis_raw?: string;
};

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function cleanSummary(v?: string) {
  if (!v) return "—";
  const trimmed = v.trim();
  if (!trimmed) return "—";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.summary === "string") return parsed.summary;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function normalizeEntry(entry: AnalysisEntry): AnalysisEntry {
  if (entry.analysis || !entry.analysis_raw) return entry;
  try {
    const parsed = JSON.parse(entry.analysis_raw) as AnalysisBody;
    return { ...entry, analysis: parsed };
  } catch {
    return entry;
  }
}

export default function AnalysisPage() {
  const [items, setItems] = useState<AnalysisEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/4chan", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AnalysisEntry[];
      setItems(data);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const subtitle = useMemo(() => {
    if (!items) return "Loading sentiment pulse from /vt/...";
    return `${items.length} analysis posts in the last 24h`;
  }, [items]);

  const grouped = useMemo(() => {
    if (!items) return [];
    const groups = new Map<string, { key: string; label: string; entries: AnalysisEntry[] }>();
    for (const raw of items) {
      const entry = normalizeEntry(raw);
      const label = entry.thread_match ? `${entry.thread_match}` : `/${entry.thread_tag}/`;
      const key = `${label}#${entry.thread_id}`;
      if (!groups.has(key)) {
        groups.set(key, { key, label: `${label} · #${entry.thread_id}`, entries: [] });
      }
      groups.get(key)!.entries.push(entry);
    }
    for (const group of groups.values()) {
      group.entries.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
    }
    return Array.from(groups.values()).sort((a, b) => (a.entries[0].timestamp > b.entries[0].timestamp ? -1 : 1));
  }, [items]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">4chan Alpha Radar</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <a className="pill" href="/">
            Dashboard
          </a>
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p className="name">Failed to load</p>
          <p className="muted">{error}</p>
        </div>
      ) : null}

      {!items && !error ? (
        <div className="card">
          <p className="name">Loading…</p>
        </div>
      ) : null}

      {items && items.length === 0 ? <div className="card muted">No analysis posts yet.</div> : null}

      {grouped.length ? (
        <div className="analysisList">
          {grouped.map((group) => (
            <div key={group.key}>
              <div className="analysisThreadHeader">
                <p className="name">{group.label}</p>
                <p className="muted">{group.entries.length} updates</p>
              </div>
              {group.entries.map((entry, idx) => (
                <div key={`${entry.thread_id}-${entry.timestamp}-${idx}`} className="analysisCard">
                  <div className="analysisHead">
                    <div>
                      <p className="muted">{fmtDate(entry.timestamp)}</p>
                    </div>
                    <div className="analysisMeta">
                      <span className="tag">{entry.new_post_ids?.length || 0} new posts</span>
                    </div>
                  </div>

                  {entry.analysis?.market_report ? (
                    <>
                      <p className="analysisSummary">{cleanSummary(entry.analysis.market_report.summary)}</p>

                      <div className="analysisGrid">
                        <div>
                          <p className="muted">CCV tally</p>
                          <p>{entry.analysis.market_report.ccv_performance_tally?.gold || "—"}</p>
                          <p className="muted">{entry.analysis.market_report.ccv_performance_tally?.silver || ""}</p>
                          <p className="muted">{entry.analysis.market_report.ccv_performance_tally?.bronze || ""}</p>
                        </div>
                        <div>
                          <p className="muted">Hololive EN</p>
                          <p>{entry.analysis.market_report.sentiment_analysis?.hololive_en || "—"}</p>
                        </div>
                        <div>
                          <p className="muted">Hololive JP</p>
                          <p>{entry.analysis.market_report.sentiment_analysis?.hololive_jp || "—"}</p>
                        </div>
                        <div>
                          <p className="muted">Hololive ID</p>
                          <p>{entry.analysis.market_report.sentiment_analysis?.hololive_id || "—"}</p>
                        </div>
                      </div>

                      {entry.analysis.market_report.top_alpha?.length ? (
                        <div className="analysisStocks">
                          {entry.analysis.market_report.top_alpha.map((s, sidx) => (
                            <div key={`${s.talent}-${sidx}`} className="analysisStock">
                              <div className="analysisStockHead">
                                <span>{s.talent || "Unknown"}</span>
                                <span className={`stance stance-${s.action.replace(/\s+/g, "-").toLowerCase()}`}>{s.action}</span>
                              </div>
                              {s.ticker ? <p className="muted">Ticker: {s.ticker}</p> : null}
                              {s.reasoning ? <p>{s.reasoning}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {entry.analysis.market_report.merch_inventory_stats ? (
                        <div className="analysisGrid">
                          <div>
                            <p className="muted">Merch context</p>
                            <p>{entry.analysis.market_report.merch_inventory_stats.context || "—"}</p>
                          </div>
                          <div>
                            <p className="muted">Low stock / high demand</p>
                            <p>
                              {entry.analysis.market_report.merch_inventory_stats.low_stock_high_demand?.length
                                ? entry.analysis.market_report.merch_inventory_stats.low_stock_high_demand
                                    .map((m) => `${m.name} (${m.stock_remaining})`)
                                    .join(" · ")
                                : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="muted">High stock / low velocity</p>
                            <p>
                              {entry.analysis.market_report.merch_inventory_stats.high_stock_low_velocity?.length
                                ? entry.analysis.market_report.merch_inventory_stats.high_stock_low_velocity
                                    .map((m) => `${m.name} (${m.stock_remaining})`)
                                    .join(" · ")
                                : "—"}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {entry.analysis.market_report.risk_factors?.length ? (
                        <div className="analysisStocks">
                          {entry.analysis.market_report.risk_factors.map((r, ridx) => (
                            <div key={`${r.type}-${ridx}`} className="analysisStock">
                              <div className="analysisStockHead">
                                <span>{r.type || "Risk"}</span>
                              </div>
                              <p>{r.details || "—"}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted">{entry.analysis_raw || "No structured analysis returned."}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
