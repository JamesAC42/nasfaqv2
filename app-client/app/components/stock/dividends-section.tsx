"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Term } from "@/app/components/common/tip";
import { nextEvaluationAt, untilText } from "@/app/components/market/dividends-tab";
import { useApi } from "@/app/components/stock/use-stock-data";
import { money, signedPct } from "@/app/lib/time";
import type { MarketAsset, MyDividendWeek } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/stock/dossier.module.scss";
import local from "@/app/components/stock/dividends-section.module.scss";

type Review = {
  eval_date: string;
  on_demand: boolean;
  rate: number;
  per_share: number;
  growth_pct: number | null;
  held: number;
  paid: number;
  max_supply_before: number | null;
  max_supply_after: number | null;
  buyback_action: string | null;
  rank: number;
  of: number;
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const normalize = (raw: Record<string, unknown>): Review[] =>
  (Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : []).map((row) => ({
    eval_date: String(row.eval_date ?? ""),
    on_demand: Boolean(row.on_demand),
    rate: num(row.rate),
    per_share: num(row.per_share),
    growth_pct: row.growth_pct === null || row.growth_pct === undefined ? null : num(row.growth_pct),
    held: num(row.held),
    paid: num(row.paid),
    max_supply_before: row.max_supply_before === null || row.max_supply_before === undefined ? null : num(row.max_supply_before),
    max_supply_after: row.max_supply_after === null || row.max_supply_after === undefined ? null : num(row.max_supply_after),
    buyback_action: row.buyback_action ? String(row.buyback_action) : null,
    rank: num(row.rank),
    of: num(row.of),
  }));

const tone = (value: number | null) => (value === null || value === 0 ? "" : value > 0 ? styles.up : styles.down);
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The stock's side of the weekly Dividend Review: what the last one did (dividend or fee, where its
 * channel growth ranked, max shares), the past reviews as bars, your own payouts here, and when
 * the next one lands.
 */
