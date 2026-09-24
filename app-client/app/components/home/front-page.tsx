"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { StockChip } from "@/app/components/common/stock-chip";
import { SiteShell } from "@/app/components/layout/site-shell";
import { MARKET_TIME_ZONE } from "@/app/lib/market-clock";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { MarketAsset, NewsItem, ReportRow } from "@/app/lib/types";
import { useLocalFlag } from "@/app/lib/use-local-flag";
import { threadLines, useThreadPosts } from "@/app/lib/use-thread";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useOpenStream } from "@/app/stores/stream-store";
import { previewOf } from "@/app/lib/streams";
import { useMarketStore } from "@/app/stores/market-store";
import { markSeries, UNIT_ORDER, unitLabel, unitName } from "@/app/lib/market-units";
import { useNewsStore } from "@/app/stores/news-store";
import { usePredictionMarketStore } from "@/app/stores/prediction-market-store";
import styles from "@/app/components/home/front-page.module.scss";


function newsHref(item: NewsItem) {
  return item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : "/articles?type=news";
}

// ── Masthead ──────────────────────────────────────────────────────────────────
function Masthead({ assets }: { assets: MarketAsset[] }) {
  const marketStatus = useMarketStore((state) => state.marketStatus);

  const pulse = useMemo(() => {
    if (!assets.length) return null;
    const moves = assets.map((asset) => asset.move_24h_pct).filter((value): value is number => value !== null && Number.isFinite(value));
    const avgMove = moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : null;
    const up = moves.filter((value) => value > 0.00005).length;
    const down = moves.filter((value) => value < -0.00005).length;
    // Equal-weight fair value index over the sparkline window, rebased to 100.
    const series = assets.map(markSeries).filter((values) => values.length > 1);
    const length = Math.min(...series.map((values) => values.length));
    const index = Number.isFinite(length) && length > 1
      ? Array.from({ length }, (_, i) => (series.reduce((sum, values) => sum + values[values.length - length + i] / values[values.length - length], 0) / series.length) * 100)
      : [];
    const emission = assets.reduce((sum, asset) => sum + (asset.current_daily_emission ?? 0), 0);
    return { avgMove, up, down, index, emission };
  }, [assets]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: MARKET_TIME_ZONE,
  });
  const settled = marketStatus?.last_settlement_completed_at
    ? new Date(marketStatus.last_settlement_completed_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: MARKET_TIME_ZONE })
    : null;

  return (
    <header className={styles.masthead}>
      <div>
        <h1>
          Holo<span>News</span>
        </h1>
        <div className={styles.dateline} suppressHydrationWarning>
          <span>{today.toUpperCase()}</span>
          {settled ? <span>SETTLED {settled} ET</span> : null}
          <span>{assets.length || "—"} TALENTS LISTED</span>
        </div>
      </div>
      {pulse ? (
        <div className={styles.pulse}>
          <div>
            <span className={styles.label}>Market today</span>
            <span className={`${styles.big} ${styles[toneOf(pulse.avgMove)]}`}>{signedPct(pulse.avgMove)}</span>
            <span className={styles.sub}>equal-weight average</span>
          </div>
          {pulse.index.length > 1 ? (
            <div className={styles.pulseSpark}>
              <Sparkline values={pulse.index} tone={pulse.index[pulse.index.length - 1] >= pulse.index[0] ? "up" : "down"} width={120} height={36} fill dot />
              <span className={styles.sub}>settlement marks, {pulse.index.length}d</span>
            </div>
          ) : null}
          <div>
            <span className={styles.label}>Breadth</span>
            <span className={styles.big}>
              <span className={styles.up}>{pulse.up}</span>
              <span className={styles.flat}> / </span>
              <span className={styles.down}>{pulse.down}</span>
            </span>
            <span className={styles.sub}>up / down today</span>
          </div>
          <div>
            <span className={styles.label}>New shares today</span>
            <span className={styles.big}>{Math.round(pulse.emission).toLocaleString("en-US")}</span>
            <span className={styles.sub}>treasury emission</span>
          </div>
        </div>
      ) : null}
    </header>
  );
}

