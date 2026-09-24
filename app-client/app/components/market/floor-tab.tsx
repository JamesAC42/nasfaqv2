"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { StockChip } from "@/app/components/common/stock-chip";
import { compactMoney, num, toneClass, useAssetMap } from "@/app/components/market/bits";
import { formatCountdown, formatEtTime, getMarketClock, TICKS } from "@/app/lib/market-clock";
import { groupByUnit, unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, timeAgo } from "@/app/lib/time";
import type { MarketAsset, MarketHubTrade } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { threadLines, useThreadPosts } from "@/app/lib/use-thread";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useHubStore } from "@/app/stores/hub-store";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useNewsStore } from "@/app/stores/news-store";
import { useProfileStore } from "@/app/stores/profile-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/floor-tab.module.scss";

const WHALE_CASH = 1000;

function priceSeries(asset: MarketAsset | undefined) {
  return (asset?.sparkline_candles ?? []).map((candle) => candle.close).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

// ── Left column ──────────────────────────────────────────────────────────
function YourBook() {
  const { user, isLoading } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const bySymbol = useAssetMap();

  useEffect(() => {
    if (user) void fetchPortfolio();
  }, [fetchPortfolio, user]);

  const holdings = useMemo(() => {
    return (portfolio?.holdings ?? [])
      .filter((holding) => holding.quantity > 0)
      .map((holding) => {
        const asset = bySymbol.get(holding.symbol.toUpperCase());
        const mid = asset?.current_mid_price ?? holding.current_mid_price ?? 0;
        const open = asset?.previous_settlement_mid_price ?? mid;
        return { holding, asset, mid, value: holding.quantity * mid, day: holding.quantity * (mid - open), pl: holding.avg_cost_basis ? (mid - holding.avg_cost_basis) / holding.avg_cost_basis : null };
      })
      .sort((a, b) => b.value - a.value);
  }, [bySymbol, portfolio]);

  if (!user) {
    return (
      <section className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Your book</h2>
        </div>
        <p className={ui.note}>{isLoading ? "Checking your desk…" : "Sign in to track your bags, net worth and today's P/L here."}</p>
        {!isLoading ? (
          <div className={styles.bookCta}>
            <Link href="/register" className={styles.primary}>Start trading</Link>
            <Link href="/login" className={styles.ghost}>Sign in</Link>
          </div>
        ) : null}
      </section>
    );
  }

  const cash = portfolio?.cash_balance ?? 0;
  const equity = cash + holdings.reduce((sum, row) => sum + row.value, 0);
  const day = holdings.reduce((sum, row) => sum + row.day, 0);
  const dayPct = equity - day > 0 ? day / (equity - day) : null;

  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Your book</h2>
        <Link href="/profile" className={ui.aside}>profile →</Link>
      </div>
      <div className={styles.bookTotal}>{portfolio ? money(equity) : "—"}</div>
      <div className={styles.bookSub}>
        <span className={ui[toneClass(day)]}>
          {day >= 0 ? "+" : ""}
          {money(day)} ({signedPct(dayPct)}) today
        </span>
        <span className={ui.flat}>cash {money(cash)}</span>
      </div>
      <div className={styles.rows}>
        {holdings.length ? (
          holdings.map(({ holding, asset, mid, pl }) => (
            <Link key={holding.symbol} href={`/stocks/${encodeURIComponent(holding.symbol)}`} className={styles.row} data-peek-stock={holding.symbol} prefetch={false}>
              <span className={styles.sym}>
                <Oshimark icon={asset?.icon} symbol={holding.symbol} size={16} />
                {holding.symbol}
              </span>
              <span className={styles.meta}>
                {holding.quantity.toLocaleString("en-US")} sh · avg {num(holding.avg_cost_basis)}
              </span>
              <span className={styles.px}>{num(mid)}</span>
              <span className={`${styles.chg} ${ui[toneClass(pl)]}`}>{signedPct(pl)}</span>
            </Link>
          ))
        ) : (
          <p className={ui.empty}>No bags yet. Pick a talent from the board.</p>
        )}
      </div>
    </section>
  );
}

