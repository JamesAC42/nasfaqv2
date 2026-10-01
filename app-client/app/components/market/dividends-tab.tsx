"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { StockChip } from "@/app/components/common/stock-chip";
import { Term } from "@/app/components/common/tip";
import { num, RankRow, useAssetMap } from "@/app/components/market/bits";
import { apiFetch } from "@/app/lib/api";
import { money, signedPct } from "@/app/lib/time";
import type { EvaluationRow, MyDividendWeek, WeeklyEvaluation } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/dividends-tab.module.scss";

type Listing = { eval_date: string; dividends_total: number | null; fees_total: number | null; buybacks_started: number };

/** The next Saturday 00:00 in New York, as a timestamp. */
export function nextEvaluationAt(now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const secondsIntoDay = (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const daysToSaturday = (6 - weekday + 7) % 7 || 7;
  return now + (daysToSaturday * 86_400 - secondsIntoDay) * 1000;
}

function dateLong(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

const rate = (value: number) => signedPct(value, 2);

/** "3d 14h" or "5h 12m". */
export function untilText(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** The Dividend Review: the latest weekly evaluation (or any past one), and your own week. */
export function DividendsTab({ initialDate }: { initialDate?: string }) {
  const now = useNow();
  const { user } = useAuth();
  const bySymbol = useAssetMap();
  const icon = (symbol: string) => bySymbol.get(symbol.toUpperCase())?.icon;
  const [listing, setListing] = useState<Listing[] | null>(null);
  const [date, setDate] = useState<string | null>(initialDate ?? null);
  const [review, setReview] = useState<WeeklyEvaluation | null | undefined>(undefined);
  const [mine, setMine] = useState<MyDividendWeek[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    apiFetch<{ items: Listing[] }>("/api/market/evaluations?limit=26")
      .then((result) => setListing(result.items))
      .catch(() => setListing([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<WeeklyEvaluation>(date ? `/api/market/evaluations/${date}` : "/api/market/evaluations/latest")
      .then((result) => {
        if (!cancelled) setReview(result);
      })
      .catch(() => {
        if (!cancelled) setReview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ weeks: MyDividendWeek[] }>("/api/market/me/dividends?limit=12")
      .then((result) => setMine(result.weeks))
      .catch(() => setMine([]));
  }, [user]);

  const next = now ? nextEvaluationAt(now) : null;
  const myWeek = useMemo(() => (review ? mine?.find((week) => week.eval_date === review.eval_date) ?? null : null), [mine, review]);

  if (review === undefined) return <p className={`${ui.empty} ${styles.pad}`}>Loading the Dividend Review…</p>;
  if (review === null) return <NoEvaluationYet next={next} now={now} />;

  const top = review.top_dividends[0];
  const worst = review.top_fees[0];
  const all = [...review.assets].sort((a, b) => b.rate - a.rate);

  return (
    <>
      <div className={styles.lede}>
        <div>
          <div className={styles.kick}>
            {dateLong(review.eval_date).toUpperCase()} · <Term k="evaluation">WEEKLY EVALUATION</Term> · 00:00 ET
          </div>
          <h2>{top ? `${top.display_name} pays ${rate(top.rate)} a share; ${review.charging_count} stocks charge fees` : "A flat week: no dividends"}</h2>
          <p>
            <b>{money(review.dividends_total)}</b> paid out{review.credit_converted !== undefined ? <> as <Term k="credit">Credit</Term></> : null} to {review.holders_paid.toLocaleString("en-US")} players,{" "}
            <b>{money(Math.abs(review.fees_total))}</b> in <Term k="dividend">share fees</Term> from {review.holders_charged.toLocaleString("en-US")}.{" "}
            {top ? (
              <>
                <StockChip symbol={top.symbol} /> had the best week against the market, at {money(top.per_share)} a share
              </>
            ) : null}
            {worst ? (
              <>
                {top ? "; " : ""}
                <StockChip symbol={worst.symbol} /> the worst, charging {money(Math.abs(worst.per_share))} a share
              </>
            ) : null}
            . {review.flat_count} stocks sat close enough to the middle to pay nothing.
            {review.credit_converted ? (
              <>
                {" "}
                <b>{money(review.credit_converted)}</b> of Credit turned into Cash ({Math.round((review.credit_conversion_rate ?? 0) * 100)}% of every balance
                {review.credit_conversion_minimum ? `, or ${money(review.credit_conversion_minimum, { compact: true })} if that's more` : ""}).
              </>
            ) : null}
            {review.buybacks_started.length ? (
              <>
                {" "}
                <b>{review.buybacks_started.length}</b> {review.buybacks_started.length === 1 ? "stock is" : "stocks are"} now frozen for a <Term k="buyback">buyback</Term>.
              </>
            ) : null}
          </p>
        </div>
        <label className={styles.pick}>
          <span className={ui.label}>Week</span>
          <select value={review.eval_date} onChange={(event) => setDate(event.target.value)}>
            {(listing ?? [{ eval_date: review.eval_date } as Listing]).map((row) => (
              <option key={row.eval_date} value={row.eval_date}>
                {row.eval_date}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={ui.kstrip} style={{ "--cols": 5 } as React.CSSProperties}>
        <div>
          <span className={ui.label}>Dividends</span>
          <span className={`${ui.kv} ${ui.up}`}>{money(review.dividends_total, { compact: true })}</span>
          <span className={ui.ks}>{review.paying_count} stocks paying</span>
        </div>
        <div>
          <span className={ui.label}>Share fees</span>
          <span className={`${ui.kv} ${ui.down}`}>{money(review.fees_total, { compact: true })}</span>
          <span className={ui.ks}>{review.charging_count} stocks charging</span>
        </div>
        <div>
          <span className={ui.label}>Near the middle</span>
          <span className={ui.kv}>{review.flat_count}</span>
          <span className={ui.ks}>nothing either way</span>
        </div>
        <div>
          <span className={ui.label}>Buybacks</span>
          <span className={ui.kv}>{review.buybacks_started.length}</span>
          <span className={ui.ks}>{review.buybacks_closed.length ? `${review.buybacks_closed.length} closed` : "started this week"}</span>
        </div>
        <div>
          <span className={ui.label}>Next evaluation</span>
          <span className={ui.kv} suppressHydrationWarning>
            {next && now ? untilText(next - now) : "—"}
          </span>
          <span className={ui.ks}>Saturday 00:00 ET</span>
        </div>
      </div>

      {user ? <YourWeek week={myWeek} loading={mine === null} evalDate={review.eval_date} /> : null}

      <div className={styles.grid}>
        <List title="Dividends" hint="rate · per share" tone="up" kind="rate" rows={review.top_dividends} icon={icon} render={(row) => [`${money(row.per_share)} a share`, rate(row.rate)]} empty="Nobody paid this week." />
        <List title="Share fees" hint="rate · per share" tone="down" kind="rate" rows={review.top_fees} icon={icon} render={(row) => [`${money(Math.abs(row.per_share))} a share`, rate(row.rate)]} empty="Nobody charged this week." />
        <List
          title="Max shares up"
          hint="from subscribers"
          tone="up"
          kind="shares"
          rows={review.max_shares_raised}
          icon={icon}
          render={(row) => [`${row.max_supply_before.toLocaleString("en-US")} → ${row.max_supply_after.toLocaleString("en-US")}`, `+${(row.max_supply_after - row.max_supply_before).toLocaleString("en-US")}`]}
          empty="No max went up."
        />
        <List
          title="Max shares down"
          hint="from subscribers"
          tone="down"
          kind="shares"
          rows={review.max_shares_lowered}
          icon={icon}
          render={(row) => [`${row.max_supply_before.toLocaleString("en-US")} → ${row.max_supply_after.toLocaleString("en-US")}`, (row.max_supply_after - row.max_supply_before).toLocaleString("en-US")]}
          empty="No max came down."
        />
      </div>

      {review.buybacks_started.length || review.buybacks_closed.length ? (
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2>
              <Term k="buyback">Buybacks</Term>
            </h2>
            <span className={ui.aside}>frozen until players sell back under the max, or the next evaluation</span>
          </div>
          {review.buybacks_started.map((row) => (
            <RankRow
              key={`s-${row.symbol}`}
              symbol={row.symbol}
              icon={icon(row.symbol)}
              detail={`${Math.round(row.held).toLocaleString("en-US")} held, max ${row.max_supply.toLocaleString("en-US")} · broker pays ${money(row.offer)} (${row.frozen_price ? Math.round((row.offer / row.frozen_price) * 100) : 120}%)`}
              tone="down"
              value={`${Math.round(row.over).toLocaleString("en-US")} over`}
            />
          ))}
          {review.buybacks_closed.map((row) => (
            <RankRow
              key={`c-${row.symbol}`}
              symbol={row.symbol}
              icon={icon(row.symbol)}
              detail={row.status === "forced" ? `forced: ${num(row.forced_shares, 1)} shares at the base rate ${money(row.forced_price)}` : `players sold ${num(row.shares_bought, 1)} back; over`}
              tone="flat"
              value={row.status === "forced" ? "FORCED" : "ENDED"}
            />
          ))}
        </div>
      ) : null}

      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Every stock</h2>
          <span className={ui.aside}>best week first</span>
        </div>
        <div className={styles.table} role="table" aria-label="Every stock's dividend and max shares">
          <div className={styles.thead} role="row">
            <span role="columnheader">Stock</span>
            <span role="columnheader">Rate</span>
            <span role="columnheader">Per share</span>
            <span role="columnheader">
              <Term k="max-supply">Max shares</Term>
            </span>
            <span role="columnheader">Held</span>
          </div>
          {(showAll ? all : all.slice(0, 15)).map((row) => (
            <div key={row.symbol} className={styles.trow} role="row">
              <span role="cell">
                <Link href={`/stocks/${encodeURIComponent(row.symbol)}`} className={styles.sym} data-peek-stock={row.symbol} prefetch={false}>
                  <Oshimark icon={icon(row.symbol)} symbol={row.symbol} size={18} />
                  <b>{row.symbol}</b>
                  <small>{row.display_name}</small>
                </Link>
              </span>
              <span role="cell" className={row.rate > 0 ? ui.up : row.rate < 0 ? ui.down : ui.flat}>
                {row.rate ? rate(row.rate) : "—"}
              </span>
              <span role="cell">{row.per_share ? money(row.per_share) : "—"}</span>
              <span role="cell">
                {row.max_supply_after !== row.max_supply_before ? `${row.max_supply_before.toLocaleString("en-US")} → ` : ""}
                {row.max_supply_after.toLocaleString("en-US")}
                {row.buyback?.includes("started") ? <b className={ui.down}> BUYBACK</b> : null}
              </span>
              <span role="cell">{Math.round(row.held).toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
        {all.length > 15 ? (
          <button type="button" className={styles.more} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show the top 15" : `Show all ${all.length}`}
          </button>
        ) : null}
        <p className={ui.note}>
          How it works: each channel&apos;s value this week against last week, ranked on a bell curve across the market. The middle pays nothing; the rest pay a
          dividend or charge a fee per share held, up to 10% of the stock&apos;s value. Max shares reset from subscriber count. <Link href="/how-to-play#weekly">How to play →</Link>
        </p>
      </div>
    </>
  );
}

function List({
  title,
  hint,
  tone,
  kind,
  rows,
  icon,
  render,
  empty,
}: {
  title: string;
  /** What the bar measures: the dividend rate, or the change in max shares. */
  kind: "rate" | "shares";
  hint: string;
  tone: "up" | "down";
  rows: EvaluationRow[];
  icon: (symbol: string) => string | null | undefined;
  render: (row: EvaluationRow) => [string, string];
  empty: string;
}) {
  const metric = (row: EvaluationRow) => (kind === "rate" ? Math.abs(row.rate) : Math.abs(row.max_supply_after - row.max_supply_before));
  const max = Math.max(0.0001, ...rows.map(metric));
  return (
    <div className={ui.sec}>
      <div className={ui.secHead}>
        <h2 className={ui[tone]}>{title}</h2>
        <span className={ui.aside}>{hint}</span>
      </div>
      {rows.length ? (
        rows.map((row) => {
          const [detail, value] = render(row);
          return <RankRow key={row.symbol} symbol={row.symbol} icon={icon(row.symbol)} detail={detail} bar={metric(row) / max} tone={tone} value={value} />;
        })
      ) : (
        <p className={ui.empty}>{empty}</p>
      )}
    </div>
  );
}

function YourWeek({ week, loading, evalDate }: { week: MyDividendWeek | null; loading: boolean; evalDate: string }) {
  return (
    <div className={`${ui.sec} ${styles.mine}`}>
      <div className={ui.secHead}>
        <h2>Your week</h2>
        <span className={ui.aside}>{evalDate}</span>
      </div>
      {loading ? (
        <p className={ui.empty}>Loading…</p>
      ) : !week ? (
        <p className={ui.empty}>Nothing this week: you held none of the stocks that paid or charged.</p>
      ) : (
        <>
          <p className={styles.net}>
            <b className={week.net >= 0 ? ui.up : ui.down}>{money(week.net)}</b>
            <span>{week.net >= 0 ? "DIVS" : "net share fees"}</span>
          </p>
          <div className={styles.mineRows}>
            {week.lines.map((line) => (
              <span key={line.symbol} className={styles.mineRow}>
                <StockChip symbol={line.symbol} />
                <small>
                  {num(line.quantity, 0)} sh × {money(line.per_share)}
                </small>
                <b className={line.amount >= 0 ? ui.up : ui.down}>{money(line.amount)}</b>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NoEvaluationYet({ next, now }: { next: number | null; now: number | null }) {
  return (
    <div className={styles.lede}>
      <div>
        <div className={styles.kick}>
          <Term k="evaluation">WEEKLY EVALUATION</Term> · SATURDAY 00:00 ET
        </div>
        <h2>The first Dividend Review lands Saturday</h2>
        <p>
          Every Saturday at midnight New York time, each channel&apos;s week is ranked against the rest. The top pay a <Term k="dividend">dividend</Term> per share you hold, the
          bottom charge a fee, the middle nothing. Max shares reset from subscriber count, and any stock left over its max freezes for a <Term k="buyback">buyback</Term>.
          {next && now ? (
            <>
              {" "}
              Next one in <b suppressHydrationWarning>{untilText(next - now)}</b>.
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