export function DividendsSection({ asset }: { asset: MarketAsset }) {
  const now = useNow();
  const { user } = useAuth();
  const reviews = useApi<Review[]>(`/api/market/assets/${encodeURIComponent(asset.symbol)}/evaluations?limit=12`, normalize);
  const mine = useApi<MyDividendWeek[]>(user ? "/api/market/me/dividends?limit=12" : null, (raw) => (Array.isArray(raw.weeks) ? (raw.weeks as MyDividendWeek[]) : []));
  const items = useMemo(() => reviews.data ?? [], [reviews.data]);
  const last = items[0] ?? null;
  const next = now ? nextEvaluationAt(now) : null;
  const myLines = useMemo(
    () =>
      (mine.data ?? [])
        .map((week) => ({ eval_date: week.eval_date, line: week.lines.find((line) => line.symbol === asset.symbol) ?? null }))
        .filter((entry) => entry.line),
    [asset.symbol, mine.data],
  );

  return (
    <section className={styles.sec} id="s-divs">
      <div className={styles.secHead}>
        <h2>Dividends</h2>
        <span className={styles.aside} suppressHydrationWarning>
          next <Term k="evaluation">Dividend Review</Term> Saturday 00:00 ET{next && now ? ` · in ${untilText(next - now)}` : ""}
        </span>
      </div>

      {!last ? (
        <p className={styles.copy}>
          {reviews.loading ? (
            "Reading past reviews…"
          ) : (
            <>
              Every Saturday the Dividend Review ranks every stock by its channel&apos;s growth that week: the top pays holders a dividend, the bottom charges a share fee, the middle
              pays nothing. {asset.symbol} hasn&apos;t been through one yet. <Link href="/how-to-play#weekly">How it works →</Link>
            </>
          )}
        </p>
      ) : (
        <>
          <div className={styles.kpis}>
            <div>
              <small className={styles.label}>Last review · {shortDate(last.eval_date)}</small>
              <b className={`${styles.kpiV} ${tone(last.rate)}`}>{last.rate ? signedPct(last.rate, 2) : "no dividend"}</b>
              <span className={styles.kpiD}>
                {last.rate > 0 ? "dividend" : last.rate < 0 ? "share fee" : "in the quiet middle"}
                {last.rate ? ` · ${money(Math.abs(last.per_share))} a share` : ""}
              </span>
            </div>
            <div>
              <small className={styles.label}>Channel growth that week</small>
              <b className={`${styles.kpiV} ${tone(last.growth_pct)}`}>
                {last.growth_pct === null ? "—" : `${last.growth_pct > 0 ? "+" : ""}${last.growth_pct.toFixed(1)}%`}
              </b>
              <span className={styles.kpiD}>
                #{last.rank} of {last.of} stocks
              </span>
            </div>
            <div>
              <small className={styles.label}>
                <Term k="max-supply">Max shares</Term>
              </small>
              <b className={styles.kpiV}>{last.max_supply_after === null ? "—" : Math.round(last.max_supply_after).toLocaleString("en-US")}</b>
              <span className={styles.kpiD}>
                {last.max_supply_before === null || last.max_supply_after === null || last.max_supply_before === last.max_supply_after
                  ? "unchanged"
                  : `${last.max_supply_after > last.max_supply_before ? "▲" : "▼"} from ${Math.round(last.max_supply_before).toLocaleString("en-US")}`}
                {last.buyback_action ? ` · buyback ${last.buyback_action.replace(/[_+]/g, (c) => (c === "+" ? ", then " : " "))}` : ""}
              </span>
            </div>
            <div>
              <small className={styles.label}>{user ? "Your last payout here" : "Paid to holders"}</small>
              {user ? (
                myLines[0]?.line ? (
                  <>
                    <b className={`${styles.kpiV} ${tone(myLines[0].line.amount)}`}>{money(myLines[0].line.amount)}</b>
                    <span className={styles.kpiD}>
                      on {myLines[0].line.quantity.toLocaleString("en-US")} sh · {shortDate(myLines[0].eval_date)}
                    </span>
                  </>
                ) : (
                  <>
                    <b className={styles.kpiV}>—</b>
                    <span className={styles.kpiD}>you didn&apos;t hold {asset.symbol} at a review</span>
                  </>
                )
              ) : (
                <>
                  <b className={`${styles.kpiV} ${tone(last.paid)}`}>{money(last.paid)}</b>
                  <span className={styles.kpiD}>on {Math.round(last.held).toLocaleString("en-US")} sh held</span>
                </>
              )}
            </div>
          </div>
          {items.length > 1 ? <RateBars items={items} /> : null}
          <Link href="/market/dividends" className={styles.more}>
            The whole review →
          </Link>
        </>
      )}
    </section>
  );
}

/** Past reviews' rates as bars around zero: dividends up, fees down. Hover (or focus) reads one out. */
function RateBars({ items }: { items: Review[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = [...items].reverse();
  const max = Math.max(0.01, ...series.map((item) => Math.abs(item.rate)));
  const shown = hover === null ? null : series[hover];
  return (
    <div className={local.bars}>
      <div className={local.barsHead}>
        <small>Past reviews</small>
        <span aria-live="polite">
          {shown ? (
            <>
              {shortDate(shown.eval_date)}
              {shown.on_demand ? " (playtest)" : ""}: <b className={tone(shown.rate)}>{shown.rate ? signedPct(shown.rate, 2) : "no dividend"}</b> · growth{" "}
              {shown.growth_pct === null ? "—" : `${shown.growth_pct > 0 ? "+" : ""}${shown.growth_pct.toFixed(1)}%`} · #{shown.rank}
            </>
          ) : (
            "hover a week"
          )}
        </span>
      </div>
      <div className={local.plot} onPointerLeave={() => setHover(null)}>
        {series.map((item, index) => (
          <button
            key={item.eval_date}
            type="button"
            className={local.col}
            data-on={hover === index || undefined}
            onPointerEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
            aria-label={`${shortDate(item.eval_date)}: ${item.rate ? signedPct(item.rate, 2) : "no dividend"}`}
          >
            <span className={local.well}>
              <i data-sign={item.rate > 0 ? "up" : item.rate < 0 ? "down" : "flat"} style={{ height: `${item.rate ? Math.max(3, (Math.abs(item.rate) / max) * 50) : 0}%` }} />
            </span>
            <small>{shortDate(item.eval_date)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
