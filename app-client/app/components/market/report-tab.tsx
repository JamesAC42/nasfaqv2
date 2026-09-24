"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { StockChip } from "@/app/components/common/stock-chip";
import { compactMoney, num, RankRow, Seg, toneClass, useAssetMap } from "@/app/components/market/bits";
import { AreaLine } from "@/app/components/market/mini-charts";
import { buildDays, dateLabel, markIndex, type DayModel, type DayRow } from "@/app/components/market/report-model";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime, TICKS } from "@/app/lib/market-clock";
import { groupByUnit, unitLabel, unitName } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct } from "@/app/lib/time";
import type { DailyReport, MarketAdjustmentOutcome, ReportRow } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useHubStore } from "@/app/stores/hub-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/report-tab.module.scss";

type Metric = "fd" | "prem" | "pchg";
const reportCache = new Map<string, DailyReport | null>();

const pct = (value: number | null | undefined, digits = 2) => signedPct(value, digits);
const premOf = (row: ReportRow) =>
  row.premium_pct ?? row.premium_discount_pct ?? (row.market_price && row.fair_value ? (row.market_price - row.fair_value) / row.fair_value : null);

function useReport(date: string | null) {
  const latest = useMarketStore((state) => state.report);
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  useEffect(() => {
    if (!date) return;
    if (latest && latest.market_date.slice(0, 10) === date) {
      setReport(latest);
      return;
    }
    if (reportCache.has(date)) {
      setReport(reportCache.get(date));
      return;
    }
    let cancelled = false;
    setReport(undefined);
    apiFetch<DailyReport>(`/api/market/report/daily/${date}`)
      .then((result) => {
        reportCache.set(date, result);
        if (!cancelled) setReport(result);
      })
      .catch(() => {
        reportCache.set(date, null);
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date, latest]);
  return report;
}

// ── Date strip ───────────────────────────────────────────────────────────
function DateStrip({ model, date, mode, onPick, onMode }: { model: DayModel; date: string; mode: "one" | "all"; onPick: (date: string) => void; onMode: () => void }) {
  const strip = useRef<HTMLDivElement | null>(null);
  const bySymbol = useAssetMap();
  const idx = model.dates.indexOf(date);

  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - strip.current.clientWidth / 2 + el.offsetWidth / 2;
  }, [date]);

  return (
    <div className={styles.dates}>
      <button type="button" className={styles.arr} disabled={idx <= 0} aria-label="Earlier session" onClick={() => onPick(model.dates[idx - 1])}>
        ‹
      </button>
      <div className={styles.strip} ref={strip}>
        {model.dates.map((day, i) => {
          const rows = model.byDate.get(day) ?? [];
          const up = rows.filter((row) => row.fd > 0.00005).length / Math.max(1, rows.length);
          const sorted = [...rows].sort((a, b) => b.fd - a.fd);
          const label = dateLabel(day);
          const top = sorted[0]?.asset;
          const bottom = sorted[sorted.length - 1]?.asset;
          return (
            <button key={day} type="button" className={styles.rpd} aria-pressed={mode === "one" && day === date} aria-label={label.long} onClick={() => onPick(day)}>
              <span>{i === model.dates.length - 1 ? "LATEST" : label.dow}</span>
              <b>{label.day}</b>
              <i className={styles.breadth}>
                <s style={{ width: `${(up * 100).toFixed(0)}%` }} />
              </i>
              <span className={styles.oms}>
                {top ? <Oshimark icon={bySymbol.get(top.symbol)?.icon ?? top.icon} symbol={top.symbol} size={14} /> : null}
                {bottom ? <Oshimark icon={bySymbol.get(bottom.symbol)?.icon ?? bottom.icon} symbol={bottom.symbol} size={14} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className={styles.arr} disabled={idx < 0 || idx >= model.dates.length - 1} aria-label="Later session" onClick={() => onPick(model.dates[idx + 1])}>
        ›
      </button>
      <button type="button" className={styles.allBtn} aria-pressed={mode === "all"} onClick={onMode}>
        <i aria-hidden="true" />
        <span>
          ALL {model.dates.length}
          <br />
          SESSIONS
        </span>
      </button>
    </div>
  );
}

// ── Lede + KPIs ──────────────────────────────────────────────────────────
function Lede({ date, rows, report }: { date: string; rows: DayRow[]; report: DailyReport | null | undefined }) {
  const { theme } = useTheme();
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.fd - a.fd);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  const emissions = report?.notable_treasury_emissions ?? [];
  const topEm = emissions[0];
  const cheap = [...rows].filter((row) => row.prem !== null).sort((a, b) => (a.prem ?? 0) - (b.prem ?? 0))[0];
  const head =
    up > down * 1.5
      ? `A green settlement: ${up} of ${rows.length} marks rise and ${top.asset.display_name} leads`
      : down > up * 1.5
        ? `A red settlement: ${down} of ${rows.length} marked down, ${bottom.asset.display_name} hit hardest`
        : `A split settlement as ${top.asset.display_name} climbs and ${bottom.asset.display_name} slides`;
  const label = dateLabel(date);
  return (
    <div className={styles.lede}>
      <div>
        <div className={styles.kick}>{label.long.toUpperCase()} · SETTLED 09:00 ET</div>
        <h2>{head}</h2>
        <p>
          {top.asset.display_name} <StockChip symbol={top.asset.symbol} /> marked up the most, from {num(top.markBefore)} to {num(top.markAfter)}. {bottom.asset.display_name}{" "}
          <StockChip symbol={bottom.asset.symbol} /> took the biggest markdown.
          {topEm ? (
            <>
              {" "}
              The treasury&apos;s biggest print went into <b>{topEm.symbol}</b> ({num(topEm.emission, 1)} new shares at a {pct(premOf(topEm))} premium)
            </>
          ) : null}
          {cheap ? (
            <>
              {topEm ? ", and " : " "}
              <b>{cheap.asset.symbol}</b> closed furthest under its mark at {pct(cheap.prem)}.
            </>
          ) : (
            "."
          )}
        </p>
      </div>
      <div className={styles.cast}>
        {[
          { row: top, pose: "hype" as const, label: "TOP OF SESSION", tone: "up" as const },
          { row: bottom, pose: "cope" as const, label: "BOTTOM", tone: "down" as const },
        ].map(({ row, pose, label: caption, tone }) => (
          <Link key={caption} href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.castFig}>
            <ArtSlot kind="chibi" pose={pose} symbol={row.asset.symbol} icon={row.asset.icon} accent={talentAccent(row.asset.color, theme)} width={112} className={styles.castArt} />
            <span>
              <b className={ui[tone]}>{pct(row.fd)}</b>
              {caption}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Kpis({ rows, report, indexValue }: { rows: DayRow[]; report: DailyReport | null | undefined; indexValue: { value: number; change: number } | null }) {
  if (!rows.length) return null;
  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  const avg = rows.reduce((sum, row) => sum + row.fd, 0) / rows.length;
  const sorted = [...rows].sort((a, b) => b.fd - a.fd);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const volumeCash = rows.reduce((sum, row) => sum + row.volume * (row.close ?? 0), 0);
  const prems = rows.map((row) => row.prem).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const median = prems.length ? prems[Math.floor(prems.length / 2)] : null;
  const emission = (report?.notable_treasury_emissions ?? []).reduce((sum, row) => sum + (row.emission ?? 0), 0);
  return (
    <div className={ui.kstrip} style={{ "--cols": 6 } as React.CSSProperties}>
      <div>
        <span className={ui.label}>All-talent mark</span>
        <span className={ui.kv}>{indexValue ? indexValue.value.toFixed(2) : "—"}</span>
        <span className={`${ui.ks} ${indexValue ? ui[toneClass(indexValue.change)] : ""}`}>{indexValue ? `${indexValue.change >= 0 ? "▲" : "▼"} ${pct(indexValue.change)}` : "—"}</span>
      </div>
      <div>
        <span className={ui.label}>Breadth</span>
        <span className={ui.kv}>
          <span className={ui.up}>{up}</span>
          <span className={ui.flat}> / </span>
          <span className={ui.down}>{down}</span>
        </span>
        <span className={ui.ks}>marked up / down of {rows.length}</span>
      </div>
      <div>
        <span className={ui.label}>Avg mark move</span>
        <span className={`${ui.kv} ${ui[toneClass(avg)]}`}>{pct(avg)}</span>
        <span className={ui.ks}>
          max {pct(sorted[0].fd)} · min {pct(sorted[sorted.length - 1].fd)}
        </span>
      </div>
      <div>
        <span className={ui.label}>New shares</span>
        <span className={ui.kv}>{emission ? Math.round(emission).toLocaleString("en-US") : "—"}</span>
        <span className={ui.ks}>notable treasury emissions</span>
      </div>
      <div>
        <span className={ui.label}>Session volume</span>
        <span className={ui.kv}>{compactMoney(volumeCash)}</span>
        <span className={ui.ks}>{volume.toLocaleString("en-US")} shares</span>
      </div>
      <div>
        <span className={ui.label}>Median vs mark</span>
        <span className={`${ui.kv} ${median !== null && median > 0 ? ui.down : ui.up}`}>{pct(median)}</span>
        <span className={ui.ks}>close vs settlement mark</span>
      </div>
    </div>
  );
}

// ── Swarm: every talent's oshimark placed by settlement mark move ─────────────
function Swarm({ rows }: { rows: DayRow[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const bySymbol = useAssetMap();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!width || !rows.length) return null;
    const maxAbs = Math.max(0.03, Math.ceil(Math.max(...rows.map((row) => Math.abs(row.fd))) * 100) / 100);
    const small = width < 600;
    const S = small ? 16 : 20;
    const H = small ? 200 : 170;
    const X = (value: number) => S / 2 + ((value + maxAbs) / (2 * maxAbs)) * (width - S);
    const bins = new Map<number, number>();
    const marks = [...rows]
      .sort((a, b) => Math.abs(a.fd) - Math.abs(b.fd))
      .map((row) => {
        const bin = Math.round(X(row.fd) / (S * 0.9));
        const n = (bins.get(bin) ?? 0) + 1;
        bins.set(bin, n);
        return { row, x: bin * S * 0.9, n };
      });
    const tallest = Math.max(...bins.values());
    const step = Math.min(S + 1, (H - S) / Math.max(1, tallest - 1));
    const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];
    return { S, H, X, marks, step, ticks, zero: X(0) };
  }, [rows, width]);

  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  return (
    <section className={styles.swarmSec}>
      <div className={ui.secHead}>
        <h2>Where every mark landed</h2>
        <span className={ui.aside}>each oshimark is a talent · hover to peek, click to open</span>
      </div>
      <div className={styles.swarm} ref={box} style={layout ? { height: layout.H + 22 } : undefined}>
        {layout ? (
          <>
            <div className={styles.zoneD} style={{ width: layout.zero }} />
            <div className={styles.zoneU} style={{ left: layout.zero }} />
            <div className={styles.zero} style={{ left: layout.zero }} />
            <div className={styles.axis} />
            <span className={`${styles.zl} ${ui.down}`} style={{ left: 8 }}>
              ← {down} MARKED DOWN
            </span>
            <span className={`${styles.zl} ${ui.up}`} style={{ right: 8 }}>
              {up} MARKED UP →
            </span>
            {layout.ticks.map((tick, i) => (
              <span key={i} className={`${styles.swtk} ${i === 0 ? styles.first : i === layout.ticks.length - 1 ? styles.last : ""}`} style={{ left: layout.X(tick) }}>
                {tick > 0 ? "+" : ""}
                {(tick * 100).toFixed(Math.abs(tick * 100) % 1 ? 1 : 0)}%
              </span>
            ))}
            {layout.marks.map(({ row, x, n }) => (
              <Link
                key={row.asset.symbol}
                href={`/stocks/${encodeURIComponent(row.asset.symbol)}`}
                className={styles.mark}
                style={{ left: x, bottom: 22 + (n - 1) * layout.step, width: layout.S, height: layout.S }}
                data-peek-stock={row.asset.symbol}
                aria-label={`${row.asset.symbol} ${pct(row.fd)}`}
              >
                <Oshimark icon={bySymbol.get(row.asset.symbol)?.icon ?? row.asset.icon} symbol={row.asset.symbol} size={layout.S} />
              </Link>
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

// ── The four ticks ───────────────────────────────────────────────────────
function Ticks({ date }: { date: string }) {
  const adjustments = useHubStore((state) => state.adjustments);
  const bySymbol = useAssetMap();
  const sameDay = (value: string | null | undefined) => (value ?? "").slice(0, 10) === date;
  const recaps = (adjustments?.recaps ?? []).filter((recap) => sameDay(recap.market_date));
  const outcomes = [...(adjustments?.feed ?? []), ...(adjustments?.leaderboards.movers ?? []), ...(adjustments?.leaderboards.gap_compression ?? [])].filter((item) => sameDay(item.market_date));
  const unique = new Map<string, MarketAdjustmentOutcome>();
  outcomes.forEach((item) => unique.set(`${item.symbol}:${item.interval_key}`, item));
  const rows = [...unique.values()];
  if (!adjustments) return null;
  const maxMove = Math.max(0.0001, ...recaps.map((recap) => recap.avg_abs_move_pct ?? 0));
  const label = (key: string) => TICKS.find((tick) => tick.key === key)?.label ?? key;
  const row = (item: MarketAdjustmentOutcome, value: string, tone: "up" | "down" | "flat") => (
    <RankRow
      key={`${item.symbol}-${item.interval_key}-${value}`}
      symbol={item.symbol}
      icon={bySymbol.get(item.symbol.toUpperCase())?.icon ?? item.icon}
      detail={`${label(item.interval_key)} · ${item.applied_at ? `${formatEtTime(new Date(item.applied_at))} ET` : ""}`}
      tone="flat"
      valueTone={tone}
      value={value}
    />
  );
  const up = rows.filter((item) => (item.move_pct ?? 0) > 0).sort((a, b) => (b.move_pct ?? 0) - (a.move_pct ?? 0)).slice(0, 5);
  const down = rows.filter((item) => (item.move_pct ?? 0) < 0).sort((a, b) => (a.move_pct ?? 0) - (b.move_pct ?? 0)).slice(0, 5);
  const gap = rows.filter((item) => item.gap_compression_pct !== null && item.gap_compression_pct !== undefined).sort((a, b) => (b.gap_compression_pct ?? 0) - (a.gap_compression_pct ?? 0)).slice(0, 5);
  const empty = <p className={ui.empty}>Not in the recent tick history.</p>;
  return (
    <section className={styles.ticks}>
      <div className={ui.secHead}>
        <h2>The four ticks</h2>
        <span className={ui.aside}>how hard each tick hit is secret until it lands · {recaps.length} of 4 landed</span>
      </div>
      <div className={styles.tk4}>
        {TICKS.map((tick) => {
          const recap = recaps.find((item) => item.interval_key === tick.key);
          return recap ? (
            <div key={tick.key} className={styles.tkc}>
              <div className={styles.tkh}>
                <b>{tick.label.toUpperCase()}</b>
                <span>{recap.applied_at ? `${formatEtTime(new Date(recap.applied_at))} ET` : `${String(tick.hour).padStart(2, "0")}:00 ET`}</span>
              </div>
              <div className={styles.str}>
                <i style={{ width: `${(((recap.avg_abs_move_pct ?? 0) / maxMove) * 100).toFixed(0)}%` }} />
              </div>
              <dl>
                <dt>Applied</dt>
                <dd>
                  {recap.applied_count ?? "—"}
                  {recap.asset_count ? ` / ${recap.asset_count}` : ""}
                </dd>
                <dt>Avg move</dt>
                <dd>±{((recap.avg_abs_move_pct ?? 0) * 100).toFixed(2)}%</dd>
                <dt>Gap closed</dt>
                <dd>{recap.avg_gap_compression_pct !== null && recap.avg_gap_compression_pct !== undefined ? `${(recap.avg_gap_compression_pct * 100).toFixed(0)}%` : "—"}</dd>
                <dt>Skipped</dt>
                <dd>{recap.skipped_count ?? 0}</dd>
              </dl>
            </div>
          ) : (
            <div key={tick.key} className={`${styles.tkc} ${styles.pend}`}>
              <div className={styles.tkh}>
                <b>{tick.label.toUpperCase()}</b>
                <span>{String(tick.hour).padStart(2, "0")}:00 ET</span>
              </div>
              <div className={styles.str}>
                <i />
              </div>
              <p className={styles.secret}>Strength secret until it lands.</p>
            </div>
          );
        })}
      </div>
      <div className={styles.tkb}>
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2 className={ui.up}>Largest tick moves up</h2>
          </div>
          {up.length ? up.map((item) => row(item, pct(item.move_pct), "up")) : empty}
        </div>
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2 className={ui.down}>Largest tick moves down</h2>
          </div>
          {down.length ? down.map((item) => row(item, pct(item.move_pct), "down")) : empty}
        </div>
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2>Gap compression</h2>
            <span className={ui.aside}>how much of the gap to target a tick closed</span>
          </div>
          {gap.length ? gap.map((item) => row(item, `${((item.gap_compression_pct ?? 0) * 100).toFixed(0)}%`, "flat")) : empty}
        </div>
      </div>
    </section>
  );
}

// ── Report lists ─────────────────────────────────────────────────────────
function Lists({ rows, report }: { rows: DayRow[]; report: DailyReport | null | undefined }) {
  const bySymbol = useAssetMap();
  const icon = (symbol: string) => bySymbol.get(symbol.toUpperCase())?.icon;
  const byFd = [...rows].sort((a, b) => b.fd - a.fd);
  const maxFd = Math.max(0.0001, ...rows.map((row) => Math.abs(row.fd)));
  const list = (title: string, hint: string, tone: "up" | "down" | "", content: React.ReactNode) => (
    <div className={ui.sec}>
      <div className={ui.secHead}>
        <h2 className={tone ? ui[tone] : undefined}>{title}</h2>
        <span className={ui.aside}>{hint}</span>
      </div>
      {content}
    </div>
  );
  const fromReport = (items: ReportRow[] | undefined, value: (row: ReportRow) => number | null | undefined, format: (row: ReportRow) => string, detail: (row: ReportRow) => string, tone: (row: ReportRow) => "up" | "down" | "flat") => {
    const clean = (items ?? []).slice(0, 6);
    if (!clean.length) return <p className={ui.empty}>{report === undefined ? "Loading…" : "Not in this report."}</p>;
    const max = Math.max(0.0001, ...clean.map((row) => Math.abs(value(row) ?? 0)));
    return clean.map((row) => <RankRow key={row.symbol} symbol={row.symbol} icon={icon(row.symbol)} detail={detail(row)} bar={Math.abs(value(row) ?? 0) / max} tone={tone(row)} value={format(row)} />);
  };
  return (
    <div className={styles.grid}>
      {list(
        "Marked up",
        "at settlement",
        "up",
        byFd.slice(0, 6).map((row) => <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={`${num(row.markBefore)} → ${num(row.markAfter)}`} bar={Math.abs(row.fd) / maxFd} tone="up" value={pct(row.fd)} />),
      )}
      {list(
        "Marked down",
        "at settlement",
        "down",
        byFd
          .slice(-6)
          .reverse()
          .map((row) => <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={`${num(row.markBefore)} → ${num(row.markAfter)}`} bar={Math.abs(row.fd) / maxFd} tone="down" value={pct(row.fd)} />),
      )}
      {list("Breakouts", "price, the session", "", fromReport(report?.biggest_winners, (row) => row.move_pct, (row) => pct(row.move_pct), (row) => `closed ${num(row.market_price)}`, () => "up"))}
      {list("Drawdowns", "price, the session", "", fromReport(report?.biggest_losers, (row) => row.move_pct, (row) => pct(row.move_pct), (row) => `closed ${num(row.market_price)}`, () => "down"))}
      {list(
        "Flow acceleration",
        "volume vs the session before",
        "",
        fromReport(report?.volume_winners, (row) => row.volume_change_pct, (row) => pct(row.volume_change_pct), (row) => `${compactMoney(row.volume_cash)} · ${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => toneClass(row.volume_change_pct)),
      )}
      {list("Dilution watch", "new shares", "", fromReport(report?.notable_treasury_emissions, (row) => row.emission, (row) => `${num(row.emission, 1)} sh`, (row) => `closed ${num(row.market_price)}`, () => "flat"))}
      {list("Most traded", "shares, the session", "", fromReport(report?.top_volume, (row) => row.volume_shares, (row) => `${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => compactMoney(row.volume_cash), () => "flat"))}
      {list("Going quiet", "volume vs the session before", "", fromReport(report?.volume_losers, (row) => row.volume_change_pct, (row) => pct(row.volume_change_pct), (row) => `${compactMoney(row.volume_cash)} · ${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => toneClass(row.volume_change_pct)))}
    </div>
  );
}

// ── Your angle: book, exposure, index context ────────────────────────────
function Angle({ date, model }: { date: string; model: DayModel }) {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const bySymbol = useAssetMap();
  useEffect(() => {
    if (user) void fetchPortfolio();
  }, [fetchPortfolio, user]);

  const all = marketIndexes.find((index) => index.group === "all");
  const series = (all?.series ?? []).filter((point) => point.value !== null);
  const values = series.map((point) => point.value as number);
  const markerIndex = series.findIndex((point) => point.bucket.slice(0, 10) === date);
  const labels = series.length ? [series[0].bucket.slice(0, 7), series[Math.floor(series.length / 2)].bucket.slice(0, 7), dateLabel(series[series.length - 1].bucket.slice(0, 10)).short] : [];

  const holdings = (portfolio?.holdings ?? []).filter((holding) => holding.quantity > 0);
  const effects = holdings
    .map((holding) => {
      const row = model.bySymbol.get(holding.symbol.toUpperCase())?.get(date);
      return { holding, row, effect: row ? holding.quantity * (row.markAfter - row.markBefore) : 0 };
    })
    .sort((a, b) => b.effect - a.effect);
  const total = effects.reduce((sum, item) => sum + item.effect, 0);
  const units = new Map<string, number>();
  holdings.forEach((holding) => {
    const unit = unitLabel(bySymbol.get(holding.symbol.toUpperCase())?.unit);
    units.set(unit, (units.get(unit) ?? 0) + holding.market_value);
  });
  const mv = portfolio?.total_market_value ?? 0;

  return (
    <div className={styles.angle}>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Your book on this report</h2>
          {user ? (
            <Link href="/profile" className={ui.aside}>
              profile →
            </Link>
          ) : null}
        </div>
        {user && portfolio ? (
          <>
            <div className={styles.bk3}>
              <div>
                <span>EQUITY</span>
                <b>{money(portfolio.total_equity)}</b>
              </div>
              <div>
                <span>MARKET VALUE</span>
                <b>{money(portfolio.total_market_value)}</b>
              </div>
              <div>
                <span>UNREALIZED P/L</span>
                <b className={ui[toneClass(portfolio.total_unrealized_pnl)]}>{money(portfolio.total_unrealized_pnl)}</b>
              </div>
            </div>
            {effects.map(({ holding, row, effect }) => (
              <RankRow
                key={holding.symbol}
                symbol={holding.symbol}
                icon={bySymbol.get(holding.symbol.toUpperCase())?.icon}
                detail={`${holding.quantity.toLocaleString("en-US")} sh · mark ${row ? pct(row.fd) : "—"}`}
                tone="flat"
                valueTone={toneClass(effect)}
                value={`${effect >= 0 ? "+" : "−"}${money(Math.abs(effect))}`}
              />
            ))}
            {effects.length ? (
              <p className={ui.note}>
                Your bags {total >= 0 ? "gained" : "lost"} <b className={ui[toneClass(total)]}>{money(Math.abs(total))}</b> in value when the marks reset at this settlement.
              </p>
            ) : (
              <p className={ui.empty}>No bags to read this report against.</p>
            )}
          </>
        ) : (
          <p className={ui.empty}>Sign in to read the report against your own bags.</p>
        )}
      </div>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Exposure by unit</h2>
          <span className={ui.aside}>share of your bags</span>
        </div>
        {units.size && mv > 0 ? (
          [...units.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([unit, value]) => (
              <div key={unit} className={styles.exrow}>
                <span>{unit}</span>
                <i style={{ width: `${Math.max(4, (value / mv) * 100).toFixed(0)}%` }} />
                <span className={styles.r}>{((value / mv) * 100).toFixed(0)}%</span>
              </div>
            ))
        ) : (
          <p className={ui.empty}>Nothing held yet.</p>
        )}
      </div>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Index context</h2>
          <Link href="/market/indexes" className={ui.aside}>
            indexes →
          </Link>
        </div>
        <div className={styles.ixctx}>
          <AreaLine values={values} markerIndex={markerIndex >= 0 ? markerIndex : null} labels={labels} />
        </div>
        <p className={ui.note} style={{ marginTop: "1.4rem" }}>
          All-talent index, equal weight. The dashed line is this session.
        </p>
      </div>
    </div>
  );
}

// ── Every stock ──────────────────────────────────────────────────────────
type SortKey = "sym" | "unit" | "close" | "markBefore" | "markAfter" | "fd" | "prem" | "volume";

function FullTable({ rows }: { rows: DayRow[] }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "fd", dir: -1 });
  const bySymbol = useAssetMap();
  const value = (row: DayRow, key: SortKey): number | string =>
    key === "sym" ? row.asset.symbol : key === "unit" ? unitName(row.asset.unit) : ((row[key as keyof DayRow] as number | null) ?? -Infinity);
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
  });
  const cols: Array<[SortKey, string, boolean?]> = [
    ["sym", "Stock", true],
    ["unit", "Unit", true],
    ["close", "Close"],
    ["markBefore", "Mark before"],
    ["markAfter", "Mark after"],
    ["fd", "Mark Δ"],
    ["prem", "Premium"],
    ["volume", "Volume"],
  ];
  return (
    <div className={styles.full}>
      <div className={styles.fullHead}>
        <h2>Every stock</h2>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "HIDE TABLE" : "SHOW TABLE"}
        </button>
      </div>
      {open ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {cols.map(([key, label, left]) => (
                  <th
                    key={key}
                    className={left ? styles.l : undefined}
                    aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                    onClick={() => setSort((current) => (current.key === key ? { key, dir: current.dir > 0 ? -1 : 1 } : { key, dir: key === "sym" || key === "unit" ? 1 : -1 }))}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.asset.symbol}>
                  <td className={styles.l}>
                    <Link href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.who} data-peek-stock={row.asset.symbol}>
                      <Oshimark icon={bySymbol.get(row.asset.symbol)?.icon ?? row.asset.icon} symbol={row.asset.symbol} size={20} />
                      <span>
                        <b>{row.asset.symbol}</b>
                        <small>{row.asset.display_name}</small>
                      </span>
                    </Link>
                  </td>
                  <td className={`${styles.l} ${styles.unit}`}>{unitLabel(row.asset.unit)}</td>
                  <td>{num(row.close)}</td>
                  <td className={styles.dim}>{num(row.markBefore)}</td>
                  <td>{num(row.markAfter)}</td>
                  <td>
                    <span className={`${styles.mv} ${styles[toneClass(row.fd)]}`}>{pct(row.fd)}</span>
                  </td>
                  <td className={row.prem !== null && row.prem > 0 ? ui.down : ui.up}>{pct(row.prem)}</td>
                  <td>{row.volume.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ── All sessions heatmap ─────────────────────────────────────────────────
function heatBg(value: number | null, metric: Metric) {
  if (value === null) return "transparent";
  const scale = metric === "prem" ? 0.15 : metric === "pchg" ? 0.06 : 0.05;
  let t = Math.max(-1, Math.min(1, value / scale));
  if (metric === "prem") t = -t;
  if (Math.abs(t) < 0.03) return "var(--ink-3)";
  const alpha = (0.12 + Math.abs(t) * 0.7).toFixed(3);
  return t > 0 ? `rgba(46, 227, 142, ${alpha})` : `rgba(255, 68, 96, ${alpha})`;
}

function Heatmap({ model, date, onPick }: { model: DayModel; date: string; onPick: (date: string) => void }) {
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const [metric, setMetric] = useState<Metric>("fd");
  const [sort, setSort] = useState<"unit" | "total" | "vol">("unit");
  const mine = useMemo(() => new Set((portfolio?.holdings ?? []).filter((holding) => holding.quantity > 0).map((holding) => holding.symbol.toUpperCase())), [portfolio]);
  const dates = model.dates;
  const rows = useMemo(
    () =>
      assets.map((asset) => {
        const days = model.bySymbol.get(asset.symbol.toUpperCase());
        const values = dates.map((day) => {
          const row = days?.get(day);
          return row ? (row[metric] as number | null) : null;
        });
        const first = days?.get(dates[0])?.markBefore;
        const last = days?.get(dates[dates.length - 1])?.markAfter;
        const total = first && last ? (last - first) / first : 0;
        const present = values.filter((value): value is number => value !== null);
        const vol = present.length ? Math.sqrt(present.reduce((sum, value) => sum + value * value, 0) / present.length) : 0;
        const spark = dates.map((day) => days?.get(day)?.markAfter).filter((value): value is number => value !== undefined);
        return { asset, values, total, vol, spark };
      }),
    [assets, dates, metric, model.bySymbol],
  );
  const scale = metric === "prem" ? 15 : metric === "pchg" ? 6 : 5;
  const aggregate = dates.map((day) => {
    const dayRows = model.byDate.get(day) ?? [];
    const vals = dayRows.map((row) => row[metric] as number | null).filter((value): value is number => value !== null);
    return { avg: vals.length ? vals.reduce((sum, value) => sum + value, 0) / vals.length : null, up: dayRows.filter((row) => row.fd > 0.00005).length / Math.max(1, dayRows.length) };
  });
  const cells = (values: Array<number | null>, symbol: string) =>
    values.map((value, i) => (
      <td
        key={dates[i]}
        className={`${styles.c} ${mine.has(symbol) ? styles.mineCell : ""}`}
        style={{ background: heatBg(value, metric) }}
        title={`${symbol} · ${dateLabel(dates[i]).long} · ${pct(value)}`}
        onClick={() => onPick(dates[i])}
      >
        {value === null ? "" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}`}
      </td>
    ));
  const renderRow = (row: (typeof rows)[number]) => (
    <tr key={row.asset.symbol}>
      <th className={styles.s}>
        <Link href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} data-peek-stock={row.asset.symbol}>
          <Oshimark icon={row.asset.icon} symbol={row.asset.symbol} size={16} />
          {row.asset.symbol}
        </Link>
      </th>
      {cells(row.values, row.asset.symbol.toUpperCase())}
      <td className={styles.tot}>
        <span>
          <svg viewBox="0 0 70 16" preserveAspectRatio="none" aria-hidden="true">
            {row.spark.length > 1 ? (
              <polyline
                points={row.spark
                  .map((value, i) => {
                    const min = Math.min(...row.spark);
                    const max = Math.max(...row.spark);
                    return `${((i / (row.spark.length - 1)) * 70).toFixed(1)},${(15 - ((value - min) / (max - min || 1)) * 14).toFixed(1)}`;
                  })
                  .join(" ")}
                fill="none"
                stroke={row.total >= 0 ? "var(--up)" : "var(--down)"}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <b className={ui[toneClass(row.total)]}>{pct(row.total)}</b>
        </span>
      </td>
    </tr>
  );
  const body =
    sort === "unit"
      ? groupByUnit(assets).map((group) => {
          const unitRows = rows.filter((row) => group.assets.includes(row.asset));
          const avg = unitRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, unitRows.length);
          return (
            <Fragment key={group.unit}>
              <tr className={styles.ug}>
                <th colSpan={dates.length + 2}>
                  {unitLabel(group.unit)}
                  <small className={ui[toneClass(avg)]}>{pct(avg)} over the window</small>
                </th>
              </tr>
              {unitRows.map(renderRow)}
            </Fragment>
          );
        })
      : [...rows].sort((a, b) => (sort === "total" ? b.total - a.total : b.vol - a.vol)).map(renderRow);

  return (
    <div>
      <div className={styles.hmCtl}>
        <div>
          <h2>{dates.length} sessions at a glance</h2>
          <p>Every talent, session by session. Click any column to open that day&apos;s report.</p>
        </div>
        <div className={styles.hmCtlR}>
          <Seg
            label="Metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "fd", label: "MARK Δ" },
              { value: "prem", label: "CLOSE VS MARK" },
              { value: "pchg", label: "PRICE Δ" },
            ]}
          />
          <Seg
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "unit", label: "BY UNIT" },
              { value: "total", label: "BEST OVER WINDOW" },
              { value: "vol", label: "MOST VOLATILE" },
            ]}
          />
        </div>
      </div>
      <div className={styles.hmLegend}>
        <span>{metric === "prem" ? `+${scale}% above` : `−${scale}%`}</span>
        <i style={{ background: `linear-gradient(90deg, ${heatBg(-scale / 100, metric === "prem" ? "fd" : metric)}, var(--ink-3), ${heatBg(scale / 100, metric === "prem" ? "fd" : metric)})` }} />
        <span>{metric === "prem" ? `−${scale}% below` : `+${scale}%`}</span>
        <span className={styles.hmNote}>
          {metric === "fd" ? "settlement mark change" : metric === "prem" ? "closing price vs that session\u2019s mark" : "price change over the session"}
          {mine.size ? " · blue outline = your bags" : ""}
        </span>
      </div>
      <div className={styles.hmWrap}>
        <table className={styles.hm}>
          <thead>
            <tr>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>SESSION</span>
              </th>
              {dates.map((day, i) => {
                const label = dateLabel(day);
                return (
                  <th key={day} className={`${styles.col} ${day === date ? styles.on : ""}`}>
                    <button type="button" onClick={() => onPick(day)} aria-label={`Open ${label.long}`}>
                      {i === dates.length - 1 ? "LATEST" : label.dow}
                      <b>{label.day}</b>
                    </button>
                  </th>
                );
              })}
              <th className={styles.totHead}>WINDOW</th>
            </tr>
            <tr className={styles.agg}>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>ALL-TALENT</span>
              </th>
              {aggregate.map((entry, i) => (
                <td key={dates[i]} className={styles.c} style={{ background: heatBg(entry.avg, metric) }} onClick={() => onPick(dates[i])}>
                  {entry.avg === null ? "" : `${entry.avg > 0 ? "+" : ""}${(entry.avg * 100).toFixed(1)}`}
                </td>
              ))}
              <td className={styles.tot} />
            </tr>
            <tr className={styles.agg}>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>BREADTH</span>
              </th>
              {aggregate.map((entry, i) => (
                <td key={dates[i]} className={styles.c} onClick={() => onPick(dates[i])}>
                  <span className={styles.brd}>
                    <s style={{ width: `${(entry.up * 100).toFixed(0)}%` }} />
                  </span>
                </td>
              ))}
              <td className={styles.tot} />
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────
export function ReportTab({ initialDate, initialView }: { initialDate?: string; initialView?: string }) {
  const router = useRouter();
  const assets = useMarketStore((state) => state.assets);
  const latest = useMarketStore((state) => state.report);
  const model = useMemo(() => buildDays(assets), [assets]);
  const [mode, setMode] = useState<"one" | "all">(initialView === "all" ? "all" : "one");
  const [picked, setPicked] = useState<string | null>(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null);
  const fallback = latest?.market_date?.slice(0, 10);
  const date = picked && model.dates.includes(picked) ? picked : fallback && model.dates.includes(fallback) ? fallback : model.dates[model.dates.length - 1] ?? null;
  const report = useReport(date);
  const rows = date ? model.byDate.get(date) ?? [] : [];
  const index = useMemo(() => {
    const series = markIndex(assets);
    if (!date || series.length < 2) return null;
    // markIndex aligns with the sparkline window; map the date to its position.
    const pos = model.dates.indexOf(date) + (series.length - model.dates.length);
    if (pos < 1 || pos >= series.length) return null;
    return { value: series[pos], change: (series[pos] - series[pos - 1]) / series[pos - 1] };
  }, [assets, date, model.dates]);

  const sync = (nextDate: string | null, nextMode: "one" | "all") => {
    const params = new URLSearchParams();
    if (nextDate && nextDate !== model.dates[model.dates.length - 1]) params.set("date", nextDate);
    if (nextMode === "all") params.set("view", "all");
    const query = params.toString();
    router.replace(`/market/report${query ? `?${query}` : ""}`, { scroll: false });
  };
  const pick = (day: string) => {
    setPicked(day);
    setMode("one");
    sync(day, "one");
  };
  const toggleMode = () => {
    const next = mode === "all" ? "one" : "all";
    setMode(next);
    sync(date, next);
  };

  if (!assets.length || !date) {
    return <p className={styles.loading}>Loading the settlement report…</p>;
  }

  return (
    <>
      <DateStrip model={model} date={date} mode={mode} onPick={pick} onMode={toggleMode} />
      {mode === "all" ? (
        <Heatmap model={model} date={date} onPick={pick} />
      ) : (
        <>
          <Lede date={date} rows={rows} report={report} />
          <Kpis rows={rows} report={report} indexValue={index} />
          <Swarm rows={rows} />
          <Ticks date={date} />
          <Lists rows={rows} report={report} />
          <Angle date={date} model={model} />
          <FullTable rows={rows} />
        </>
      )}
      <p className={ui.foot}>
        Settlement runs at 09:00 ET. Each talent&apos;s hidden fair value reprices from their YouTube views, subscribers and uploads, and the day&apos;s four ticks pull the price toward it. The mark is the settled price with
        short-term order pressure stripped out. The treasury prints new shares of stocks trading above fair.
      </p>
    </>
  );
}
