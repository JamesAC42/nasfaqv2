"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { markSeries, groupByUnit, UNIT_ORDER, unitLabel, unitName } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { signedPct, toneOf } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import { useChannelData, type Channel } from "@/app/lib/use-channel-data";
import styles from "@/app/components/stocks/screener.module.scss";

// ── Data ─────────────────────────────────────────────────────────────────

type Row = {
  asset: MarketAsset;
  sym: string;
  unit: string;
  price: number;
  move: number | null;
  tick: number | null;
  /** Price change over the 15-day window (fraction). */
  d15: number | null;
  vol: number;
  float: number | null;
  held: number;
  heldQty: number;
  heldPl: number | null;
} & Channel;

type SortKey = keyof Pick<Row, "sym" | "unit" | "price" | "move" | "tick" | "d15" | "vol" | "float" | "held" | "subs" | "subsCh" | "views" | "viewsCh" | "videos" | "sc7" | "stream7" | "oshis">;
type Lens = "market" | "channel";
type Filters = { move: "any" | "up" | "down"; d15: "any" | "up" | "down"; vol: "any" | "active" | "quiet" };
type SavedView = { name: string; q: string; view: string; units: string[]; f: Filters; sort: { key: SortKey; dir: 1 | -1 }; group: boolean; lens: Lens };

const QUICK: Array<{ key: string; label: string; test?: (row: Row) => boolean; sort?: [SortKey, 1 | -1]; lens?: Lens }> = [
  { key: "all", label: "ALL" },
  { key: "movers", label: "MOONING", test: (row) => (row.move ?? 0) > 0.00005, sort: ["move", -1] },
  { key: "losers", label: "BLEEDING", test: (row) => (row.move ?? 0) < -0.00005, sort: ["move", 1] },
  { key: "dip", label: "15D DIP", test: (row) => (row.d15 ?? 0) < -0.00005, sort: ["d15", 1] },
  { key: "hot", label: "MOST TRADED", test: (row) => row.vol > 0, sort: ["vol", -1] },
  { key: "growth", label: "SUBS GROWING", test: (row) => (row.subsCh ?? 0) > 0, sort: ["subsCh", -1], lens: "channel" },
  { key: "bags", label: "MY BAGS", test: (row) => row.heldQty > 0, sort: ["held", -1] },
  { key: "sc", label: "TOP SUPERCHATS", sort: ["sc7", -1], lens: "channel" },
  { key: "stream", label: "MOST STREAMED", sort: ["stream7", -1], lens: "channel" },
  { key: "viewed", label: "MOST VIEWED", sort: ["views", -1], lens: "channel" },
  { key: "oshi", label: "MOST OSHI'D", sort: ["oshis", -1], lens: "channel" },
];

const MARKET_COLS: Array<{ key: SortKey | "cb" | "spark" | "act"; label: string; left?: boolean; hide?: string }> = [
  { key: "cb", label: "", left: true },
  { key: "sym", label: "Stock", left: true },
  { key: "unit", label: "Unit", left: true },
  { key: "spark", label: "15D", left: true },
  { key: "price", label: "Price" },
  { key: "move", label: "Today" },
  { key: "tick", label: "Last tick" },
  { key: "d15", label: "15D chg" },
  { key: "vol", label: "24h vol" },
  { key: "subs", label: "Subs", hide: "wide" },
  { key: "subsCh", label: "Subs 24h", hide: "wide" },
  { key: "viewsCh", label: "Views 24h", hide: "wide" },
  { key: "float", label: "Float" },
  { key: "held", label: "You hold" },
  { key: "act", label: "" },
];