function Movers({ assets }: { assets: MarketAsset[] }) {
  const movers = useMemo(
    () => [...assets].filter((asset) => asset.move_24h_pct !== null).sort((a, b) => Math.abs(b.move_24h_pct ?? 0) - Math.abs(a.move_24h_pct ?? 0)).slice(0, 8),
    [assets],
  );
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Moving most</h2>
        <span className={ui.aside}>price, 15d</span>
      </div>
      <div className={styles.rows}>
        {movers.map((asset) => {
          const series = priceSeries(asset);
          const tone = toneClass(asset.move_24h_pct);
          return (
            <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={`${styles.row} ${styles.rowSpark}`} data-peek-stock={asset.symbol} prefetch={false}>
              <span className={styles.sym}>
                <Oshimark icon={asset.icon} symbol={asset.symbol} size={16} />
                {asset.symbol}
              </span>
              <Sparkline values={series} tone={tone === "down" ? "down" : "up"} width={100} height={18} className={styles.spark} />
              <span className={styles.px}>{num(asset.current_mid_price)}</span>
              <span className={`${styles.chg} ${ui[tone]}`}>{signedPct(asset.move_24h_pct)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Center column ────────────────────────────────────────────────────────
function Breaking() {
  const items = useNewsStore((state) => state.items);
  const fetchNews = useNewsStore((state) => state.fetchNews);
  const { calm } = useMotion();
  const [index, setIndex] = useState(0);
  const [swap, setSwap] = useState(0);
  const moving = useMemo(() => items.filter((item) => item.stock_symbols?.length).slice(0, 6), [items]);

  useEffect(() => {
    void fetchNews();
  }, [fetchNews]);

  useEffect(() => {
    if (calm || moving.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % moving.length);
      setSwap((current) => current + 1);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [calm, moving.length]);

  if (!moving.length) return null;
  const item = moving[index % moving.length];
  const next = () => {
    setIndex((current) => (current + 1) % moving.length);
    setSwap((current) => current + 1);
  };

  return (
    <div className={styles.breaking}>
      <div className={styles.brkTag}>
        HOLONEWS
        <small>MARKET-MOVING</small>
      </div>
      <div className={styles.brkBody}>
        <button type="button" className={styles.brkNav} onClick={next} aria-label="Next headline">
          {(index % moving.length) + 1}/{moving.length}
        </button>
        <Link key={swap} href={item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : "/articles?type=news"} className={styles.brkHl}>
          {item.headline}
        </Link>
        <div className={styles.impacts}>
          {(item.stock_symbols ?? []).slice(0, 5).map((symbol) => (
            <StockChip key={symbol} symbol={symbol} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Spot({ assets }: { assets: MarketAsset[] }) {
  const { theme } = useTheme();
  const ranked = useMemo(() => [...assets].filter((asset) => asset.move_24h_pct !== null).sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0)), [assets]);
  if (ranked.length < 2) return null;
  const cards: Array<{ asset: MarketAsset; kind: "up" | "down" }> = [
    { asset: ranked[0], kind: "up" },
    { asset: ranked[ranked.length - 1], kind: "down" },
  ];
  return (
    <div className={styles.spot}>
      {cards.map(({ asset, kind }) => {
        const accent = talentAccent(asset.color, theme);
        return (
          <Link key={kind} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.spotCard} style={{ "--tal": accent } as React.CSSProperties} prefetch={false}>
            <div className={styles.spotText}>
              <div className={`${styles.spotKicker} ${ui[kind]}`}>{kind === "up" ? "MOONING" : "BLEEDING"}</div>
              <div className={styles.spotSym}>
                <Oshimark icon={asset.icon} symbol={asset.symbol} size={30} />
                {asset.symbol}
              </div>
              <div className={styles.spotName}>
                {asset.display_name} · {unitLabel(asset.unit)}
              </div>
              <div className={`${styles.spotMove} ${ui[kind]}`}>
                {kind === "up" ? "▲" : "▼"} {signedPct(asset.move_24h_pct)} <span className={ui.flat}>{num(asset.current_mid_price)}</span>
              </div>
              <div className={styles.spotLine}>{kind === "up" ? "Top gainer since settlement. The thread is calling it a breakout." : "Worst on the board today. Cope levels are rising in the thread."}</div>
            </div>
            <ArtSlot kind="chibi" pose={kind === "up" ? "hype" : "cope"} symbol={asset.symbol} icon={asset.icon} accent={accent} width={200} className={styles.spotArt} />
          </Link>
        );
      })}
    </div>
  );
}

function tileBg(move: number | null) {
  if (move === null || Math.abs(move) < 0.0005) return "var(--ink-3)";
  const t = Math.max(-1, Math.min(1, move / 0.05));
  const alpha = ((0.1 + Math.abs(t) * 0.62) * 0.55).toFixed(3);
  return t > 0 ? `rgba(46, 227, 142, ${alpha})` : `rgba(255, 68, 96, ${alpha})`;
}

const Tile = memo(function Tile({ asset, calm }: { asset: MarketAsset; calm: boolean }) {
  const mid = asset.current_mid_price;
  const previous = useRef(mid);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = mid;
    if (calm || before === null || mid === null || before === mid) return;
    setFlash(mid > before ? "up" : "down");
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [calm, mid]);

  const move = asset.move_24h_pct;
  return (
    <Link
      href={`/stocks/${encodeURIComponent(asset.symbol)}`}
      className={`${styles.tile} ${flash === "up" ? styles.flashUp : flash === "down" ? styles.flashDown : ""}`}
      style={{ "--bg": tileBg(move) } as React.CSSProperties}
      data-peek-stock={asset.symbol}
      prefetch={false}
      aria-label={`${asset.display_name} ${num(mid)} ${signedPct(move)}`}
    >
      <span className={styles.tSym}>
        {asset.symbol}
        <Oshimark icon={asset.icon} symbol={asset.symbol} size={16} />
      </span>
      <span className={styles.tPx}>{num(mid)}</span>
      <span className={`${styles.tChg} ${ui[toneClass(move)]}`}>{signedPct(move)}</span>
    </Link>
  );
});

function Board({ assets }: { assets: MarketAsset[] }) {
  const { calm } = useMotion();
  const groups = useMemo(() => groupByUnit(assets), [assets]);
  const up = assets.filter((asset) => (asset.move_24h_pct ?? 0) > 0.00005).length;
  const down = assets.filter((asset) => (asset.move_24h_pct ?? 0) < -0.00005).length;
  return (
    <section className={styles.board}>
      <div className={ui.secHead}>
        <h2>The board</h2>
        <div className={styles.legend}>
          <span>-5%</span>
          <span className={styles.ramp} />
          <span>+5%</span>
          <span>
            {up} up · {down} down · {assets.length} listed
          </span>
        </div>
      </div>
      <div className={styles.groups}>
        {groups.map((group) => {
          const moves = group.assets.map((asset) => asset.move_24h_pct ?? 0);
          const avg = moves.reduce((sum, value) => sum + value, 0) / Math.max(1, moves.length);
          return (
            <div key={group.unit}>
              <div className={styles.grpHead}>
                <Link href={`/market/indexes?index=${encodeURIComponent(group.unit)}`}>{unitLabel(group.unit)}</Link>
                <span className={ui[toneClass(avg)]}>{signedPct(avg)}</span>
              </div>
              <div className={styles.tiles}>
                {group.assets.map((asset) => (
                  <Tile key={asset.symbol} asset={asset} calm={calm} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Right column ─────────────────────────────────────────────────────────
function Bell() {
  const now = useNow();
  const portfolio = useProfileStore((state) => state.portfolio);
  const clock = now ? getMarketClock(now) : null;
  const exposure = portfolio?.total_market_value ?? null;
  const bags = (portfolio?.holdings ?? []).filter((holding) => holding.quantity > 0).length;

  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>The bell</h2>
        <span className={ui.aside}>4 ticks a day</span>
      </div>
      <div className={styles.bellTop} suppressHydrationWarning>
        <div>
          <div className={styles.bellName}>{clock ? clock.nextTick.label.toUpperCase() : "—"}</div>
          <div className={styles.bellCount}>{clock ? formatCountdown(clock.secondsToNextTick) : "--:--:--"}</div>
        </div>
        <ArtSlot kind="chibi" pose="idle" symbol="BELL" accent="var(--blue)" width={92} className={styles.bellArt} />
      </div>
      <p className={styles.bellNote}>
        Every stock reprices on the tick. How hard is secret until it lands.
        {exposure !== null && bags ? (
          <b>
            {" "}
            You carry {money(exposure)} across {bags} stocks into {clock?.nextTick.label ?? "it"}.
          </b>
        ) : null}
      </p>
      <div className={styles.day} suppressHydrationWarning>
        <div className={styles.prog} style={{ width: `calc((100% - 12px) * ${((clock?.dayProgress ?? 0) * 0.75).toFixed(3)})` }} />
        {TICKS.map((tick, index) => {
          const done = clock ? index < clock.ticksLanded && clock.nextTickIndex !== index : false;
          const next = clock?.nextTickIndex === index;
          return (
            <div key={tick.key} className={`${styles.node} ${done ? styles.done : ""} ${next ? styles.next : ""}`}>
              <div className={styles.pip} />
              <b>{tick.label.toUpperCase()}</b>
              <span>{String(tick.hour).padStart(2, "0")}:00</span>
            </div>
          );
        })}
      </div>
      <div className={styles.batch} suppressHydrationWarning>
        <span>
          ORDER BATCH <b>{clock ? `${formatEtTime(clock.nextBatchAt)} ET` : "--:--"}</b>
        </span>
        <span className={styles.batchCount}>in {clock ? formatCountdown(clock.secondsToNextBatch, { withHours: false }) : "--:--"}</span>
      </div>
    </section>
  );
}

function WhaleRow({ trade, icon }: { trade: MarketHubTrade; icon: string | null | undefined }) {
  const buy = trade.side.toLowerCase() === "buy";
  const now = Date.now();
  return (
    <div className={styles.feedItem}>
      <time suppressHydrationWarning>{timeAgo(trade.ts, now)}</time>
      <span>
        {trade.username ? (
          <Link href={`/profile/${encodeURIComponent(trade.username)}`} className={styles.who}>
            {trade.username}
          </Link>
        ) : (
          <span className={styles.who}>anon</span>
        )}{" "}
        <span className={buy ? ui.up : ui.down}>{buy ? "bought" : "sold"}</span>{" "}
        <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className={styles.whaleSym} data-peek-stock={trade.symbol}>
          <Oshimark icon={icon ?? trade.icon} symbol={trade.symbol} size={14} /> {trade.quantity.toLocaleString("en-US")} {trade.symbol}
        </Link>{" "}
        <span className={styles.whaleCash}>{compactMoney(trade.gross_cash)}</span>
      </span>
    </div>
  );
}

function WhaleWatch() {
  const trades = useHubStore((state) => state.trades);
  const bySymbol = useAssetMap();
  const whales = useMemo(() => trades.filter((trade) => trade.gross_cash >= WHALE_CASH).slice(0, 5), [trades]);
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Whale watch</h2>
        <Link href="/market/activity" className={ui.aside}>
          all activity →
        </Link>
      </div>
      {whales.length ? (
        whales.map((trade) => <WhaleRow key={trade.id} trade={trade} icon={bySymbol.get(trade.symbol.toUpperCase())?.icon} />)
      ) : (
        <p className={ui.empty}>No fills over $1k in the recent tape.</p>
      )}
    </section>
  );
}

function Thread() {
  const posts = useThreadPosts(4);
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>/vt/ general</h2>
        <Link href="/threads" className={ui.aside}>
          open thread ↗
        </Link>
      </div>
      {posts === null ? (
        <p className={ui.empty}>Loading the thread…</p>
      ) : posts.length ? (
        posts.map((post) => (
          <div key={post.post_id} className={styles.feedItem}>
            <time>No.{post.post_id}</time>
            <p className={styles.post}>
              {threadLines(post.text_content).map((line, index) => (
                <span key={index} className={line.green ? styles.greentext : undefined}>
                  {line.text}
                </span>
              ))}
            </p>
          </div>
        ))
      ) : (
        <p className={ui.empty}>The thread is quiet.</p>
      )}
    </section>
  );
}

function FloorTop() {
  const entries = useLeaderboardStore((state) => state.entries);
  const me = useLeaderboardStore((state) => state.me);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);
  useEffect(() => {
    void fetchLeaderboard({ limit: 5 });
  }, [fetchLeaderboard]);
  const top = entries.slice(0, 4);
  return (
    <section className={ui.sec}>
      <div className={ui.secHead}>
        <h2>Top of the floor</h2>
        <Link href="/leaderboard" className={ui.aside}>
          all →
        </Link>
      </div>
      {top.map((entry, index) => (
        <Link key={entry.user_id} href={`/profile/${encodeURIComponent(entry.username)}`} className={`${styles.lb} ${index === 0 ? styles.first : ""}`}>
          <span className={styles.rk}>{entry.rank}</span>
          <span className={styles.nm}>{entry.username}</span>
          <span className={styles.v}>{compactMoney(entry.total_equity)}</span>
        </Link>
      ))}
      {me && !top.some((entry) => entry.user_id === me.user_id) ? (
        <Link href="/profile" className={`${styles.lb} ${styles.me}`}>
          <span className={styles.rk}>{me.rank}</span>
          <span className={styles.nm}>
            <b>you</b>
          </span>
          <span className={styles.v}>{compactMoney(me.total_equity)}</span>
        </Link>
      ) : null}
      {!top.length ? <p className={ui.empty}>No rankings yet.</p> : null}
    </section>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────
export function FloorTab() {
  const assets = useMarketStore((state) => state.assets);
  return (
    <div className={styles.floor}>
      <aside className={styles.colL}>
        <YourBook />
        <Movers assets={assets} />
      </aside>
      <div className={styles.colC}>
        <Breaking />
        <Spot assets={assets} />
        <Board assets={assets} />
      </div>
      <aside className={styles.colR}>
        <Bell />
        <WhaleWatch />
        <Thread />
        <FloorTop />
      </aside>
    </div>
  );
}
