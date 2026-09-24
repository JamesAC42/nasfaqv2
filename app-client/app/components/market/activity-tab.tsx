"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { compactMoney, DivBar, num, RankRow, Seg, toneClass, useAssetMap } from "@/app/components/market/bits";
import { FlowBars, MiniCandles } from "@/app/components/market/mini-charts";
import { apiFetch } from "@/app/lib/api";
import { formatCountdown, formatEtTime, getMarketClock, MARKET_TIME_ZONE, TICKS } from "@/app/lib/market-clock";
import { normalizeCandles, normalizeLeaderboardResponse } from "@/app/lib/normalizers";
import { signedPct, timeAgo } from "@/app/lib/time";
import type { CandlePoint, MarketHubTrade, MarketLiveOrderFlow } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { talentAccent } from "@/app/lib/talent-color";
import { fetchLiveOrderFlow, useHubStore } from "@/app/stores/hub-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/activity-tab.module.scss";

const BATCH_MS = 10 * 60 * 1000;
const WHALE = 1000;
const MEGA = 4000;
const PAGE_ROWS = 80;

type Side = "all" | "buy" | "sell";
type Who = "all" | "friends" | "rivals" | "me";
type FlowMode = "current_tick" | "per_minute" | "cycles_24h";

const isBuy = (trade: MarketHubTrade) => trade.side.toLowerCase() === "buy";
const etClock = (ts: string, seconds = false) => {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "" : formatEtTime(date, { seconds });
};

function initials(name: string | null) {
  return (name || "anon").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
}