const CHANNEL_COLS: typeof MARKET_COLS = [
  { key: "cb", label: "", left: true },
  { key: "sym", label: "Stock", left: true },
  { key: "unit", label: "Unit", left: true },
  { key: "price", label: "Price" },
  { key: "move", label: "Today" },
  { key: "subs", label: "Subs" },
  { key: "subsCh", label: "Subs 24h" },
  { key: "views", label: "Views" },
  { key: "viewsCh", label: "Views 24h" },
  { key: "videos", label: "Videos" },
  { key: "sc7", label: "7D superchat" },
  { key: "stream7", label: "7D streamed" },
  { key: "oshis", label: "Oshi'd by" },
  { key: "held", label: "You hold" },
  { key: "act", label: "" },
];

const DEFAULT_FILTERS: Filters = { move: "any", d15: "any", vol: "any" };
const VIEWS_KEY = "nasfaq.screener.views";
const COMPARE_MAX = 5;

const fmtK = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
};
const n2 = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2));
// ── Pieces ───────────────────────────────────────────────────────────────
function ChangeBar({ value }: { value: number | null }) {
  if (value === null) return <span className={styles.dimv}>—</span>;
  const width = Math.min(50, (Math.abs(value) / 0.3) * 50);
  return (
    <span className={`${styles.fairbar} ${styles[toneOf(value)]}`}>
      <i>
        <s style={value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} />
      </i>
      {signedPct(value, 1)}
    </span>
  );
}

function Spark15({ asset, width = 96, height = 24 }: { asset: MarketAsset; width?: number; height?: number }) {
  const series = markSeries(asset);
  const up = series.length > 1 ? series[series.length - 1] >= series[0] : true;
  return <Sparkline values={series} tone={up ? "up" : "down"} width={width} height={height} fill />;
}

