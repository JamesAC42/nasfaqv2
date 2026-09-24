"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { compactMoney, DivBar, num, Seg, toneClass } from "@/app/components/market/bits";
import { IndexChart } from "@/app/components/market/mini-charts";
import { branchOf, groupByUnit, markSeries, UNIT_ORDER, unitLabel, unitName } from "@/app/lib/market-units";
import { signedPct } from "@/app/lib/time";
import type { MarketAsset, MarketIndexBundle } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/indexes-tab.module.scss";

type Range = "1m" | "3m" | "1y";
const RANGE_DAYS: Record<Range, number> = { "1m": 31, "3m": 92, "1y": 400 };

type IndexView = {
  id: string;
  name: string;
  kind: "all" | "branch" | "unit";
  members: MarketAsset[];
  dates: string[];
  values: number[];
  value: number | null;
  day: number | null;
  total: number | null;
  volume: number | null;
  premium: number | null;
};

/** Price now vs the first settlement mark in the sparkline window (~15 days). */
function change15(asset: MarketAsset) {
  const start = markSeries(asset)[0];
  const mid = asset.current_mid_price;
  return mid && start ? (mid - start) / start : null;
}

function fromBundle(id: string, name: string, kind: IndexView["kind"], bundle: MarketIndexBundle | undefined, members: MarketAsset[]): IndexView {
  const points = (bundle?.series ?? []).filter((point) => point.value !== null);
  const summary = bundle?.summary;
  const moves = members.map((asset) => asset.move_24h_pct).filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    id,
    name,
    kind,
    members,
    dates: points.map((point) => point.bucket.slice(0, 10)),
    values: points.map((point) => point.value as number),
    value: summary?.index_value ?? points.at(-1)?.value ?? null,
    day: summary?.day_return_pct ?? (moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : null),
    total: summary?.total_return_pct ?? null,
    volume: summary?.total_volume_cash ?? null,
    premium: summary?.avg_premium_pct ?? null,
  };
}

/** Branch indexes (JP / EN / ID) from their units, weighted by constituent count. */
function branchView(id: "JP" | "EN" | "ID", name: string, units: IndexView[], members: MarketAsset[]): IndexView | null {
  const parts = units.filter((unit) => branchOf(unit.id) === id && unit.values.length);
  if (!parts.length) return null;
  const weight = (unit: IndexView) => unit.members.length || 1;
  const totalWeight = parts.reduce((sum, unit) => sum + weight(unit), 0);
  const length = Math.min(...parts.map((unit) => unit.values.length));
  const dates = parts[0].dates.slice(-length);
  const values = Array.from({ length }, (_, i) => parts.reduce((sum, unit) => sum + unit.values[unit.values.length - length + i] * weight(unit), 0) / totalWeight);
  const avg = (pick: (unit: IndexView) => number | null) => {
    const present = parts.filter((unit) => pick(unit) !== null);
    return present.length ? present.reduce((sum, unit) => sum + (pick(unit) as number) * weight(unit), 0) / present.reduce((sum, unit) => sum + weight(unit), 0) : null;
  };
  return {
    id,
    name,
    kind: "branch",
    members,
    dates,
    values,
    value: values.at(-1) ?? null,
    day: avg((unit) => unit.day),
    total: avg((unit) => unit.total),
    volume: parts.reduce((sum, unit) => sum + (unit.volume ?? 0), 0),
    premium: avg((unit) => unit.premium),
  };
}

// ── Constituent heatmap (squarified treemap) ─────────────────────────────
type Rect<T> = T & { x: number; y: number; w: number; h: number };
function squarify<T extends { v: number }>(items: T[], x0: number, y0: number, w0: number, h0: number): Array<Rect<T>> {
  const total = items.reduce((sum, item) => sum + item.v, 0) || 1;
  const scale = (w0 * h0) / total;
  let rest = items.map((item) => ({ ...item, ar: item.v * scale }));
  const out: Array<Rect<T>> = [];
  let x = x0;
  let y = y0;
  let w = w0;
  let h = h0;
  const worst = (row: typeof rest, side: number) => {
    const s = row.reduce((sum, r) => sum + r.ar, 0);
    const mx = Math.max(...row.map((r) => r.ar));
    const mn = Math.min(...row.map((r) => r.ar));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) {
      row.push(rest[i]);
      i += 1;
    }
    const s = row.reduce((sum, r) => sum + r.ar, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      row.forEach((r) => {
        const rh = r.ar / cw;
        out.push({ ...r, x, y: cy, w: cw, h: rh });
        cy += rh;
      });
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      row.forEach((r) => {
        const rw = r.ar / rh;
        out.push({ ...r, x: cx, y, w: rw, h: rh });
        cx += rw;
      });
      y += rh;
      h -= rh;
    }
    rest = rest.slice(i);
  }
  return out;
}