// ── Newbie strip ──────────────────────────────────────────────────────────────
function NewbieStrip() {
  const { user, isLoading } = useAuth();
  const [dismissed, setDismissed] = useLocalFlag("nasfaq.newbieDismissed");
  if (user || isLoading || dismissed) return null;
  return (
    <aside className={styles.newbie}>
      <p>
        <b>New here?</b> Everyone starts with $10,000 of play money. Every hololive talent is a stock, and prices follow their real YouTube
        growth plus what players buy and sell.
      </p>
      <div className={styles.newbieActions}>
        <Link href="/register" className={styles.newbiePrimary}>
          Start trading
        </Link>
        <Link href="/how-to-play" className={styles.newbieGhost}>
          How it works
        </Link>
        <button type="button" className={styles.newbieClose} aria-label="Dismiss" onClick={() => setDismissed(true)}>
          ✕
        </button>
      </div>
    </aside>
  );
}

// ── Front page news ──────────────────────────────────────────────────────────
function NewsThumb({ item, lead = false }: { item: NewsItem; lead?: boolean }) {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  const symbol = item.stock_symbols?.[0] ?? null;
  const asset = symbol ? assets.find((entry) => entry.symbol === symbol) : null;
  if (item.thumbnail_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.thumbnail_url} alt="" className={lead ? styles.leadImage : styles.headImage} loading={lead ? "eager" : "lazy"} decoding="async" />;
  }
  return (
    <ArtSlot
      kind="keyart"
      symbol={symbol ?? "NEWS"}
      icon={asset?.icon}
      accent={talentAccent(asset?.color, theme)}
      width={lead ? 640 : 96}
      className={lead ? styles.leadImage : styles.headImage}
    />
  );
}

function FrontNews({ items, isLoading }: { items: NewsItem[]; isLoading: boolean }) {
  const now = Date.now();
  if (!items.length) {
    return <section className={styles.front}>{isLoading ? <p className={styles.empty}>Loading HoloNews…</p> : <p className={styles.empty}>No headlines yet today.</p>}</section>;
  }
  const lead = items.find((item) => item.thumbnail_url) ?? items[0];
  const rest = items.filter((item) => item !== lead).slice(0, 5);
  return (
    <section className={styles.front} aria-label="Headlines">
      <article className={styles.lead}>
        <Link href={newsHref(lead)} className={styles.leadLink}>
          <NewsThumb item={lead} lead />
          <span className={styles.kicker} suppressHydrationWarning>
            LEAD STORY · {timeAgo(lead.published_at, now).toUpperCase()}
          </span>
          <h2>{lead.headline}</h2>
          {lead.summary ? <p>{lead.summary}</p> : null}
        </Link>
        {lead.stock_symbols?.length ? (
          <div>
            <div className={styles.label}>Market impact</div>
            <div className={styles.chips}>
              {lead.stock_symbols.slice(0, 6).map((symbol) => (
                <StockChip key={symbol} symbol={symbol} />
              ))}
            </div>
          </div>
        ) : null}
      </article>
      <div className={styles.heads}>
        {rest.map((item) => (
          <article key={item.id} className={styles.head}>
            <Link href={newsHref(item)} className={styles.headLink}>
              <NewsThumb item={item} />
              <div>
                <h3>{item.headline}</h3>
                <span className={styles.meta} suppressHydrationWarning>
                  {timeAgo(item.published_at, now)}
                </span>
              </div>
            </Link>
            {item.stock_symbols?.length ? (
              <div className={styles.chips}>
                {item.stock_symbols.slice(0, 4).map((symbol) => (
                  <StockChip key={symbol} symbol={symbol} />
                ))}
              </div>
            ) : null}
          </article>
        ))}
        <Link href="/articles?type=news" className={styles.more}>
          All headlines →
        </Link>
      </div>
    </section>
  );
}

// ── Settlement report ────────────────────────────────────────────────────────
type ReportLine = { symbol: string; left: string; right: string; tone: "up" | "down" | "flat" };

