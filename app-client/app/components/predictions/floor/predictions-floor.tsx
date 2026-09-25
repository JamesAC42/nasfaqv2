"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiSearch, FiX } from "react-icons/fi";
import { PredictionsFrame } from "@/app/components/predictions/shell/predictions-frame";
import { Forecasters, HowItWorks, MyBetsSummary } from "@/app/components/predictions/floor/floor-side";
import { LiveTape, type TapeItem } from "@/app/components/predictions/floor/live-tape";
import { MarketCard, type Flash } from "@/app/components/predictions/floor/market-card";
import { applyFill } from "@/app/components/predictions/floor/market-live";
import { fetchCategories, fetchFloor, fetchForecasters, fetchPortfolio, fetchTape } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { compactMoney, outcomeColor } from "@/app/lib/predictions/format";
import type { Category, Fill, FloorTab, Forecaster, Portfolio, PredictionMarket, SocketMessage, Trade } from "@/app/lib/predictions/types";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/floor/floor.module.scss";

const TABS: { key: FloorTab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "closing", label: "Closing soon" },
  { key: "auto", label: "Auto" },
  { key: "events", label: "Events" },
  { key: "resolving", label: "Resolving" },
  { key: "resolved", label: "Resolved" },
];

const EMPTY_COPY: Record<FloorTab, string> = {
  live: "Nothing's trading right now. The next tick opens a fresh batch.",
  closing: "Nothing closes in the next few hours.",
  auto: "No auto markets open. They start right after each tick.",
  events: "No event markets live. Got an idea? Pitch it.",
  resolving: "No calls pending. Everything's settled.",
  resolved: "Nothing's settled yet.",
};

const PAGE_SIZE = 30;
const TAPE_SIZE = 30;
const EMPTY_FLASH: Record<string, Flash> = {};

const isTab = (value: string | null): value is FloorTab => TABS.some((tab) => tab.key === value);

/** Colour for a tape outcome: from the listed market when we have it, else by code. */
function tapeColor(market: PredictionMarket | undefined, code: string) {
  const outcome = market?.outcomes.find((row) => row.outcome_code === code);
  if (market && outcome) return outcomeColor(market, outcome);
  if (code === "yes" || code === "no") return outcomeColor({ market_type: "binary" }, { outcome_code: code, asset: null, sort_order: 0 });
  const index = Number(code.replace(/^o/, "")) - 1;
  return outcomeColor({ market_type: "multi" }, { outcome_code: code, asset: null, sort_order: Number.isFinite(index) ? index : 0 });
}