function Avatar({ name, color }: { name: string | null; color: string | null }) {
  return (
    <span className={styles.ava} style={{ background: color || "var(--ink-4)" }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// ── KPI strip ────────────────────────────────────────────────────────────
function Kpis({ trades }: { trades: MarketHubTrade[] }) {
  const hub = useHubStore((state) => state.hub);
  const windows = hub?.activity.windows;
  const recent = trades.slice(0, 200);
  const buyCash = recent.filter(isBuy).reduce((sum, trade) => sum + trade.gross_cash, 0);
  const allCash = recent.reduce((sum, trade) => sum + trade.gross_cash, 0);
  const buyPct = allCash ? (buyCash / allCash) * 100 : 50;
  const biggest = recent.reduce<MarketHubTrade | null>((best, trade) => (!best || trade.gross_cash > best.gross_cash ? trade : best), null);
  const five = windows?.["5m"];
  const score = five ? Math.min(100, Math.round(five.trade_count * 3.2)) : null;
  return (
    <div className={ui.kstrip} style={{ "--cols": 5 } as React.CSSProperties}>
      <div>
        <span className={ui.label}>Activity intensity</span>
        <span className={ui.kv}>
          {score ?? "—"}
          <small className={styles.of}> /100</small>
        </span>
        <span className={ui.ks}>{five ? `${five.trade_count} trades · ${five.trader_count} traders in 5m` : "—"}</span>
      </div>
      <div>
        <span className={ui.label}>1 hour flow</span>
        <span className={ui.kv}>{compactMoney(windows?.["1h"].volume_cash)}</span>
        <span className={ui.ks}>{windows ? `${windows["1h"].trade_count.toLocaleString("en-US")} trades` : "—"}</span>
      </div>
      <div>
        <span className={ui.label}>Buy pressure</span>
        <div className={ui.pressure}>
          <i style={{ width: `${buyPct.toFixed(1)}%` }} />
        </div>
        <span className={ui.ks}>
          <span className={ui.up}>{buyPct.toFixed(0)}% buying</span> · <span className={ui.down}>{(100 - buyPct).toFixed(0)}% selling</span>
        </span>
      </div>
      <div>
        <span className={ui.label}>Biggest fill</span>
        <span className={`${ui.kv} ${biggest ? ui[isBuy(biggest) ? "up" : "down"] : ""}`}>{compactMoney(biggest?.gross_cash)}</span>
        <span className={ui.ks}>{biggest ? `${biggest.username ?? "anon"} · ${biggest.quantity} ${biggest.symbol}` : "—"}</span>
      </div>
      <div>
        <span className={ui.label}>24 hour crowd</span>
        <span className={ui.kv}>{windows ? windows["24h"].trader_count.toLocaleString("en-US") : "—"}</span>
        <span className={ui.ks}>{windows ? `${windows["24h"].asset_count} stocks touched · ${windows["24h"].trade_count.toLocaleString("en-US")} fills` : "—"}</span>
      </div>
    </div>
  );
}

// ── The queue: pending live orders, per stock ────────────────────────────
function Queue() {
  const now = useNow();
  const assets = useMarketStore((state) => state.assets);
  const liveOrders = useHubStore((state) => state.liveOrders);
  const lastFlash = useHubStore((state) => state.lastFlash);
  const bySymbol = useAssetMap();
  const { calm } = useMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<FlowMode>("current_tick");
  const [flow, setFlow] = useState<MarketLiveOrderFlow | null>(null);
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [flash, setFlash] = useState<{ symbol: string; side: string; key: number } | null>(null);

  useEffect(() => {
    if (!lastFlash || calm) return;
    setFlash({ symbol: lastFlash.symbol, side: lastFlash.side, key: lastFlash.at });
    const timer = window.setTimeout(() => setFlash(null), 800);
    return () => window.clearTimeout(timer);
  }, [calm, lastFlash]);

  useEffect(() => {
    let cancelled = false;
    const load = () => void fetchLiveOrderFlow(selected).then((result) => !cancelled && setFlow(result));
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected, liveOrders?.pending_count]);

  useEffect(() => {
    let cancelled = false;
    const path = selected ? `/api/market/assets/${encodeURIComponent(selected)}/candles?interval=1h&range=24h` : "/api/market/candles?interval=1h&range=24h";
    apiFetch<{ candles?: Array<Record<string, unknown>> }>(path, { cache: "no-store" })
      .then((result) => !cancelled && setCandles(normalizeCandles(result.candles ?? [])))
      .catch(() => !cancelled && setCandles([]));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const perAsset = useMemo(() => new Map((liveOrders?.assets ?? []).map((entry) => [entry.symbol.toUpperCase(), entry])), [liveOrders]);
  const coins = useMemo(() => [...assets].sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0)), [assets]);
  const maxQty = Math.max(1, ...[...perAsset.values()].map((entry) => entry.pending_buy_quantity + entry.pending_sell_quantity));
  const clock = now ? getMarketClock(now) : null;
  const executeAt = liveOrders?.next_execute_after ? new Date(liveOrders.next_execute_after) : clock?.nextBatchAt ?? null;
  const secondsLeft = executeAt && now ? Math.max(0, Math.ceil((executeAt.getTime() - now) / 1000)) : clock?.secondsToNextBatch ?? 0;
  const elapsed = Math.min(1, Math.max(0, 1 - secondsLeft / 600));

  const total = {
    buyQty: liveOrders?.pending_buy_quantity ?? 0,
    sellQty: liveOrders?.pending_sell_quantity ?? 0,
    buyN: liveOrders?.pending_buy_count ?? 0,
    sellN: liveOrders?.pending_sell_count ?? 0,
    n: liveOrders?.pending_count ?? 0,
  };
  const buyPct = total.buyQty + total.sellQty ? (total.buyQty / (total.buyQty + total.sellQty)) * 100 : 50;
  const pick = selected ? perAsset.get(selected) : null;
  const stats = selected
    ? { buyQty: pick?.pending_buy_quantity ?? 0, sellQty: pick?.pending_sell_quantity ?? 0, n: pick?.pending_count ?? 0 }
    : { buyQty: total.buyQty, sellQty: total.sellQty, n: total.n };
  const asset = selected ? bySymbol.get(selected) : null;
  const points = flow?.[mode] ?? [];

  return (
    <section className={styles.queue} aria-label="Order queue">
      <div className={styles.qHead} suppressHydrationWarning>
        <div className={styles.when}>
          <small>NEXT BATCH</small>
          {executeAt ? `${formatEtTime(executeAt)} ET` : "--:--"}
        </div>
        <div className={styles.cnt}>
          <small>LANDS IN</small>
          {formatCountdown(secondsLeft, { withHours: false })}
        </div>
        <div className={styles.pr}>
          <div className={ui.pressure}>
            <i style={{ width: `${buyPct.toFixed(1)}%` }} />
          </div>
          <p>
            <span className={ui.up}>
              BUY {total.buyN} orders · {total.buyQty.toLocaleString("en-US")} sh
            </span>
            <span>{total.n} queued</span>
            <span className={ui.down}>
              SELL {total.sellN} orders · {total.sellQty.toLocaleString("en-US")} sh
            </span>
          </p>
        </div>
        <div className={styles.bar}>
          <i style={{ width: `${(elapsed * 100).toFixed(1)}%` }} />
        </div>
      </div>
      <div className={styles.qBody}>
        <div className={styles.coins} role="group" aria-label="Queued orders by stock">
          <button type="button" className={`${styles.coin} ${styles.all}`} aria-pressed={selected === null} onClick={() => setSelected(null)}>
            ALL <small>{(total.buyQty + total.sellQty).toLocaleString("en-US")} sh</small>
          </button>
          {coins.map((coin) => {
            const entry = perAsset.get(coin.symbol.toUpperCase());
            const qty = entry ? entry.pending_buy_quantity + entry.pending_sell_quantity : 0;
            const side = !qty ? "" : entry!.pending_buy_quantity >= entry!.pending_sell_quantity ? styles.b : styles.s;
            const flashing = flash && flash.symbol === coin.symbol.toUpperCase() ? (flash.side === "buy" ? styles.fb : styles.fs) : "";
            return (
              <button
                key={flashing ? `${coin.symbol}-${flash!.key}` : coin.symbol}
                type="button"
                className={[styles.coin, side, qty ? "" : styles.dormant, flashing].filter(Boolean).join(" ")}
                style={{ "--w": (qty / maxQty).toFixed(2), "--br": (0.85 + Math.min(0.5, (qty / maxQty) * 0.5)).toFixed(2) } as React.CSSProperties}
                aria-pressed={selected === coin.symbol}
                title={`${coin.symbol} · ${entry ? `${entry.pending_buy_quantity} buy / ${entry.pending_sell_quantity} sell shares queued` : "nothing queued"}`}
                onClick={() => setSelected(coin.symbol)}
              >
                <Oshimark icon={coin.icon} symbol={coin.symbol} size={22} />
                {coin.symbol}
              </button>
            );
          })}
        </div>
        <div className={styles.panel}>
          <div className={styles.ph}>
            <div className={styles.id}>
              {asset ? <Oshimark icon={asset.icon} symbol={asset.symbol} size={30} /> : <span className={styles.pie} style={{ "--p": `${buyPct}%` } as React.CSSProperties} />}
              <div>
                <b>{asset ? asset.display_name : "All market"}</b>
                <small>{asset ? asset.symbol : "every listed stock"}</small>
              </div>
              {asset ? (
                <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.px}>
                  {num(asset.current_mid_price)} <span className={ui[toneClass(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)}</span>
                </Link>
              ) : null}
            </div>
            <Seg
              label="Flow window"
              value={mode}
              onChange={setMode}
              options={[
                { value: "current_tick", label: "CURRENT BATCH" },
                { value: "per_minute", label: "PER MINUTE" },
                { value: "cycles_24h", label: "24 HOURS" },
              ]}
            />
          </div>
          <div className={styles.stats}>
            <div>
              <span>BUY SHARES</span>
              <b className={ui.up}>{stats.buyQty.toLocaleString("en-US")}</b>
            </div>
            <div>
              <span>SELL SHARES</span>
              <b className={ui.down}>{stats.sellQty.toLocaleString("en-US")}</b>
            </div>
            <div>
              <span>TOTAL FLOW</span>
              <b>{(stats.buyQty + stats.sellQty).toLocaleString("en-US")}</b>
            </div>
            <div>
              <span>ORDERS</span>
              <b>{stats.n.toLocaleString("en-US")}</b>
            </div>
          </div>
          <div className={styles.charts}>
            <div className={styles.chartBox}>
              <div className={styles.cl}>
                {mode === "current_tick" ? "PENDING FLOW · THIS BATCH" : mode === "per_minute" ? "ORDER FLOW · PER MINUTE, LAST HOUR" : "EXECUTED FLOW · 10-MIN CYCLES, 24H"}
              </div>
              <div className={styles.chartArea}>
                {points.length ? <FlowBars points={points} cursor={mode === "current_tick" ? null : null} /> : <div className={styles.chartEmpty}>No orders in this window.</div>}
              </div>
            </div>
            <div className={styles.chartBox}>
              <div className={styles.cl}>{asset ? asset.symbol : "ALL-MARKET"} · HOURLY CANDLES, 24H</div>
              <div className={styles.chartArea}>
                <MiniCandles candles={candles} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── The tape, grouped by 10-minute batch ─────────────────────────────────
const TapeRow = memo(function TapeRow({ trade, icon, tag, fresh, accent }: { trade: MarketHubTrade; icon: string | null | undefined; tag: "friend" | "rival" | "me" | null; fresh: boolean; accent: string }) {
  const buy = isBuy(trade);
  const whale = trade.gross_cash >= WHALE;
  const mega = trade.gross_cash >= MEGA;
  return (
    <div className={[styles.fl, whale ? styles.whale : "", mega ? styles.mega : "", tag === "me" ? styles.me : "", fresh ? styles.fresh : ""].filter(Boolean).join(" ")} style={{ "--c": accent } as React.CSSProperties}>
      <time>{etClock(trade.ts, true)}</time>
      {trade.username ? (
        <Link href={`/profile/${encodeURIComponent(trade.username)}`} className={styles.p}>
          <Avatar name={trade.username} color={trade.profile_color} />
          <b>{tag === "me" ? "you" : trade.username}</b>
          {tag === "friend" ? <span className={`${styles.tg} ${styles.fr}`}>FRIEND</span> : tag === "rival" ? <span className={`${styles.tg} ${styles.rv}`}>RIVAL</span> : null}
        </Link>
      ) : (
        <span className={`${styles.p} ${styles.anon}`}>
          <Avatar name={null} color={null} />
          <b>anon</b>
        </span>
      )}
      <span className={`${styles.sd} ${buy ? styles.sdB : styles.sdS}`}>{buy ? "BUY" : "SELL"}</span>
      <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className={styles.st} data-peek-stock={trade.symbol}>
        <Oshimark icon={icon ?? trade.icon} symbol={trade.symbol} size={18} />
        {trade.symbol}
        {whale ? <span className={styles.wtag}>{mega ? "MEGA" : "WHALE"}</span> : null}
      </Link>
      <span className={`${styles.r} ${styles.q}`}>{trade.quantity.toLocaleString("en-US")}</span>
      <span className={`${styles.r} ${styles.pxc}`}>{num(trade.price)}</span>
      <span className={`${styles.r} ${styles.nt} ${buy ? ui.up : ui.down}`}>
        {buy ? "+" : "−"}${num(trade.gross_cash)}
      </span>
      <span className={styles.mob}>
        <span className={`${styles.sd} ${buy ? styles.sdB : styles.sdS}`}>{buy ? "BUY" : "SELL"}</span>
        <Oshimark icon={icon ?? trade.icon} symbol={trade.symbol} size={16} />
        <b>{trade.symbol}</b> {trade.quantity} @ {num(trade.price)}
        {whale ? <span className={styles.wtag}>{mega ? "MEGA" : "WHALE"}</span> : null}
      </span>
    </div>
  );
});

function useFriendSets(enabled: boolean) {
  const [sets, setSets] = useState<{ friends: Set<string>; rivals: Set<string> } | null>(null);
  useEffect(() => {
    if (!enabled || sets) return;
    let cancelled = false;
    Promise.all(
      (["friends", "rivals"] as const).map((scope) =>
        apiFetch<Record<string, unknown>>(`/api/leaderboard?scope=${scope}&window=all&limit=200`)
          .then((result) => new Set(normalizeLeaderboardResponse(result).entries.filter((entry) => !entry.is_me).map((entry) => entry.username.toLowerCase())))
          .catch(() => new Set<string>()),
      ),
    ).then(([friends, rivals]) => !cancelled && setSets({ friends, rivals }));
    return () => {
      cancelled = true;
    };
  }, [enabled, sets]);
  return sets;
}

function Tape({ initialTicker = "" }: { initialTicker?: string }) {
  const liveTrades = useHubStore((state) => state.trades);
  const nextCursor = useHubStore((state) => state.nextCursor);
  const isLoadingMore = useHubStore((state) => state.isLoadingMore);
  const loadMoreTrades = useHubStore((state) => state.loadMoreTrades);
  const isLoading = useHubStore((state) => state.isLoading);
  const bySymbol = useAssetMap();
  const { user } = useAuth();
  const { theme } = useTheme();
  const [side, setSide] = useState<Side>("all");
  const [size, setSize] = useState<"0" | "100" | "1000">("0");
  const [who, setWho] = useState<Who>("all");
  const [ticker, setTicker] = useState(initialTicker.toUpperCase().slice(0, 4));
  const [live, setLive] = useState(true);
  const [frozen, setFrozen] = useState<MarketHubTrade[] | null>(null);
  const [limit, setLimit] = useState(PAGE_ROWS);
  const seen = useRef<Set<number> | null>(null);
  const sets = useFriendSets(who === "friends" || who === "rivals");

  const trades = live ? liveTrades : frozen ?? liveTrades;
  const waiting = live || !frozen ? 0 : liveTrades.length - frozen.length;
  const me = user?.username?.toLowerCase() ?? null;

  // Rows that arrived after the first render slide in.
  const fresh = useMemo(() => {
    const ids = new Set<number>();
    if (seen.current) trades.forEach((trade) => !seen.current!.has(trade.id) && ids.add(trade.id));
    return ids;
  }, [trades]);
  useEffect(() => {
    seen.current = new Set(trades.map((trade) => trade.id));
  }, [trades]);

  const tagOf = (trade: MarketHubTrade): "friend" | "rival" | "me" | null => {
    const name = trade.username?.toLowerCase();
    if (!name) return null;
    if (me && name === me) return "me";
    if (sets?.friends.has(name)) return "friend";
    if (sets?.rivals.has(name)) return "rival";
    return null;
  };

  const match = (trade: MarketHubTrade) => {
    if (side === "buy" && !isBuy(trade)) return false;
    if (side === "sell" && isBuy(trade)) return false;
    if (trade.gross_cash < Number(size)) return false;
    if (ticker && !trade.symbol.toUpperCase().startsWith(ticker)) return false;
    if (who !== "all") {
      const tag = tagOf(trade);
      if (who === "me" ? tag !== "me" : who === "friends" ? tag !== "friend" : tag !== "rival") return false;
    }
    return true;
  };

  const batches = useMemo(() => {
    const groups: Array<{ key: number; all: MarketHubTrade[] }> = [];
    for (const trade of trades) {
      const key = Math.floor(new Date(trade.ts).getTime() / BATCH_MS);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.all.push(trade);
      else groups.push({ key, all: [trade] });
    }
    return groups;
  }, [trades]);

  let shown = 0;
  const rendered: React.ReactNode[] = [];
  for (const batch of batches) {
    if (shown >= limit) break;
    const hits = batch.all.filter(match);
    if (!hits.length) continue;
    const vol = batch.all.reduce((sum, trade) => sum + trade.gross_cash, 0);
    const buyVol = batch.all.filter(isBuy).reduce((sum, trade) => sum + trade.gross_cash, 0);
    const net = buyVol - (vol - buyVol);
    const landed = batch.all.some((trade) => fresh.has(trade.id));
    rendered.push(
      <div key={batch.key} className={`${styles.bgrp} ${landed ? styles.landed : ""}`}>
        <div className={styles.bgrpHead}>
          <b>{formatEtTime(new Date(batch.key * BATCH_MS))} BATCH</b>
          <span>
            {batch.all.length} fills{hits.length < batch.all.length ? ` · ${hits.length} shown` : ""}
          </span>
          <span>{compactMoney(vol)}</span>
          <span className={styles.flow} title="buy vs sell dollars">
            <i style={{ width: `${vol ? ((buyVol / vol) * 100).toFixed(0) : 50}%` }} />
          </span>
          <span className={`${styles.net} ${ui[toneClass(net)]}`}>net {net >= 0 ? `buy +${compactMoney(net)}` : `sell −${compactMoney(Math.abs(net))}`}</span>
        </div>
        {hits.map((trade) => (
          <TapeRow key={trade.id} trade={trade} icon={bySymbol.get(trade.symbol.toUpperCase())?.icon} tag={tagOf(trade)} fresh={fresh.has(trade.id)} accent={talentAccent(trade.color, theme)} />
        ))}
      </div>,
    );
    shown += hits.length;
  }

  return (
    <>
      <div className={styles.fbar}>
        <Seg label="Side" value={side} onChange={setSide} options={[{ value: "all", label: "ALL" }, { value: "buy", label: "BUYS", tone: "up" }, { value: "sell", label: "SELLS", tone: "down" }]} />
        <Seg label="Size" value={size} onChange={setSize} options={[{ value: "0", label: "ANY SIZE" }, { value: "100", label: "≥$100" }, { value: "1000", label: "WHALES ≥$1K", tone: "blue" }]} />
        <Seg
          label="Who"
          className={styles.who}
          value={who}
          onChange={setWho}
          options={[{ value: "all", label: "EVERYONE" }, { value: "friends", label: "FRIENDS" }, { value: "rivals", label: "RIVALS" }, ...(user ? [{ value: "me" as const, label: "ME" }] : [])]}
        />
        <label className={styles.find}>
          {ticker && bySymbol.get(ticker) ? <Oshimark icon={bySymbol.get(ticker)?.icon} symbol={ticker} size={15} /> : <span className={ui.label}>$</span>}
          <input value={ticker} maxLength={4} placeholder="TICKER" autoComplete="off" spellCheck={false} aria-label="Filter by ticker" onChange={(event) => setTicker(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
        </label>
        <button
          type="button"
          className={styles.live}
          aria-pressed={live}
          onClick={() => {
            if (live) setFrozen(liveTrades);
            else setFrozen(null);
            setLive(!live);
          }}
        >
          <i />
          {live ? "LIVE" : `PAUSED${waiting > 0 ? ` · ${waiting} NEW` : ""}`}
        </button>
      </div>
      <div className={`${styles.fl} ${styles.flHead}`} aria-hidden="true">
        <span>Time</span>
        <span>Player</span>
        <span>Side</span>
        <span>Stock</span>
        <span className={styles.r}>Qty</span>
        <span className={styles.r}>Price</span>
        <span className={styles.r}>Gross</span>
      </div>
      <div>{rendered.length ? rendered : <div className={styles.emptyTape}>{isLoading ? "Loading the tape…" : "Nothing matches these filters in the loaded tape."}</div>}</div>
      {shown >= limit || nextCursor ? (
        <button
          type="button"
          className={styles.more}
          disabled={isLoadingMore}
          onClick={() => {
            setLimit((current) => current + PAGE_ROWS);
            if (shown < limit + PAGE_ROWS) void loadMoreTrades();
          }}
        >
          {isLoadingMore ? "LOADING…" : "LOAD EARLIER BATCHES ↓"}
        </button>
      ) : null}
    </>
  );
}

// ── Side panels ──────────────────────────────────────────────────────────
function PendingOrders() {
  const { user } = useAuth();
  const orders = useProfileStore((state) => state.pendingLiveOrders);
  const fetchPortfolioOrders = useProfileStore((state) => state.fetchPortfolioOrders);
  const refreshTradingState = useProfileStore((state) => state.refreshTradingState);
  const bySymbol = useAssetMap();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) void fetchPortfolioOrders();
  }, [fetchPortfolioOrders, user]);

  if (!user) return null;

  const cancel = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/market/orders/cancel", { method: "POST", body: JSON.stringify({ order_id: id }) });
      setConfirm(null);
      await refreshTradingState();
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Your pending orders</h2>
        <span className={ui.aside}>cancel before the batch</span>
      </div>
      {orders.length ? (
        orders.map((order) => {
          const buy = order.side === "buy";
          return (
            <div key={order.id} className={styles.pord}>
              <Oshimark icon={bySymbol.get(order.symbol.toUpperCase())?.icon} symbol={order.symbol} size={22} />
              <span>
                <b className={buy ? ui.up : ui.down}>
                  {buy ? "BUY" : "SELL"} {order.requested_quantity}
                </b>{" "}
                <b>{order.symbol}</b>
                <small>executes after {order.execute_after ? `${etClock(order.execute_after)} ET` : "the next batch"}</small>
              </span>
              <button type="button" className={confirm === order.id ? styles.confirm : undefined} disabled={busy} onClick={() => (confirm === order.id ? void cancel(order.id) : setConfirm(order.id))}>
                {confirm === order.id ? "CONFIRM" : "CANCEL"}
              </button>
            </div>
          );
        })
      ) : (
        <p className={ui.empty}>No pending orders. Anything you place lands in the next batch.</p>
      )}
      {error ? <p className={styles.err}>{error}</p> : null}
    </section>
  );
}

function LiveRead({ trades }: { trades: MarketHubTrade[] }) {
  const hub = useHubStore((state) => state.hub);
  const windows = hub?.activity.windows;
  const top = hub?.activity.most_active_traders_24h?.[0];
  const lines = [
    windows ? (
      <>
        <b>{windows["5m"].trade_count} trades</b> printed in the last 5 minutes, tracking at <b>{Math.min(100, Math.round(windows["5m"].trade_count * 3.2))}</b> pulse intensity.
      </>
    ) : null,
    windows ? (
      <>
        <b>{compactMoney(windows["1h"].volume_cash)}</b> changed hands over the last hour across <b>{windows["1h"].asset_count}</b> stocks.
      </>
    ) : null,
    top ? (
      <>
        <Link href={`/profile/${encodeURIComponent(top.username)}`}>
          <b>{top.username}</b>
        </Link>{" "}
        is driving the board with <b>{top.trade_count} trades</b> over 24 hours.
      </>
    ) : null,
  ].filter(Boolean);
  if (!lines.length && !trades.length) return null;
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Live read</h2>
        <span className={ui.aside}>from the tape</span>
      </div>
      {lines.map((line, index) => (
        <p key={index} className={styles.readl}>
          <span>{line}</span>
        </p>
      ))}
    </section>
  );
}

function HotSymbols({ trades }: { trades: MarketHubTrade[] }) {
  const bySymbol = useAssetMap();
  const hot = useMemo(() => {
    const counts = new Map<string, number>();
    trades.slice(0, 150).forEach((trade) => counts.set(trade.symbol, (counts.get(trade.symbol) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [trades]);
  if (!hot.length) return null;
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Hot symbols</h2>
        <span className={ui.aside}>most repeated in the tape</span>
      </div>
      <div className={styles.hots}>
        {hot.map(([symbol, count]) => {
          const asset = bySymbol.get(symbol.toUpperCase());
          return (
            <Link key={symbol} href={`/stocks/${encodeURIComponent(symbol)}`} className={styles.hot} data-peek-stock={symbol}>
              <Oshimark icon={asset?.icon} symbol={symbol} size={14} />
              <b>{symbol}</b>
              <i>×{count}</i>
              <span className={ui[toneClass(asset?.move_24h_pct)]}>{signedPct(asset?.move_24h_pct)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function NetFlow({ trades }: { trades: MarketHubTrade[] }) {
  const bySymbol = useAssetMap();
  const rows = useMemo(() => {
    const flow = new Map<string, number>();
    trades.forEach((trade) => flow.set(trade.symbol, (flow.get(trade.symbol) ?? 0) + (isBuy(trade) ? trade.gross_cash : -trade.gross_cash)));
    const sorted = [...flow.entries()].sort((a, b) => b[1] - a[1]);
    return { top: sorted.filter(([, value]) => value > 0).slice(0, 5), bottom: sorted.filter(([, value]) => value < 0).slice(-5).reverse(), max: Math.max(1, ...sorted.map(([, value]) => Math.abs(value))) };
  }, [trades]);
  if (!rows.top.length && !rows.bottom.length) return null;
  const row = ([symbol, value]: [string, number]) => (
    <Link key={symbol} href={`/stocks/${encodeURIComponent(symbol)}`} className={styles.flowrow} data-peek-stock={symbol}>
      <Oshimark icon={bySymbol.get(symbol.toUpperCase())?.icon} symbol={symbol} size={18} />
      <b>{symbol}</b>
      <DivBar value={value} max={rows.max} />
      <span className={`${styles.r} ${ui[toneClass(value)]}`}>
        {value >= 0 ? "+" : "−"}
        {compactMoney(Math.abs(value))}
      </span>
    </Link>
  );
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Net flow</h2>
        <span className={ui.aside}>$ bought − sold, loaded tape</span>
      </div>
      {rows.top.map(row)}
      {rows.top.length && rows.bottom.length ? <div className={styles.split} /> : null}
      {rows.bottom.map(row)}
    </section>
  );
}

function BiggestFills({ trades }: { trades: MarketHubTrade[] }) {
  const bySymbol = useAssetMap();
  const big = useMemo(() => [...trades].sort((a, b) => b.gross_cash - a.gross_cash).slice(0, 5), [trades]);
  if (!big.length) return null;
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Biggest fills</h2>
        <span className={ui.aside}>loaded tape</span>
      </div>
      {big.map((trade, index) => (
        <div key={trade.id} className={styles.big}>
          <span className={styles.n}>{index + 1}</span>
          <Oshimark icon={bySymbol.get(trade.symbol.toUpperCase())?.icon ?? trade.icon} symbol={trade.symbol} size={20} />
          <span className={styles.d}>
            {trade.username ? <Link href={`/profile/${encodeURIComponent(trade.username)}`}>{trade.username}</Link> : "anon"} {isBuy(trade) ? "bought" : "sold"} {trade.quantity}{" "}
            <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`}>{trade.symbol}</Link>
          </span>
          <span className={`${styles.v} ${isBuy(trade) ? ui.up : ui.down}`}>{compactMoney(trade.gross_cash)}</span>
        </div>
      ))}
    </section>
  );
}

function ActiveTraders() {
  const hub = useHubStore((state) => state.hub);
  const traders = hub?.activity.most_active_traders_24h ?? [];
  if (!traders.length) return null;
  const now = Date.now();
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Most active traders</h2>
        <span className={ui.aside}>trades · 24h</span>
      </div>
      {traders.slice(0, 5).map((trader, index) => (
        <div key={trader.user_id} className={styles.big}>
          <span className={styles.n}>{index + 1}</span>
          <Avatar name={trader.username} color={trader.profile_color} />
          <span className={styles.d} suppressHydrationWarning>
            <Link href={`/profile/${encodeURIComponent(trader.username)}`}>{trader.username}</Link> · {trader.distinct_assets} stocks · {compactMoney(trader.volume_cash)} · {timeAgo(trader.latest_trade_at, now)}
          </span>
          <span className={styles.v}>{trader.trade_count}</span>
        </div>
      ))}
    </section>
  );
}

function LastTick() {
  const adjustments = useHubStore((state) => state.adjustments);
  const bySymbol = useAssetMap();
  const last = adjustments?.last_tick;
  const moves = useMemo(() => {
    if (!adjustments || !last) return [];
    return adjustments.feed.filter((item) => item.interval_key === last.interval_key && (!item.market_date || !last.market_date || item.market_date === last.market_date) && item.move_pct !== null);
  }, [adjustments, last]);
  if (!last || !moves.length) return null;
  const up = [...moves].filter((item) => (item.move_pct ?? 0) > 0).sort((a, b) => (b.move_pct ?? 0) - (a.move_pct ?? 0));
  const down = [...moves].filter((item) => (item.move_pct ?? 0) < 0).sort((a, b) => (a.move_pct ?? 0) - (b.move_pct ?? 0));
  const label = TICKS.find((tick) => tick.key === last.interval_key)?.label ?? last.interval_key;
  const col = (items: typeof moves, tone: "up" | "down") =>
    items.slice(0, 5).map((item) => (
      <Link key={`${item.symbol}-${tone}`} href={`/stocks/${encodeURIComponent(item.symbol)}`} className={styles.adjr} data-peek-stock={item.symbol}>
        <Oshimark icon={bySymbol.get(item.symbol.toUpperCase())?.icon ?? item.icon} symbol={item.symbol} size={17} />
        <span>
          {item.symbol}
          <small>{num(item.price_after)}</small>
        </span>
        <b className={ui[tone]}>{signedPct(item.move_pct)}</b>
      </Link>
    ));
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Last tick</h2>
        <span className={ui.aside} suppressHydrationWarning>
          {label.toUpperCase()} · {last.applied_at ? `${etClock(last.applied_at)} ET` : ""} · {last.applied_count ?? moves.length} moves
        </span>
      </div>
      <div className={styles.adjf}>
        <div>
          <h4>
            <span className={ui.up}>UPWARD</span>
            <span>{up.length}</span>
          </h4>
          {col(up, "up")}
        </div>
        <div>
          <h4>
            <span className={ui.down}>DOWNWARD</span>
            <span>{down.length}</span>
          </h4>
          {col(down, "down")}
        </div>
      </div>
    </section>
  );
}

// ── 24h boards + heartbeat ───────────────────────────────────────────────
function Boards() {
  const assets = useMarketStore((state) => state.assets);
  const hub = useHubStore((state) => state.hub);
  const volumeWinners = hub?.leaders.volume_winners ?? [];
  const bySymbol = useAssetMap();
  const withMove = assets.filter((asset) => asset.move_24h_pct !== null);
  const board = (title: string, hint: string, rows: React.ReactNode) => (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>{title}</h2>
        <span className={ui.aside}>{hint}</span>
      </div>
      {rows}
    </section>
  );
  return (
    <div className={styles.boards}>
      {board(
        "Fastest movers",
        "biggest 24h gain",
        [...withMove].sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0)).slice(0, 5).map((asset) => <RankRow key={asset.symbol} symbol={asset.symbol} icon={asset.icon} detail={asset.display_name} tone="up" value={signedPct(asset.move_24h_pct)} />),
      )}
      {board(
        "Pressure board",
        "heaviest 24h pressure",
        [...withMove].sort((a, b) => (a.move_24h_pct ?? 0) - (b.move_24h_pct ?? 0)).slice(0, 5).map((asset) => <RankRow key={asset.symbol} symbol={asset.symbol} icon={asset.icon} detail={asset.display_name} tone="down" value={signedPct(asset.move_24h_pct)} />),
      )}
      {board(
        "Flow leaders",
        "24h share volume",
        [...assets].sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0)).slice(0, 5).map((asset) => <RankRow key={asset.symbol} symbol={asset.symbol} icon={asset.icon} detail={asset.display_name} value={`${(asset.volume_24h ?? 0).toLocaleString("en-US")} sh`} />),
      )}
      {board(
        "Volume momentum",
        "flow acceleration",
        volumeWinners.length ? (
          volumeWinners.slice(0, 5).map((row) => (
            <RankRow
              key={row.symbol}
              symbol={row.symbol}
              icon={bySymbol.get(row.symbol.toUpperCase())?.icon}
              detail={`${row.volume_shares.toLocaleString("en-US")} sh`}
              tone={toneClass(row.volume_change_pct)}
              value={signedPct(row.volume_change_pct)}
            />
          ))
        ) : (
          <p className={ui.empty}>No momentum leaders yet.</p>
        ),
      )}
    </div>
  );
}

const ZONES: Array<[string, string]> = [
  ["NEW YORK", MARKET_TIME_ZONE],
  ["US WEST", "America/Los_Angeles"],
  ["JAPAN", "Asia/Tokyo"],
  ["INDONESIA", "Asia/Jakarta"],
  ["AUSTRIA", "Europe/Vienna"],
  ["AUSTRALIA", "Australia/Sydney"],
  ["UK", "Europe/London"],
];

function zoneParts(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { h: get("hour") % 24, m: get("minute"), s: get("second") };
}

function Clock({ now, zone, label, big }: { now: number; zone: string; label: string; big: boolean }) {
  const { h, m, s } = zoneParts(now, zone);
  const ha = ((h % 12) + m / 60) * 30;
  const ma = (m + s / 60) * 6;
  return (
    <div className={`${styles.clk} ${big ? styles.clkBig : ""}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18.5" className={styles.face} />
        {[0, 90, 180, 270].map((angle) => (
          <line key={angle} x1="20" y1="3.5" x2="20" y2="6.5" className={styles.mark} transform={`rotate(${angle} 20 20)`} />
        ))}
        {big ? [90, 270].map((angle) => <circle key={angle} cx="20" cy="4.8" r="1.3" className={styles.tickDot} transform={`rotate(${angle} 20 20)`} />) : null}
        <line x1="20" y1="20" x2="20" y2="10" className={styles.hour} transform={`rotate(${ha} 20 20)`} />
        <line x1="20" y1="20" x2="20" y2="6" className={styles.min} transform={`rotate(${ma} 20 20)`} />
        <line x1="20" y1="22" x2="20" y2="5" className={styles.sec} transform={`rotate(${s * 6} 20 20)`} />
        <circle cx="20" cy="20" r="1.4" className={styles.tickDot} />
      </svg>
      <b>
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
      </b>
      <span>{label}</span>
    </div>
  );
}

function Heartbeat() {
  const now = useNow();
  const status = useHubStore((state) => state.hub?.status ?? null);
  const report = useMarketStore((state) => state.report);
  const open = status?.is_trading_open ?? true;
  const settleAt = status?.next_scheduled_settlement_at ? new Date(status.next_scheduled_settlement_at) : null;
  return (
    <div className={styles.heart}>
      <div className={styles.hst} suppressHydrationWarning>
        <div>
          <span>STATUS</span>
          <b className={open ? ui.up : ui.down}>{open ? "OPEN" : (status?.trading_status ?? "closed").toUpperCase()}</b>
          <em>{status?.trading_message || "Trading session operating normally."}</em>
        </div>
        <div>
          <span>NEXT SETTLEMENT</span>
          <b>{settleAt ? `${settleAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: MARKET_TIME_ZONE }).toUpperCase()} · ${formatEtTime(settleAt)} ET` : "09:00 ET"}</b>
          <em>{settleAt && now ? `in ${formatCountdown(Math.max(0, (settleAt.getTime() - now) / 1000))}` : "daily"}</em>
        </div>
        <div>
          <span>DAILY REPORT</span>
          <Link href="/market/report">
            <b>{report?.market_date?.slice(0, 10) ?? "—"}</b>
          </Link>
          <em>latest settlement summary</em>
        </div>
      </div>
      <div className={styles.clocks} suppressHydrationWarning>
        {now ? ZONES.map(([label, zone], index) => <Clock key={zone} now={now} zone={zone} label={label} big={index === 0} />) : null}
      </div>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────
export function ActivityTab({ initialSymbol = "" }: { initialSymbol?: string }) {
  const trades = useHubStore((state) => state.trades);
  return (
    <>
      <div className={styles.act}>
        <div className={styles.main}>
          <Kpis trades={trades} />
          <Queue />
          <Tape initialTicker={initialSymbol} />
        </div>
        <aside className={styles.side}>
          <PendingOrders />
          <LiveRead trades={trades} />
          <HotSymbols trades={trades} />
          <NetFlow trades={trades} />
          <BiggestFills trades={trades} />
          <ActiveTraders />
          <LastTick />
        </aside>
      </div>
      <Boards />
      <Heartbeat />
      <p className={ui.foot}>
        Orders fill in 10-minute batches. Queued orders show as pressure on each stock until the batch executes them. Every fill nudges the price, and part of that push fades over the
        next hour.
      </p>
    </>
  );
}