function ReportColumn({ title, tone, lines, note }: { title: string; tone?: "up" | "down"; lines: ReportLine[]; note: string }) {
  const assets = useMarketStore((state) => state.assets);
  const icons = useMemo(() => new Map(assets.map((asset) => [asset.symbol, asset.icon])), [assets]);
  return (
    <div className={styles.reportCol}>
      <h3 className={tone ? styles[tone] : undefined}>{title}</h3>
      {lines.length ? (
        lines.map((line) => (
          <Link key={line.symbol} href={`/stocks/${encodeURIComponent(line.symbol)}`} className={styles.rep} data-peek-stock={line.symbol} prefetch={false}>
            <Oshimark icon={icons.get(line.symbol)} symbol={line.symbol} size={20} />
            <b>{line.symbol}</b>
            <span className={styles.fromTo}>{line.left}</span>
            <span className={`${styles.repValue} ${styles[line.tone]}`}>{line.right}</span>
          </Link>
        ))
      ) : (
        <p className={styles.empty}>Nothing notable.</p>
      )}
      <p className={styles.note}>{note}</p>
    </div>
  );
}

function fmt2(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function fairLines(rows: ReportRow[] | undefined): ReportLine[] {
  return (rows ?? []).slice(0, 5).map((row) => {
    // The API withholds the % change; show the settled price against the new fair value instead.
    const gap = row.market_price && row.fair_value ? (row.fair_value - row.market_price) / row.market_price : null;
    return { symbol: row.symbol, left: `px ${fmt2(row.market_price)} · fair ${fmt2(row.fair_value)}`, right: signedPct(gap), tone: toneOf(gap) };
  });
}

function SettlementReport({ assets }: { assets: MarketAsset[] }) {
  const report = useMarketStore((state) => state.report);

  const gappers = useMemo<ReportLine[]>(() => {
    const rows = [...(report?.biggest_winners ?? []), ...(report?.biggest_losers ?? [])]
      .filter((row) => row.move_pct !== null && row.move_pct !== undefined)
      .sort((x, y) => Math.abs(y.move_pct ?? 0) - Math.abs(x.move_pct ?? 0));
    const seen = new Set<string>();
    return rows
      .filter((row) => (seen.has(row.symbol) ? false : (seen.add(row.symbol), true)))
      .slice(0, 5)
      .map((row) => ({ symbol: row.symbol, left: `opened ${fmt2(row.market_price)}`, right: signedPct(row.move_pct), tone: toneOf(row.move_pct) }));
  }, [report]);

  const dilution = useMemo<ReportLine[]>(() => {
    return (report?.notable_treasury_emissions ?? []).slice(0, 5).map((row) => {
      const premium = row.premium_pct ?? row.premium_discount_pct ?? (row.market_price && row.fair_value ? (row.market_price - row.fair_value) / row.fair_value : null);
      return { symbol: row.symbol, left: `premium ${signedPct(premium)}`, right: `${fmt2(row.emission)} sh`, tone: "flat" as const };
    });
  }, [report]);

  if (!report && !assets.length) return null;

  return (
    <section className={styles.block} aria-labelledby="report-title">
      <div className={styles.blockHead}>
        <h2 id="report-title">The Settlement Report</h2>
        <Link href="/market/report" className={styles.label}>
          {report?.market_date ? `${report.market_date.slice(0, 10)} · ` : ""}full report & history →
        </Link>
      </div>
      <div className={styles.report}>
        <ReportColumn title="Fair value up" tone="up" lines={fairLines(report?.biggest_fair_value_increases)} note="Views and subs picked up. The % is the gap from price to fair that the day's ticks work on." />
        <ReportColumn title="Fair value down" tone="down" lines={fairLines(report?.biggest_fair_value_decreases)} note="Stagnant channels and missed uploads get marked down." />
        <ReportColumn title="Dilution watch" lines={dilution} note="The treasury prints more shares of stocks trading above fair value." />
        <ReportColumn title="Gapped at the open" lines={gappers} note="Biggest price resets at settlement, either way. Not financial advice, anon." />
      </div>
    </section>
  );
}

// ── By unit ──────────────────────────────────────────────────────────────────
function UnitIndexes({ assets }: { assets: MarketAsset[] }) {
  const marketIndexes = useMarketStore((state) => state.marketIndexes);

  const units = useMemo(() => {
    const byUnit = new Map<string, MarketAsset[]>();
    for (const asset of assets) {
      const unit = unitName(asset.unit);
      if (!unit) continue;
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), asset]);
    }
    const bundles = new Map(marketIndexes.map((bundle) => [unitName(bundle.group), bundle]));
    const order = [...UNIT_ORDER, ...[...byUnit.keys()].filter((unit) => !UNIT_ORDER.includes(unit))];
    return order
      .filter((unit) => byUnit.has(unit))
      .map((unit) => {
        const members = byUnit.get(unit) ?? [];
        const bundle = bundles.get(unit);
        const series = (bundle?.series ?? []).map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value)).slice(-30);
        const moves = members.map((asset) => asset.move_24h_pct).filter((value): value is number => value !== null && Number.isFinite(value));
        const dayReturn = bundle?.summary?.day_return_pct ?? (moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : null);
        return { unit, members, series, value: bundle?.summary?.index_value ?? null, dayReturn };
      });
  }, [assets, marketIndexes]);

  if (!units.length) return null;

  return (
    <section className={styles.block} aria-labelledby="units-title">
      <div className={styles.blockHead}>
        <h2 id="units-title">By Unit</h2>
        <Link href="/market/indexes" className={styles.label}>
          All indexes →
        </Link>
      </div>
      <div className={styles.units}>
        {units.map((entry) => (
          <Link key={entry.unit} href={`/market/indexes?index=${encodeURIComponent(entry.unit)}`} className={styles.unit} prefetch={false}>
            <span className={styles.unitName}>{unitLabel(entry.unit)}</span>
            <span className={styles.unitMarks}>
              {entry.members.map((asset) => (
                <Oshimark key={asset.symbol} icon={asset.icon} symbol={asset.symbol} size={13} />
              ))}
            </span>
            {entry.series.length > 1 ? <Sparkline values={entry.series} tone={toneOf(entry.dayReturn) === "down" ? "down" : "up"} width={100} height={24} className={styles.unitSpark} /> : <span className={styles.unitSpark} />}
            <span className={styles.unitValue}>
              <span>{entry.value !== null ? entry.value.toFixed(1) : ""}</span>
              <span className={styles[toneOf(entry.dayReturn)]}>{signedPct(entry.dayReturn)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Community row ────────────────────────────────────────────────────────────
function OnAir() {
  const live = useLivestreamStore((state) => state.live);
  const openStream = useOpenStream();
  const items = live.slice(0, 5);
  return (
    <div className={styles.communityCol}>
      <div className={styles.colHead}>
        <h3>On air</h3>
        <Link href="/livestreams" className={styles.label}>
          All streams →
        </Link>
      </div>
      {items.length ? (
        items.map((item) => (
          <button key={item.id} type="button" onClick={() => openStream(previewOf(item))} className={styles.air}>
            <Oshimark icon={item.creator_icon} symbol={item.creator} size={26} />
            <span className={styles.airText}>
              <b>{item.creator}</b>
              <small>{item.title}</small>
            </span>
            <span className={styles.live}>{item.viewer_count !== null ? item.viewer_count.toLocaleString("en-US") : "LIVE"}</span>
          </button>
        ))
      ) : (
        <p className={styles.empty}>Nobody&apos;s live right now.</p>
      )}
    </div>
  );
}

function ThreadPulse() {
  const posts = useThreadPosts(4);

  return (
    <div className={styles.communityCol}>
      <div className={styles.colHead}>
        <h3>/vt/ is saying</h3>
        <Link href="/threads" className={styles.label}>
          Open thread →
        </Link>
      </div>
      {posts === null ? (
        <p className={styles.empty}>Loading the thread…</p>
      ) : posts.length ? (
        posts.map((post) => (
          <div key={post.post_id} className={styles.post}>
            <span className={styles.postNo}>No.{post.post_id}</span>
            <p>
              {threadLines(post.text_content).map((line, index) => (
                <span key={index} className={line.green ? styles.greentext : undefined}>
                  {line.text}
                </span>
              ))}
            </p>
          </div>
        ))
      ) : (
        <p className={styles.empty}>The thread is quiet.</p>
      )}
    </div>
  );
}

function PredictionsMini() {
  const markets = usePredictionMarketStore((state) => state.markets);
  const open = markets.filter((market) => market.status === "open").slice(0, 3);
  return (
    <div className={styles.communityCol}>
      <div className={styles.colHead}>
        <h3>Predictions</h3>
        <Link href="/predictions" className={styles.label}>
          All markets →
        </Link>
      </div>
      {open.length ? (
        open.map((market) => {
          const yes = market.last_traded_probability !== null ? Math.round(market.last_traded_probability * 100) : null;
          return (
            <Link key={market.id} href={`/predictions/${encodeURIComponent(market.slug)}`} className={styles.pm}>
              <span className={styles.pmQ}>{market.title}</span>
              {yes !== null ? (
                <span className={styles.pmBar}>
                  <span className={styles.pmYes} style={{ width: `${Math.max(12, Math.min(88, yes))}%` }}>
                    YES {yes}¢
                  </span>
                  <span className={styles.pmNo}>NO {100 - yes}¢</span>
                </span>
              ) : (
                <span className={styles.meta}>No trades yet</span>
              )}
            </Link>
          );
        })
      ) : (
        <p className={styles.empty}>No open markets.</p>
      )}
    </div>
  );
}

function FloorTop() {
  const entries = useLeaderboardStore((state) => state.entries);
  const me = useLeaderboardStore((state) => state.me);
  const top = entries.slice(0, 5);
  return (
    <div className={styles.communityCol}>
      <div className={styles.colHead}>
        <h3>Top of the floor</h3>
        <Link href="/leaderboard" className={styles.label}>
          Leaderboard →
        </Link>
      </div>
      {top.map((entry) => (
        <Link key={entry.user_id} href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.lb}>
          <span className={styles.rank}>{entry.rank}</span>
          <span className={styles.lbName}>{entry.username}</span>
          <span className={styles.lbValue}>{money(entry.total_equity, { compact: true })}</span>
        </Link>
      ))}
      {me && !top.some((entry) => entry.user_id === me.user_id) ? (
        <Link href="/profile" className={`${styles.lb} ${styles.lbMe}`}>
          <span className={styles.rank}>{me.rank}</span>
          <span className={styles.lbName}>you</span>
          <span className={styles.lbValue}>{money(me.total_equity, { compact: true })}</span>
        </Link>
      ) : null}
      {!top.length ? <p className={styles.empty}>No rankings yet.</p> : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function FrontPage() {
  const assets = useMarketStore((state) => state.assets);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const newsItems = useNewsStore((state) => state.items);
  const isLoadingNews = useNewsStore((state) => state.isLoading);
  const fetchNews = useNewsStore((state) => state.fetchNews);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);
  const fetchMarkets = usePredictionMarketStore((state) => state.fetchMarkets);

  useEffect(() => {
    void fetchNews();
    void fetchMarketIndexes();
    void fetchLivestreams();
    void fetchLeaderboard({ limit: 5 });
    void fetchMarkets();
  }, [fetchLeaderboard, fetchLivestreams, fetchMarketIndexes, fetchMarkets, fetchNews]);

  return (
    <SiteShell>
      <div className={styles.page}>
        <Masthead assets={assets} />
        <NewbieStrip />
        <FrontNews items={newsItems} isLoading={isLoadingNews} />
        <SettlementReport assets={assets} />
        <UnitIndexes assets={assets} />
        <section className={styles.community} aria-label="Community">
          <OnAir />
          <ThreadPulse />
          <PredictionsMini />
          <FloorTop />
        </section>
      </div>
    </SiteShell>
  );
}