const humanize = (slug: string) => slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function PredictionsFloor() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { user } = useAuth();
  const username = user?.username ?? null;

  const [tab, setTab] = useState<FloorTab>(() => (isTab(search.get("tab")) ? (search.get("tab") as FloorTab) : "live"));
  const [category, setCategory] = useState<string>(() => search.get("cat") ?? "");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(1);

  const [markets, setMarkets] = useState<PredictionMarket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flashes, setFlashes] = useState<Record<string, Record<string, Flash>>>({});

  const [categories, setCategories] = useState<Category[]>([]);
  const [tape, setTape] = useState<Omit<TapeItem, "color">[] | null>(null);
  const [forecasters, setForecasters] = useState<Forecaster[] | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null | undefined>(undefined);
  const [live, setLive] = useState<{ count: number; volume: number } | null>(null);

  // Everything we know about markets (any tab, plus the tape), for titles and colours on the tape.
  const known = useRef(new Map<string, { title: string; market?: PredictionMarket }>());
  const request = useRef(0);
  const flashCounter = useRef(0);

  // ── Loading ─────────────────────────────────────────────────────────────
  const loadMarkets = useCallback(
    async (quiet = false) => {
      const id = ++request.current;
      if (!quiet) setLoading(true);
      try {
        const result = await fetchFloor({ tab, category: category || undefined, q: q || undefined, limit: PAGE_SIZE * pages });
        if (id !== request.current) return;
        for (const market of result.items) known.current.set(market.slug, { title: market.title, market });
        setMarkets(result.items);
        setTotal(result.pagination.total);
        setError(null);
      } catch (err) {
        if (id !== request.current) return;
        setError(predictionErrorText(err));
        if (!quiet) setMarkets([]);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [tab, category, q, pages],
  );

  const loadLive = useCallback(async () => {
    try {
      const result = await fetchFloor({ tab: "live", limit: 100 });
      for (const market of result.items) if (!known.current.get(market.slug)?.market) known.current.set(market.slug, { title: market.title, market });
      setLive({ count: result.pagination.total, volume: result.items.reduce((sum, market) => sum + market.volume_24h, 0) });
    } catch {
      // The blurb just keeps its last numbers.
    }
  }, []);

  const loadSide = useCallback(async () => {
    fetchForecasters(8)
      .then((result) => setForecasters(result.forecasters))
      .catch(() => setForecasters((rows) => rows ?? []));
    if (username) {
      fetchPortfolio()
        .then(setPortfolio)
        .catch(() => setPortfolio((current) => current ?? null));
    } else setPortfolio(undefined);
  }, [username]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    void loadLive();
    fetchCategories()
      .then((result) => setCategories(result.categories))
      .catch(() => {});
    fetchTape(TAPE_SIZE)
      .then((result) => {
        for (const trade of result.trades) if (!known.current.has(trade.slug)) known.current.set(trade.slug, { title: trade.market_title });
        setTape(
          result.trades.map((trade: Trade) => ({
            key: `t${trade.id}`,
            slug: trade.slug,
            title: trade.market_title,
            outcome_label: trade.outcome_label,
            outcome_code: trade.outcome_code,
            side: trade.side,
            cash: trade.cash,
            avg_price: trade.avg_price,
            username: trade.username,
            at: trade.at,
          })),
        );
      })
      .catch(() => setTape([]));
  }, [loadLive]);

  useEffect(() => {
    void loadSide();
  }, [loadSide]);

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(query.trim());
      setPages(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Keep the tab and category in the URL so the floor can be linked.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "live") params.set("tab", tab);
    if (category) params.set("cat", category);
    const next = params.toString() ? `${pathname}?${params}` : pathname;
    router.replace(next, { scroll: false });
    // Router identity isn't stable across renders in every Next version; the URL only follows state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category, pathname]);

  // ── Live ────────────────────────────────────────────────────────────────
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void loadMarkets(true);
      void loadLive();
      void loadSide();
    }, 700);
  }, [loadMarkets, loadLive, loadSide]);
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  const mineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTrade = useCallback(
    (fill: Fill) => {
      const entry = known.current.get(fill.slug);
      const market = entry?.market ? applyFill(entry.market, fill) : undefined;
      if (market) known.current.set(fill.slug, { title: market.title, market });

      // Flash whichever prices moved a whole cent (compared against our last known state).
      const before = entry?.market;
      if (before && market) {
        const moved: Record<string, Flash> = {};
        for (const outcome of market.outcomes) {
          const old = before.outcomes.find((row) => row.id === outcome.id);
          if (!old || Math.round(old.price * 100) === Math.round(outcome.price * 100)) continue;
          moved[String(outcome.id)] = { dir: outcome.price > old.price ? "up" : "down", n: ++flashCounter.current };
        }
        if (Object.keys(moved).length) setFlashes((current) => ({ ...current, [String(fill.market_id)]: { ...current[String(fill.market_id)], ...moved } }));
      }

      setMarkets((rows) => {
        if (!rows) return rows;
        const index = rows.findIndex((row) => String(row.id) === String(fill.market_id));
        if (index < 0) return rows;
        const next = rows.slice();
        next[index] = applyFill(rows[index], fill);
        return next;
      });

      setLive((current) => (current ? { ...current, volume: current.volume + fill.cash } : current));

      setTape((items) => {
        const item: Omit<TapeItem, "color"> = {
          key: `f${fill.market_id}-${fill.at}-${fill.outcome_code}-${fill.cash}-${fill.limit_order_id ?? ""}`,
          slug: fill.slug,
          title: entry?.title ?? humanize(fill.slug),
          outcome_label: fill.outcome_label,
          outcome_code: fill.outcome_code,
          side: fill.side,
          cash: fill.cash,
          avg_price: fill.avg_price,
          username: fill.username ?? null,
          at: fill.at,
          fresh: true,
        };
        const rest = (items ?? []).filter((row) => row.key !== item.key).map((row) => (row.fresh ? { ...row, fresh: false } : row));
        return [item, ...rest].slice(0, TAPE_SIZE);
      });

      // Your own trade (or one of your limit orders) changes your bets summary.
      const mine = (username && fill.username === username) || (fill.limit_order_id && portfolio?.orders.some((order) => String(order.id) === String(fill.limit_order_id)));
      if (mine) {
        if (mineTimer.current) clearTimeout(mineTimer.current);
        mineTimer.current = setTimeout(() => {
          fetchPortfolio()
            .then(setPortfolio)
            .catch(() => {});
        }, 800);
      }
    },
    [portfolio, username],
  );

  usePredictionFeed((message: SocketMessage) => {
    if (message.type === "prediction.trade") onTrade(message.trade);
    else if (message.type === "prediction.market.updated") scheduleRefetch();
  });

  // ── Derived ─────────────────────────────────────────────────────────────
  // Colours resolve late: the tape can arrive before the markets it mentions.
  const tapeItems = useMemo(
    () => tape?.map((item) => ({ ...item, color: tapeColor(known.current.get(item.slug)?.market, item.outcome_code) })) ?? null,
    // `markets` and `live` refresh what `known` holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tape, markets, live],
  );
  const hasMore = markets !== null && markets.length < total;
  const blurb = useMemo(() => {
    if (!live) return "Prices are chances. Right calls pay $1 a share.";
    return (
      <>
        <b>{live.count}</b> {live.count === 1 ? "market" : "markets"} live · <b>{compactMoney(live.volume)}</b> traded in the last 24 h. Prices are chances; right calls pay $1 a share.
      </>
    );
  }, [live]);

  const selectTab = (next: FloorTab) => {
    if (next === tab) return;
    setTab(next);
    setPages(1);
    setFlashes({});
  };

  return (
    <PredictionsFrame kicker="Live floor" title="Predictions" blurb={blurb} live>
      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.controls}>
            <div className={styles.tabs} role="tablist" aria-label="Markets">
              {TABS.map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => selectTab(item.key)}>
                  {item.label}
                  {tab === item.key && markets !== null && !loading ? <small>{total}</small> : null}
                </button>
              ))}
            </div>
            <div className={styles.filters}>
              <div className={styles.chips} role="group" aria-label="Category">
                <button type="button" className={styles.chip} aria-pressed={!category} onClick={() => (setCategory(""), setPages(1))}>
                  All
                </button>
                {categories.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    className={styles.chip}
                    aria-pressed={category === item.slug}
                    title={item.description ?? undefined}
                    onClick={() => (setCategory(category === item.slug ? "" : item.slug), setPages(1))}
                  >
                    {item.display_name}
                  </button>
                ))}
              </div>
              <label className={styles.search}>
                <FiSearch aria-hidden="true" />
                <input type="search" value={query} placeholder="Search markets" aria-label="Search markets" onChange={(event) => setQuery(event.target.value)} />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                    <FiX aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            </div>
          </div>

          {error && markets?.length ? <p className={styles.error}>{error}</p> : null}

          {markets === null || (loading && !markets.length) ? (
            <div className={styles.grid} aria-busy="true">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className={`${styles.card} ${styles.skeleton}`} />
              ))}
            </div>
          ) : markets.length ? (
            <div className={styles.grid} data-loading={loading || undefined}>
              {markets.map((market) => (
                <MarketCard key={market.id} market={market} flashes={flashes[String(market.id)] ?? EMPTY_FLASH} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>{error ?? (q || category ? "No markets match that." : EMPTY_COPY[tab])}</p>
          )}

          {hasMore ? (
            <button type="button" className={styles.loadMore} onClick={() => setPages((value) => value + 1)} disabled={loading}>
              {loading ? "Loading…" : `Show more · ${total - (markets?.length ?? 0)} left`}
            </button>
          ) : null}
        </div>

        <aside className={styles.side} aria-label="Floor activity">
          <LiveTape items={tapeItems} loading={tape === null} />
          <MyBetsSummary signedIn={Boolean(user)} portfolio={portfolio} />
          <Forecasters rows={forecasters} />
          <HowItWorks />
        </aside>
      </div>
    </PredictionsFrame>
  );
}