function tileBg(move: number | null) {
  if (move === null || Math.abs(move) < 0.0005) return "var(--ink-3)";
  const t = Math.max(-1, Math.min(1, move / 0.05));
  const alpha = ((0.1 + Math.abs(t) * 0.62) * 0.55).toFixed(3);
  return t > 0 ? `rgba(46, 227, 142, ${alpha})` : `rgba(255, 68, 96, ${alpha})`;
}

function Treemap({ view }: { view: IndexView }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const items = view.members
    .map((asset) => ({ asset, v: (asset.current_mid_price ?? 0) * Math.max(40, asset.volume_24h ?? 0) }))
    .filter((item) => item.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = items.reduce((sum, item) => sum + item.v, 0) || 1;
  const rects = size.w ? squarify(items, 0, 0, size.w, size.h) : [];
  return (
    <section className={styles.treeSec}>
      <div className={ui.secHead}>
        <h2>Constituent heatmap · {view.name}</h2>
        <span className={ui.aside}>tile area = price × 24h volume · color = today&apos;s move</span>
      </div>
      <div className={styles.tree} ref={box}>
        {rects.map((rect) => {
          const move = rect.asset.move_24h_pct;
          const size = rect.w < 46 || rect.h < 34 ? styles.xs : rect.w < 96 || rect.h < 54 ? styles.sm : "";
          const mark = Math.max(14, Math.min(40, Math.min(rect.w, rect.h) * 0.32));
          return (
            <Link
              key={rect.asset.symbol}
              href={`/stocks/${encodeURIComponent(rect.asset.symbol)}`}
              className={`${styles.tm} ${size}`}
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: tileBg(move) }}
              data-peek-stock={rect.asset.symbol}
            >
              <span className={styles.tmT}>
                <Oshimark icon={rect.asset.icon} symbol={rect.asset.symbol} size={Math.round(mark)} />
                <b>{rect.asset.symbol}</b>
              </span>
              <span className={styles.tmB}>
                <span>{num(rect.asset.current_mid_price)}</span>
                <span className={ui[toneClass(move)]}>{signedPct(move)}</span>
                <span className={styles.share}>{((rect.v / total) * 100).toFixed(1)}%</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Constituents ─────────────────────────────────────────────────────────
function Constituents({ view }: { view: IndexView }) {
  const [all, setAll] = useState(false);
  const n = view.members.length;
  const rows = view.members
    .map((asset) => {
      const open = asset.previous_settlement_mid_price;
      const mid = asset.current_mid_price;
      return { asset, contribution: open && mid ? (mid - open) / open / n : 0 };
    })
    .sort((a, b) => b.contribution - a.contribution);
  const max = Math.max(0.000001, ...rows.map((row) => Math.abs(row.contribution)));
  const shown = n > 12 && !all ? [...rows.slice(0, 5), null, ...rows.slice(-5)] : rows;
  return (
    <div className={styles.cons}>
      <div className={ui.secHead}>
        <h2>{n > 12 ? "Top and bottom contributors" : "Constituents"}</h2>
        <span className={ui.aside}>sorted by what each added to the index today</span>
      </div>
      <div className={`${styles.crow} ${styles.hd}`}>
        <span />
        <span>Sym</span>
        <span className={styles.nm}>Talent</span>
        <span className={`${styles.r} ${styles.w}`}>Weight</span>
        <span className={styles.r}>Price</span>
        <span className={`${styles.r} ${styles.pm}`}>15D</span>
        <span className={`${styles.r} ${styles.vo}`}>24h vol</span>
        <span className={styles.cb}>Contribution</span>
        <span className={styles.r}>Today</span>
      </div>
      {shown.map((row, index) =>
        row ? (
          <Link key={row.asset.symbol} href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.crow} data-peek-stock={row.asset.symbol}>
            <Oshimark icon={row.asset.icon} symbol={row.asset.symbol} size={20} />
            <b>{row.asset.symbol}</b>
            <span className={styles.nm}>{row.asset.display_name}</span>
            <span className={`${styles.r} ${styles.w} ${ui.flat}`}>{(100 / n).toFixed(1)}%</span>
            <span className={styles.r}>{num(row.asset.current_mid_price)}</span>
            <span className={`${styles.r} ${styles.pm} ${ui[toneClass(change15(row.asset))]}`}>{signedPct(change15(row.asset))}</span>
            <span className={`${styles.r} ${styles.vo} ${ui.flat}`}>{(row.asset.volume_24h ?? 0).toLocaleString("en-US")}</span>
            <DivBar value={row.contribution} max={max} className={styles.cb} />
            <span className={`${styles.r} ${ui[toneClass(row.asset.move_24h_pct)]}`}>{signedPct(row.asset.move_24h_pct)}</span>
          </Link>
        ) : (
          <div key={`gap-${index}`} className={styles.gap}>
            · · · {n - 10} more · · ·
          </div>
        ),
      )}
      {n > 12 ? (
        <button type="button" className={styles.more} onClick={() => setAll(!all)}>
          {all ? "SHOW TOP AND BOTTOM ONLY" : `SHOW ALL ${n} CONSTITUENTS ↓`}
        </button>
      ) : null}
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────
export function IndexesTab({ initialIndex }: { initialIndex?: string }) {
  const router = useRouter();
  const assets = useMarketStore((state) => state.assets);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const [selected, setSelected] = useState(initialIndex || "ALL");
  const [range, setRange] = useState<Range>("3m");
  const [vsAll, setVsAll] = useState(true);
  const [sort, setSort] = useState<"order" | "day" | "total">("order");

  const views = useMemo(() => {
    const bundles = new Map(marketIndexes.map((bundle) => [bundle.group === "all" ? "all" : unitName(bundle.group), bundle]));
    const all = fromBundle("ALL", "Holo All-Talent", "all", bundles.get("all"), assets);
    const units = groupByUnit(assets).map((group) => fromBundle(group.unit, unitLabel(group.unit), "unit", bundles.get(group.unit), group.assets));
    const branches = (
      [
        ["JP", "hololive JP"],
        ["EN", "hololive EN"],
        ["ID", "hololive ID"],
      ] as const
    )
      .map(([id, name]) => branchView(id, name, units, assets.filter((asset) => branchOf(asset.unit) === id)))
      .filter((view): view is IndexView => view !== null);
    return { all, units, branches, byId: new Map([all, ...branches, ...units].map((view) => [view.id, view])) };
  }, [assets, marketIndexes]);

  const view = views.byId.get(selected) ?? views.byId.get(unitName(selected)) ?? views.all;
  const cut = (series: number[], dates: string[]) => {
    const last = dates.at(-1);
    if (!last) return { values: series, dates };
    const from = new Date(new Date(`${last}T12:00:00Z`).getTime() - RANGE_DAYS[range] * 86_400_000).toISOString().slice(0, 10);
    const start = Math.max(0, dates.findIndex((date) => date >= from));
    return { values: series.slice(start), dates: dates.slice(start) };
  };
  const main = cut(view.values, view.dates);
  const compareRaw = view.id !== "ALL" && vsAll ? cut(views.all.values, views.all.dates) : null;
  const compare = compareRaw && compareRaw.values.length && main.values.length ? compareRaw.values.slice(-main.values.length).map((value, _, arr) => (value / arr[0]) * main.values[0]) : null;
  const rangeChange = main.values.length > 1 ? (main.values[main.values.length - 1] - main.values[0]) / main.values[0] : null;
  const shortDates = main.dates.map((date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase());

  const choose = (id: string) => {
    setSelected(id);
    router.replace(id === "ALL" ? "/market/indexes" : `/market/indexes?index=${encodeURIComponent(id)}`, { scroll: false });
    const head = document.getElementById("index-head");
    const tabs = document.querySelector("nav[aria-label='Market sections']");
    if (head && tabs) {
      const top = head.getBoundingClientRect().top;
      const bar = tabs.getBoundingClientRect().bottom;
      if (top < bar || top > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + top - bar - 8, behavior: "smooth" });
    }
  };

  const adv = view.members.filter((asset) => (asset.move_24h_pct ?? 0) > 0.00005).length;
  const dec = view.members.filter((asset) => (asset.move_24h_pct ?? 0) < -0.00005).length;
  const volume24 = view.members.reduce((sum, asset) => sum + (asset.volume_24h ?? 0) * (asset.current_mid_price ?? 0), 0);
  const unitRank = [...views.units].sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
  const maxDay = Math.max(0.0001, ...views.units.map((unit) => Math.abs(unit.day ?? 0)));
  const orderIndex = (id: string) => {
    const i = UNIT_ORDER.indexOf(id);
    return i < 0 ? 99 : i;
  };
  const sortedUnits = [...views.units].sort((a, b) => (sort === "day" ? (b.day ?? 0) - (a.day ?? 0) : sort === "total" ? (b.total ?? 0) - (a.total ?? 0) : orderIndex(a.id) - orderIndex(b.id)));

  if (!assets.length) return <p className={styles.loading}>Loading indexes…</p>;

  return (
    <>
      <div className={styles.top}>
        <div className={styles.main}>
          <div className={styles.head} id="index-head">
            <div className={styles.headL}>
              <div className={styles.kick}>
                {view.kind === "unit" ? "UNIT INDEX" : view.kind === "branch" ? "BRANCH INDEX" : "ALL-TALENT INDEX"} · {view.members.length} TALENTS · EQUAL WEIGHT
              </div>
              <h2>{view.name}</h2>
              <div className={styles.oms}>
                {view.members.map((asset) => (
                  <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} data-peek-stock={asset.symbol}>
                    <Oshimark icon={asset.icon} symbol={asset.symbol} size={16} />
                  </Link>
                ))}
              </div>
            </div>
            <div className={styles.val}>
              <b>{view.value !== null ? num(view.value) : "—"}</b>
              <span className={ui[toneClass(view.day)]}>
                {(view.day ?? 0) >= 0 ? "▲" : "▼"} {signedPct(view.day)} today
              </span>{" "}
              · <span className={ui[toneClass(rangeChange)]}>{signedPct(rangeChange)} {range.toUpperCase()}</span>
            </div>
          </div>
          <div className={styles.ctl}>
            <Seg
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: "1m", label: "1M" },
                { value: "3m", label: "3M" },
                { value: "1y", label: "1Y" },
              ]}
            />
            {view.id !== "ALL" ? <Seg label="Compare" value={vsAll ? "on" : "off"} onChange={(value) => setVsAll(value === "on")} options={[{ value: "on", label: "VS ALL-TALENT" }, { value: "off", label: "ALONE" }]} /> : null}
          </div>
          <div className={styles.chart}>
            <IndexChart values={main.values} compare={compare} tone={(rangeChange ?? 0) >= 0 ? "up" : "down"} dates={shortDates} />
          </div>
          <div className={styles.legend}>
            <span>
              <i className={(rangeChange ?? 0) >= 0 ? styles.lgUp : styles.lgDown} />
              {view.name}
            </span>
            {compare ? (
              <span>
                <i className={styles.lgCmp} />
                All-talent, rebased
              </span>
            ) : null}
            <span>daily closes · base 100</span>
          </div>
          <div className={styles.tiles}>
            <div>
              <span>LEVEL</span>
              <b>{view.value !== null ? num(view.value) : "—"}</b>
              <small>base 100</small>
            </div>
            <div>
              <span>RANGE</span>
              <b className={ui[toneClass(view.total)]}>{signedPct(view.total)}</b>
              <small>total return, 1y</small>
            </div>
            <div>
              <span>BREADTH</span>
              <b>
                <span className={ui.up}>{adv}</span> / <span className={ui.down}>{dec}</span>
              </b>
              <small>of {view.members.length} today</small>
            </div>
            <div>
              <span>24H VOLUME</span>
              <b>{compactMoney(view.volume || volume24)}</b>
              <small>across the basket</small>
            </div>
            <div>
              <span>AVG PREMIUM</span>
              <b className={(view.premium ?? 0) > 0 ? ui.down : ui.up}>{signedPct(view.premium)}</b>
              <small>vs fair at the last settlement</small>
            </div>
          </div>
          <Constituents view={view} />
        </div>
        <aside className={styles.side}>
          {[views.all, ...views.branches].map((entry) => (
            <button key={entry.id} type="button" className={styles.bcard} aria-pressed={view.id === entry.id} onClick={() => choose(entry.id)}>
              <span className={styles.bn}>
                {entry.name}
                <small>{entry.members.length}</small>
              </span>
              <span className={styles.bv}>{entry.value !== null ? num(entry.value) : "—"}</span>
              <Sparkline values={entry.values.slice(-90)} tone={(entry.values.at(-1) ?? 0) >= (entry.values.at(-90) ?? entry.values[0] ?? 0) ? "up" : "down"} width={120} height={26} fill className={styles.bspark} />
              <span className={`${styles.bc} ${ui[toneClass(entry.day)]}`}>{signedPct(entry.day)}</span>
            </button>
          ))}
          <div className={styles.rot}>
            <div className={ui.secHead}>
              <h2>Rotation · today</h2>
              <span className={ui.aside}>unit vs unit</span>
            </div>
            {unitRank.map((unit) => (
              <button key={unit.id} type="button" className={styles.rotrow} aria-pressed={view.id === unit.id} onClick={() => choose(unit.id)}>
                <span>{unit.name}</span>
                <DivBar value={unit.day ?? 0} max={maxDay} />
                <span className={`${styles.r} ${ui[toneClass(unit.day)]}`}>{signedPct(unit.day)}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
      <Treemap view={view} />
      <div className={styles.unitsHead}>
        <h2>Unit indexes</h2>
        <Seg
          label="Sort units"
          value={sort}
          onChange={setSort}
          options={[
            { value: "order", label: "DEBUT ORDER" },
            { value: "day", label: "TODAY" },
            { value: "total", label: "1 YEAR" },
          ]}
        />
      </div>
      <div className={styles.units}>
        {sortedUnits.map((unit) => {
          const best = [...unit.members].sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0))[0];
          const recent = unit.values.slice(-90);
          return (
            <button key={unit.id} type="button" className={styles.ucard} aria-pressed={view.id === unit.id} onClick={() => choose(unit.id)}>
              <span className={styles.utop}>
                <span className={styles.un}>{unit.name}</span>
                <span className={styles.urk}>#{unitRank.indexOf(unit) + 1} today</span>
              </span>
              <span className={styles.uoms}>
                {unit.members.map((asset) => (
                  <Oshimark key={asset.symbol} icon={asset.icon} symbol={asset.symbol} size={18} />
                ))}
              </span>
              <Sparkline values={recent} tone={(recent.at(-1) ?? 0) >= (recent[0] ?? 0) ? "up" : "down"} width={160} height={34} fill className={styles.uspark} />
              <span className={styles.uv}>
                <b>{unit.value !== null ? num(unit.value) : "—"}</b>
                <span>
                  <span className={ui[toneClass(unit.day)]}>{signedPct(unit.day)}</span> <span className={ui.flat}>· 1y</span> <span className={ui[toneClass(unit.total)]}>{signedPct(unit.total)}</span>
                </span>
              </span>
              {best ? (
                <span className={styles.best}>
                  best today <Oshimark icon={best.icon} symbol={best.symbol} size={13} /> {best.symbol} <span className={ui[toneClass(best.move_24h_pct)]}>{signedPct(best.move_24h_pct)}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className={ui.foot}>
        Indexes are equal-weight and rebased to 100. Every talent counts the same no matter the price, so a $4 stock moving 10% moves its unit as much as a $40 one. Branch indexes combine their units by headcount.
      </p>
    </>
  );
}