function Compare({ symbols, rows, onRemove, onClear }: { symbols: string[]; rows: Map<string, Row>; onRemove: (symbol: string) => void; onClear: () => void }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(true);
  if (!symbols.length) return null;
  const series = symbols
    .map((symbol) => {
      const row = rows.get(symbol);
      if (!row) return null;
      const values = markSeries(row.asset);
      return values.length > 1 ? { symbol, row, color: talentAccent(row.asset.color, theme), values: values.map((value) => (value / values[0]) * 100) } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const all = series.flatMap((entry) => entry.values);
  const min = Math.min(...all, 100) - 1;
  const max = Math.max(...all, 100) + 1;
  const W = 600;
  const H = 180;
  const y = (value: number) => 6 + (1 - (value - min) / (max - min || 1)) * (H - 12);
  return (
    <div className={styles.cmp} role="region" aria-label="Compare stocks">
      <div className={styles.cmpBar}>
        <h3>COMPARE</h3>
        <div className={styles.cmpPicks}>
          {symbols.map((symbol) => {
            const row = rows.get(symbol);
            return (
              <span key={symbol} className={styles.cmpPick} style={{ borderColor: row ? talentAccent(row.asset.color, theme) : undefined }}>
                <Oshimark icon={row?.asset.icon} symbol={symbol} size={14} />
                {symbol}
                <button type="button" onClick={() => onRemove(symbol)} aria-label={`Remove ${symbol}`}>
                  ✕
                </button>
              </span>
            );
          })}
        </div>
        <button type="button" className={styles.btn} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "HIDE CHART" : "SHOW CHART"}
        </button>
        <button type="button" className={styles.btn} onClick={onClear}>
          CLEAR
        </button>
      </div>
      {open ? (
        <div className={styles.cmpBody}>
          <div className={styles.cmpChart}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="15-day price, rebased to 100">
              <line x1="0" x2={W} y1={y(100)} y2={y(100)} className={styles.cmpBase} />
              {series.map((entry) => (
                <polyline key={entry.symbol} points={entry.values.map((value, i) => `${((i / (entry.values.length - 1)) * W).toFixed(1)},${y(value).toFixed(1)}`).join(" ")} fill="none" stroke={entry.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <span className={styles.cmpNote}>price · 15 days ago = 100</span>
          </div>
          <div className={styles.cmpTable}>
            <div className={`${styles.cmpRow} ${styles.cmpHd}`}>
              <span />
              <span>Price</span>
              <span>Today</span>
              <span>24h vol</span>
              <span>15D</span>
            </div>
            {series.map((entry) => (
              <Link key={entry.symbol} href={`/stocks/${encodeURIComponent(entry.symbol)}`} className={styles.cmpRow} style={{ "--c": entry.color } as React.CSSProperties}>
                <b>
                  <i />
                  {entry.symbol}
                </b>
                <span>{n2(entry.row.price)}</span>
                <span className={styles[toneOf(entry.row.move)]}>{signedPct(entry.row.move)}</span>
                <span>{fmtK(entry.row.vol)}</span>
                <span className={styles[toneOf(entry.values[entry.values.length - 1] - 100)]}>{signedPct((entry.values[entry.values.length - 1] - 100) / 100, 1)}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Screener ─────────────────────────────────────────────────────────────
export function Screener({ initialView }: { initialView?: string }) {
  const router = useRouter();
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const openTrade = useTradeStore((state) => state.openTrade);
  const { user } = useAuth();
  const { theme } = useTheme();
  const channels = useChannelData();
  const search = useRef<HTMLInputElement | null>(null);
  const startView = QUICK.find((entry) => entry.key === initialView) ?? QUICK[0];
  const [q, setQ] = useState("");
  const [view, setView] = useState(startView.key);
  const [units, setUnits] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(startView.sort ? { key: startView.sort[0], dir: startView.sort[1] } : { key: "move", dir: -1 });
  const [group, setGroup] = useState(false);
  const [lens, setLens] = useState<Lens>(startView.lens ?? "market");
  const [mode, setMode] = useState<"table" | "cards">("table");
  const [compare, setCompare] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [pop, setPop] = useState<"units" | "filters" | "save" | null>(null);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    if (user) void fetchPortfolio();
  }, [fetchPortfolio, user]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEWS_KEY);
      if (raw) setSaved(JSON.parse(raw) as SavedView[]);
    } catch {}
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && target && !/INPUT|TEXTAREA/.test(target.tagName)) {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape") setPop(null);
    };
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.(`.${styles.ctl}`)) setPop(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const rows = useMemo(() => {
    const holdings = new Map((portfolio?.holdings ?? []).map((holding) => [holding.symbol.toUpperCase(), holding]));
    return assets.map<Row>((asset) => {
      const sym = asset.symbol.toUpperCase();
      const held = holdings.get(sym);
      const price = asset.current_mid_price ?? 0;
      const series = markSeries(asset);
      const start = series.length > 1 ? series[0] : null;
      const before = asset.latest_adjustment?.price_before;
      const after = asset.latest_adjustment?.price_after;
      const total = (asset.circulating_supply ?? 0) + (asset.treasury_supply ?? 0);
      const channel = channels.get(sym);
      return {
        asset,
        sym,
        unit: unitName(asset.unit),
        price,
        move: asset.move_24h_pct,
        tick: before && after ? (after - before) / before : null,
        d15: start && price ? (price - start) / start : null,
        vol: asset.volume_24h ?? 0,
        float: total > 0 ? (asset.circulating_supply ?? 0) / total : null,
        held: held && held.quantity > 0 ? held.quantity * price : 0,
        heldQty: held?.quantity ?? 0,
        heldPl: held && held.avg_cost_basis ? (price - held.avg_cost_basis) / held.avg_cost_basis : null,
        subs: channel?.subs ?? null,
        views: channel?.views ?? null,
        videos: channel?.videos ?? null,
        sc7: channel?.sc7 ?? null,
        stream7: channel?.stream7 ?? null,
        oshis: channel?.oshis ?? asset.oshicoin_users ?? null,
        subsCh: channel?.subsCh ?? null,
        viewsCh: channel?.viewsCh ?? null,
      };
    });
  }, [assets, channels, portfolio]);
  const bySym = useMemo(() => new Map(rows.map((row) => [row.sym, row])), [rows]);

  const quick = QUICK.find((entry) => entry.key === view) ?? QUICK[0];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (needle && !(row.sym.toLowerCase().includes(needle) || row.asset.display_name.toLowerCase().includes(needle) || row.unit.toLowerCase().includes(needle))) return false;
      if (units.size && !units.has(row.unit)) return false;
      if (filters.move === "up" && !((row.move ?? 0) > 0.00005)) return false;
      if (filters.move === "down" && !((row.move ?? 0) < -0.00005)) return false;
      if (filters.d15 === "down" && !((row.d15 ?? 0) < -0.00005)) return false;
      if (filters.d15 === "up" && !((row.d15 ?? 0) > 0.00005)) return false;
      if (filters.vol === "active" && !(row.vol > 0)) return false;
      if (filters.vol === "quiet" && row.vol > 0) return false;
      return quick.test ? quick.test(row) : true;
    });
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * sort.dir;
      const xa = x ?? -Infinity;
      const ya = y ?? -Infinity;
      return (xa === ya ? a.sym.localeCompare(b.sym) : xa > ya ? 1 : -1) * (xa === ya ? 1 : sort.dir);
    });
  }, [filters, q, quick, rows, sort, units]);

  const up = rows.filter((row) => (row.move ?? 0) > 0.00005).length;
  const down = rows.filter((row) => (row.move ?? 0) < -0.00005).length;
  const dips = rows.filter((row) => (row.d15 ?? 0) < -0.00005).length;
  const traded = rows.reduce((sum, row) => sum + row.vol, 0);
  const bags = rows.filter((row) => row.heldQty > 0).length;
  const cols = lens === "channel" ? CHANNEL_COLS : MARKET_COLS;
  const filterCount = Object.values(filters).filter((value) => value !== "any").length;
  const unitList = UNIT_ORDER.filter((unit) => rows.some((row) => row.unit === unit));

  const pickQuick = (key: string) => {
    const entry = QUICK.find((item) => item.key === key) ?? QUICK[0];
    setView(entry.key);
    setActiveSaved(null);
    if (entry.sort) setSort({ key: entry.sort[0], dir: entry.sort[1] });
    if (entry.lens) setLens(entry.lens);
    router.replace(entry.key === "all" ? "/stocks" : `/stocks?view=${entry.key}`, { scroll: false });
  };
  const persist = (next: SavedView[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {}
  };
  const applySaved = (entry: SavedView) => {
    setQ(entry.q);
    setView(entry.view);
    setUnits(new Set(entry.units));
    setFilters({ ...DEFAULT_FILTERS, move: entry.f.move ?? "any", d15: entry.f.d15 ?? "any", vol: entry.f.vol ?? "any" });
    setSort(entry.sort);
    setGroup(entry.group);
    setLens(entry.lens ?? "market");
    setActiveSaved(entry.name);
  };
  const toggleCompare = (symbol: string) =>
    setCompare((current) => (current.includes(symbol) ? current.filter((item) => item !== symbol) : current.length >= COMPARE_MAX ? current : [...current, symbol]));
  const sortBy = (key: SortKey) => setSort((current) => (current.key === key ? { key, dir: current.dir > 0 ? -1 : 1 } : { key, dir: key === "sym" || key === "unit" ? 1 : -1 }));

  const cell = (row: Row, key: (typeof cols)[number]["key"]) => {
    const a = row.asset;
    switch (key) {
      case "cb":
        return (
          <td key={key} className={styles.l}>
            <button type="button" className={styles.cb} aria-pressed={compare.includes(row.sym)} aria-label={`Compare ${row.sym}`} onClick={(event) => (event.stopPropagation(), toggleCompare(row.sym))} />
          </td>
        );
      case "sym":
        return (
          <td key={key} className={styles.l}>
            <span className={styles.who}>
              <Oshimark icon={a.icon} symbol={a.symbol} size={22} />
              <span>
                <b>{a.symbol}</b>
                <small>{a.display_name}</small>
              </span>
            </span>
          </td>
        );
      case "unit":
        return (
          <td key={key} className={`${styles.l} ${styles.unitc}`}>
            {unitLabel(a.unit)}
          </td>
        );
      case "spark":
        return (
          <td key={key} className={`${styles.l} ${styles.spk}`}>
            <Spark15 asset={a} />
          </td>
        );
      case "price":
        return (
          <td key={key} className={styles.px}>
            {n2(row.price)}
          </td>
        );
      case "move":
        return (
          <td key={key}>
            <span className={`${styles.mv} ${styles[toneOf(row.move)]}`}>{signedPct(row.move)}</span>
          </td>
        );
      case "tick":
        return (
          <td key={key} className={styles[toneOf(row.tick)]}>
            {signedPct(row.tick)}
          </td>
        );
      case "d15":
        return (
          <td key={key}>
            <ChangeBar value={row.d15} />
          </td>
        );
      case "vol":
        return (
          <td key={key} className={row.vol ? undefined : styles.dimv}>
            {row.vol ? fmtK(row.vol) : "—"}
          </td>
        );
      case "float":
        return <td key={key}>{row.float === null ? "—" : `${(row.float * 100).toFixed(0)}%`}</td>;
      case "held":
        return (
          <td key={key} className={row.heldQty ? styles.held : styles.dimv}>
            {row.heldQty ? (
              <>
                {row.heldQty.toLocaleString("en-US")} <span className={styles[toneOf(row.heldPl)]}>{signedPct(row.heldPl)}</span>
              </>
            ) : (
              "—"
            )}
          </td>
        );
      case "act":
        return (
          <td key={key}>
            <button type="button" className={styles.qbtn} onClick={(event) => (event.stopPropagation(), openTrade(a.symbol, "buy"))}>
              TRADE
            </button>
          </td>
        );
      case "subs":
      case "views":
        return (
          <td key={key} className={cols.find((col) => col.key === key)?.hide === "wide" ? styles.wide : undefined}>
            {fmtK(row[key])}
          </td>
        );
      case "subsCh":
      case "viewsCh":
        return (
          <td key={key} className={`${styles[toneOf(row[key])]} ${cols.find((col) => col.key === key)?.hide === "wide" ? styles.wide : ""}`}>
            {signedPct(row[key])}
          </td>
        );
      case "videos":
        return <td key={key}>{row.videos === null ? "—" : row.videos.toLocaleString("en-US")}</td>;
      case "sc7":
        return (
          <td key={key} className={row.sc7 ? undefined : styles.dimv}>
            {row.sc7 ? `¥${fmtK(row.sc7)}` : "—"}
          </td>
        );
      case "stream7":
        return <td key={key}>{row.stream7 === null ? "—" : `${row.stream7.toFixed(1)}h`}</td>;
      case "oshis":
        return (
          <td key={key}>
            {row.oshis === null ? (
              "—"
            ) : (
              <>
                {row.oshis.toLocaleString("en-US")} <small className={styles.dimv}>players</small>
              </>
            )}
          </td>
        );
      default:
        return <td key={key} />;
    }
  };

  const rowHtml = (row: Row) => (
    <tr key={row.sym} className={`${styles.srow} ${compare.includes(row.sym) ? styles.picked : ""}`} onClick={() => router.push(`/stocks/${encodeURIComponent(row.sym)}`)} data-peek-stock={row.sym}>
      {cols.map((col) => cell(row, col.key))}
    </tr>
  );

  let body: React.ReactNode;
  if (group) {
    body = groupByUnit(filtered.map((row) => row.asset)).map((entry) => {
      const members = filtered.filter((row) => row.unit === entry.unit);
      const avg = members.reduce((sum, row) => sum + (row.move ?? 0), 0) / Math.max(1, members.length);
      const d15 = members.reduce((sum, row) => sum + (row.d15 ?? 0), 0) / Math.max(1, members.length);
      return [
        <tr key={`g-${entry.unit}`} className={styles.grp}>
          <td colSpan={cols.length}>
            <b>{unitLabel(entry.unit)}</b>
            <span className={styles.grpOms}>
              {members.map((row) => (
                <Oshimark key={row.sym} icon={row.asset.icon} symbol={row.sym} size={14} />
              ))}
            </span>
            <span className={styles.grpMeta}>
              today <span className={styles[toneOf(avg)]}>{signedPct(avg)}</span> · 15D <span className={styles[toneOf(d15)]}>{signedPct(d15, 1)}</span> · {members.length} stocks
            </span>
          </td>
        </tr>,
        ...members.map(rowHtml),
      ];
    });
  } else {
    body = filtered.map(rowHtml);
  }

  const tags: Array<[string, () => void]> = [];
  if (q) tags.push([`"${q}"`, () => setQ("")]);
  units.forEach((unit) => tags.push([unitLabel(unit), () => setUnits((current) => new Set([...current].filter((item) => item !== unit)))]));
  (Object.keys(filters) as Array<keyof Filters>).forEach((key) => {
    if (filters[key] !== "any") tags.push([`${{ move: "Today", d15: "15D", vol: "Volume" }[key]} ${filters[key]}`, () => setFilters((current) => ({ ...current, [key]: "any" }))]);
  });

  return (
    <SiteShell>
      <div className={styles.page} style={{ paddingBottom: compare.length ? "18rem" : undefined }}>
        <header className={styles.head}>
          <div>
            <h1>Stocks</h1>
            <p>{assets.length || "—"} talents on the board. Find your next bag, or the one you should have sold.</p>
          </div>
          <div className={styles.stats}>
            <div>
              <span>UP / DOWN</span>
              <b>
                <span className={styles.up}>{up}</span>
                <span className={styles.flat}> / </span>
                <span className={styles.down}>{down}</span>
              </b>
            </div>
            <div>
              <span>DOWN 15D</span>
              <b>{dips}</b>
            </div>
            <div>
              <span>TRADED TODAY</span>
              <b>{fmtK(traded)} sh</b>
            </div>
            {user ? (
              <div>
                <span>YOUR BAGS</span>
                <b>{bags}</b>
              </div>
            ) : null}
          </div>
        </header>

        <div className={styles.bar}>
          <div className={styles.barRow}>
            <label className={styles.search}>
              <span aria-hidden="true">⌕</span>
              <input ref={search} value={q} onChange={(event) => (setQ(event.target.value), setActiveSaved(null))} placeholder="Search ticker, name or unit" aria-label="Search stocks" />
              <kbd>/</kbd>
            </label>
            <div className={styles.ctl}>
              <button type="button" className={`${styles.btn} ${units.size ? styles.on : ""}`} aria-expanded={pop === "units"} onClick={() => setPop(pop === "units" ? null : "units")}>
                UNITS {units.size ? <b>{units.size}</b> : null}
              </button>
              {pop === "units" ? (
                <div className={styles.pop}>
                  <h4>Units</h4>
                  <div className={styles.unitGrid}>
                    {unitList.map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        className={styles.unitBtn}
                        aria-pressed={units.has(unit)}
                        onClick={() =>
                          setUnits((current) => {
                            const next = new Set(current);
                            if (next.has(unit)) next.delete(unit);
                            else next.add(unit);
                            return next;
                          })
                        }
                      >
                        <span className={styles.box} />
                        <span>
                          <b>{unitLabel(unit)}</b>
                          <span className={styles.unitOms}>
                            {rows
                              .filter((row) => row.unit === unit)
                              .map((row) => (
                                <Oshimark key={row.sym} icon={row.asset.icon} symbol={row.sym} size={12} />
                              ))}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.popFoot}>
                    <button type="button" className={styles.linkish} onClick={() => setUnits(new Set())}>
                      Clear
                    </button>
                    <button type="button" className={styles.btn} onClick={() => setPop(null)}>
                      DONE
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className={styles.ctl}>
              <button type="button" className={`${styles.btn} ${filterCount ? styles.on : ""}`} aria-expanded={pop === "filters"} onClick={() => setPop(pop === "filters" ? null : "filters")}>
                FILTERS {filterCount ? <b>{filterCount}</b> : null}
              </button>
              {pop === "filters" ? (
                <div className={styles.pop}>
                  {(
                    [
                      ["move", "Today", [["any", "ANY"], ["up", "UP"], ["down", "DOWN"]]],
                      ["d15", "15 days", [["any", "ANY"], ["up", "UP"], ["down", "DOWN"]]],
                      ["vol", "Volume", [["any", "ANY"], ["active", "TRADED"], ["quiet", "QUIET"]]],
                    ] as Array<[keyof Filters, string, Array<[string, string]>]>
                  ).map(([key, title, options]) => (
                    <div key={key} className={styles.popGroup}>
                      <h4>{title}</h4>
                      <div className={styles.range}>
                        {options.map(([value, label]) => (
                          <button key={value} type="button" aria-pressed={filters[key] === value} onClick={() => (setFilters((current) => ({ ...current, [key]: value })), setActiveSaved(null))}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className={styles.popFoot}>
                    <button type="button" className={styles.linkish} onClick={() => setFilters(DEFAULT_FILTERS)}>
                      Reset
                    </button>
                    <button type="button" className={styles.btn} onClick={() => setPop(null)}>
                      DONE
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button type="button" className={`${styles.btn} ${group ? styles.on : ""}`} aria-pressed={group} onClick={() => setGroup(!group)}>
              GROUP BY UNIT
            </button>
            <div className={styles.mode} role="group" aria-label="Columns">
              <button type="button" aria-pressed={lens === "market"} onClick={() => setLens("market")}>
                MARKET
              </button>
              <button type="button" aria-pressed={lens === "channel"} onClick={() => setLens("channel")}>
                CHANNEL
              </button>
            </div>
            <div className={styles.mode} role="group" aria-label="Layout">
              <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>
                TABLE
              </button>
              <button type="button" aria-pressed={mode === "cards"} onClick={() => setMode("cards")}>
                CARDS
              </button>
            </div>
          </div>
          <div className={styles.barRow}>
            <div className={styles.views}>
              {QUICK.map((entry) => {
                const count = entry.test ? rows.filter(entry.test).length : rows.length;
                return (
                  <button key={entry.key} type="button" className={styles.view} aria-pressed={view === entry.key && !activeSaved} onClick={() => pickQuick(entry.key)}>
                    {entry.label} {entry.test || entry.key === "all" ? <span className={styles.n}>{count}</span> : null}
                  </button>
                );
              })}
              {saved.map((entry) => (
                <span key={entry.name} className={`${styles.view} ${styles.saved}`} aria-pressed={activeSaved === entry.name}>
                  <button type="button" onClick={() => applySaved(entry)}>
                    {entry.name}
                  </button>
                  <button type="button" className={styles.x} aria-label={`Delete view ${entry.name}`} onClick={() => persist(saved.filter((item) => item.name !== entry.name))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className={styles.ctl}>
              <button type="button" className={styles.btn} aria-expanded={pop === "save"} onClick={() => setPop(pop === "save" ? null : "save")}>
                SAVE VIEW
              </button>
              {pop === "save" ? (
                <form
                  className={`${styles.pop} ${styles.right}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = saveName.trim();
                    if (!name) return;
                    persist([...saved.filter((item) => item.name !== name), { name, q, view, units: [...units], f: filters, sort, group, lens }]);
                    setActiveSaved(name);
                    setSaveName("");
                    setPop(null);
                  }}
                >
                  <h4>Save this view</h4>
                  <div className={styles.saveRow}>
                    <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="e.g. cheap myth bags" maxLength={28} autoFocus />
                    <button type="submit">SAVE</button>
                  </div>
                  <p className={styles.popNote}>Saved on this device. Keeps your search, units, filters, sort and columns.</p>
                </form>
              ) : null}
            </div>
          </div>
          {tags.length ? (
            <div className={styles.barRow}>
              <div className={styles.active}>
                {tags.map(([label, clear]) => (
                  <span key={label} className={styles.tag}>
                    {label}
                    <button type="button" aria-label={`Remove ${label}`} onClick={() => (clear(), setActiveSaved(null))}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <span className={styles.count}>
                Showing {filtered.length} of {rows.length}
              </span>
            </div>
          ) : null}
        </div>

        {!filtered.length ? (
          <div className={styles.empty}>
            Nothing matches. <button type="button" className={styles.linkish} onClick={() => (setQ(""), setUnits(new Set()), setFilters(DEFAULT_FILTERS), pickQuick("all"))}>Clear everything</button>
          </div>
        ) : mode === "table" ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {cols.map((col) =>
                      col.key === "cb" || col.key === "spark" || col.key === "act" ? (
                        <th key={col.key} className={col.left ? styles.l : undefined}>
                          {col.label}
                        </th>
                      ) : (
                        <th
                          key={col.key}
                          className={`${col.left ? styles.l : ""} ${styles.sort} ${col.hide === "wide" ? styles.wide : ""}`}
                          aria-sort={sort.key === col.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                          onClick={() => sortBy(col.key as SortKey)}
                        >
                          {col.label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>{body}</tbody>
              </table>
            </div>
            <div className={styles.list}>
              {filtered.map((row) => (
                <Link key={row.sym} href={`/stocks/${encodeURIComponent(row.sym)}`} className={styles.lrow}>
                  <Oshimark icon={row.asset.icon} symbol={row.sym} size={26} />
                  <span className={styles.lname}>
                    <b>{row.sym}</b>
                    <small>
                      {row.asset.display_name} · {unitLabel(row.asset.unit)}
                    </small>
                  </span>
                  <Spark15 asset={row.asset} width={64} height={22} />
                  <span className={styles.lr}>
                    <span className={styles.px}>{n2(row.price)}</span>
                    <span className={`${styles.mv} ${styles[toneOf(row.move)]}`}>{signedPct(row.move)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.cards}>
            {filtered.map((row) => {
              const accent = talentAccent(row.asset.color, theme);
              return (
                <div key={row.sym} className={`${styles.card} ${compare.includes(row.sym) ? styles.picked : ""}`} style={{ "--tal": accent } as React.CSSProperties}>
                  <Link href={`/stocks/${encodeURIComponent(row.sym)}`} className={styles.cardLink}>
                    <ArtSlot kind="keyart" symbol={row.sym} icon={row.asset.icon} accent={accent} width={260} className={styles.cardArt} />
                    <span className={styles.cardBody}>
                      <span className={styles.cardTop}>
                        <b>
                          <Oshimark icon={row.asset.icon} symbol={row.sym} size={18} /> {row.sym}
                        </b>
                        <span className={styles.px}>{n2(row.price)}</span>
                      </span>
                      <span className={styles.cardName}>
                        {row.asset.display_name} · {unitLabel(row.asset.unit)}
                      </span>
                      <span className={styles.cardRow}>
                        <span className={styles[toneOf(row.move)]}>{signedPct(row.move)}</span>
                        <span className={styles[toneOf(row.d15)]}>{signedPct(row.d15, 1)} 15D</span>
                      </span>
                      <Spark15 asset={row.asset} width={200} height={30} />
                    </span>
                  </Link>
                  <button type="button" className={`${styles.cb} ${styles.cardCb}`} aria-pressed={compare.includes(row.sym)} aria-label={`Compare ${row.sym}`} onClick={() => toggleCompare(row.sym)} />
                </div>
              );
            })}
          </div>
        )}
        <Compare symbols={compare} rows={bySym} onRemove={(symbol) => setCompare((current) => current.filter((item) => item !== symbol))} onClear={() => setCompare([])} />
      </div>
    </SiteShell>
  );
}
