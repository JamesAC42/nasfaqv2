"use client";

import { HeadlineArt } from "@/app/components/articles/headline-art";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { SceneArt } from "@/app/components/common/scene-art";
import { Sparkline } from "@/app/components/common/sparkline";
import { StockChip } from "@/app/components/common/stock-chip";
import { SiteShell } from "@/app/components/layout/site-shell";
import { MARKET_TIME_ZONE } from "@/app/lib/market-clock";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { EvaluationRow, MarketAsset, MyDividendWeek, NewsItem, ReportRow, WeeklyEvaluation, WireItem } from "@/app/lib/types";
import { apiFetch } from "@/app/lib/api";
import { useNow } from "@/app/lib/use-now";
import { nextEvaluationAt, untilText } from "@/app/components/market/dividends-tab";
import { useLocalFlag } from "@/app/lib/use-local-flag";
import { threadLines, useThreadPosts } from "@/app/lib/use-thread";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useOpenStream } from "@/app/stores/stream-store";
import { previewOf } from "@/app/lib/streams";
import { TradingPausedBanner } from "@/app/components/common/trading-paused-banner";
import { useMarketStore } from "@/app/stores/market-store";
import { markSeries, UNIT_ORDER, unitLabel, unitName } from "@/app/lib/market-units";
import { useNewsStore } from "@/app/stores/news-store";
import { CHATTER_TOPIC, heatLabel, useChatterStore, type ChatterTalent } from "@/app/stores/chatter-store";
import { fetchFloor } from "@/app/lib/predictions/api";
import { leader as predictionLeader, outcomeColor } from "@/app/lib/predictions/format";
import type { PredictionMarket as PredictionMarketV2 } from "@/app/lib/predictions/types";
import styles from "@/app/components/home/front-page.module.scss";
import { LIFTS_FAIR_VALUE, WIRE_TAGS, wireTone, wireWhen } from "@/app/components/wire/wire-kit";
import { Term } from "@/app/components/common/tip";


function newsHref(item: NewsItem) {
  if (item.source === "wire" && item.url) return item.url;
  return item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : "/articles?type=news";
}

/** Internal stories route through Next; Wire items can point at YouTube and open in a new tab. */
function StoryLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** "3h ago", or "in 40m" for a Wire story about a stream that hasn't started. */
function storyWhen(item: NewsItem, now: number) {
  const at = item.published_at ? Date.parse(item.published_at) : NaN;
  if (Number.isFinite(at) && at > now + 60_000) {
    const minutes = Math.round((at - now) / 60_000);
    return minutes < 60 ? `in ${minutes}m` : `in ${Math.round(minutes / 60)}h`;
  }
  return timeAgo(item.published_at, now);
}

/** A Wire item dressed as a story, for the days the front page has nothing else to lead with. */
function wireStory(item: WireItem): NewsItem {
  return {
    id: `wire-${item.id}`,
    headline: item.headline,
    source: "wire",
    published_at: item.occurred_at,
    thumbnail_url: item.image_url,
    url: item.link_url,
    summary: item.blurb,
    stock_symbols: item.symbols,
  };
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
    const soldOut = assets.filter((asset) => asset.sold_out).length;
    const buybacks = assets.filter((asset) => asset.trading_state === "buyback").length;
    return { avgMove, up, down, index, soldOut, buybacks };
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
            <span className={styles.label}>
              <Term k="sold-out">Sold out</Term>
            </span>
            <span className={styles.big}>{pulse.soldOut}</span>
            <span className={styles.sub}>{pulse.buybacks ? `${pulse.buybacks} in a buyback` : "stocks with nothing for sale"}</span>
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
      <SceneArt slot="home-welcome" width={132} className={styles.newbieArt} />
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
  if (!symbol) {
    return (
      <HeadlineArt title={item.headline} kind="news" at={item.published_at} units={item.units ?? []} size={lead ? "lead" : "mini"} className={`${lead ? styles.leadImage : styles.headImage} ${styles.thumbBox}`} />
    );
  }
  return (
    <ArtSlot
      kind="keyart"
      symbol={symbol}
      icon={asset?.icon}
      accent={talentAccent(asset?.color, theme)}
      width={lead ? 640 : 96}
      className={lead ? styles.leadImage : styles.headImage}
    />
  );
}

function FrontNews({ items, isLoading }: { items: NewsItem[]; isLoading: boolean }) {
  const [now] = useState(() => Date.now());
  if (!items.length) {
    return <section className={styles.front}>{isLoading ? <p className={styles.empty}>Loading HoloNews…</p> : <p className={styles.empty}>No headlines yet today.</p>}</section>;
  }
  const lead = items.find((item) => item.thumbnail_url) ?? items[0];
  const rest = items.filter((item) => item !== lead).slice(0, 5);
  return (
    <section className={styles.front} aria-label="Headlines">
      <article className={styles.lead}>
        <StoryLink href={newsHref(lead)} className={styles.leadLink}>
          <NewsThumb item={lead} lead />
          <span className={styles.kicker} suppressHydrationWarning>
            {lead.source === "wire" ? "ON THE WIRE" : "LEAD STORY"} · {storyWhen(lead, now).toUpperCase()}
          </span>
          <h2>{lead.headline}</h2>
          {lead.summary ? <p>{lead.summary}</p> : null}
        </StoryLink>
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
            <StoryLink href={newsHref(item)} className={styles.headLink}>
              <NewsThumb item={item} />
              <div>
                <h3>{item.headline}</h3>
                <span className={styles.meta} suppressHydrationWarning>
                  {storyWhen(item, now)}
                </span>
              </div>
            </StoryLink>
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

// ── The Wire ────────────────────────────────────────────────────────────────
function WireThumb({ item }: { item: WireItem }) {
  const assets = useMarketStore((state) => state.assets);
  const symbol = item.symbols[0];
  const asset = symbol ? assets.find((entry) => entry.symbol === symbol) : null;
  if (item.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.image_url} alt="" className={styles.wireImage} loading="lazy" decoding="async" />;
  }
  return (
    <span className={`${styles.wireImage} ${styles.wireMark}`} data-tone={wireTone(item.kind)}>
      {symbol ? <Oshimark icon={asset?.icon} symbol={symbol} size={34} /> : <b>{item.kind === "prediction_resolved" ? "✓" : (WIRE_TAGS[item.kind]?.slice(0, 1) ?? "·")}</b>}
    </span>
  );
}

const WIRE_PAGE = 10;

/** Headlines the site writes itself, from facts: stream events, records, big moves, exchange sales. */
function TheWire({ items }: { items: WireItem[] }) {
  const [now] = useState(() => Date.now());
  const [shownCount, setShownCount] = useState(WIRE_PAGE);
  if (!items.length) return null;
  const shown = items.slice(0, shownCount);
  const left = items.length - shown.length;
  return (
    <section className={styles.wire} aria-label="The Wire">
      <header className={styles.wireHead}>
        <h2>The Wire</h2>
        <span>Streams, records and market moves as they happen</span>
        <Link href="/wire" className={styles.wireAll} prefetch={false}>
          All of it →
        </Link>
      </header>
      <ol className={styles.wireList}>
        {shown.map((item) => {
          const when = wireWhen(item, now);
          return (
            <li key={item.id} className={styles.wireRow}>
              <StoryLink href={item.link_url || "/"} className={styles.wireLink}>
                <WireThumb item={item} />
                <span className={styles.wireText}>
                  <span className={styles.wireMeta} suppressHydrationWarning>
                    <i className={styles.wireTag} data-tone={wireTone(item.kind)}>
                      {WIRE_TAGS[item.kind] ?? "Wire"}
                    </i>
                    <span className={when.live ? styles.wireLive : undefined}>{when.text}</span>
                    {LIFTS_FAIR_VALUE.has(item.kind) ? (
                      <span className={styles.wireLift} title="A big stream: lifts fair value at the next settlement">
                        ▲ fair value
                      </span>
                    ) : null}
                  </span>
                  <b>{item.headline}</b>
                  {item.blurb ? <small>{item.blurb}</small> : null}
                </span>
              </StoryLink>
            </li>
          );
        })}
      </ol>
      {left > 0 ? (
        <button type="button" className={styles.more} onClick={() => setShownCount((count) => count + WIRE_PAGE)}>
          {Math.min(left, WIRE_PAGE)} more on the wire ↓
        </button>
      ) : items.length > WIRE_PAGE ? (
        <button type="button" className={styles.more} onClick={() => setShownCount(WIRE_PAGE)}>
          Fewer ↑
        </button>
      ) : null}
    </section>
  );
}

// ── Hot on /vt/ ──────────────────────────────────────────────────────────────
/** Posts per hour over the last day; the recent window (what heat measures) is drawn in blue. */
function HourlyBars({ hourly, recentHours }: { hourly: number[]; recentHours: number }) {
  const max = Math.max(1, ...hourly);
  const W = 120;
  const H = 26;
  const step = W / hourly.length;
  return (
    <svg className={styles.hotBars} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Posts per hour, last 24 hours: ${hourly.join(", ")}`}>
      {hourly.map((count, index) => {
        const hoursAgo = hourly.length - 1 - index;
        const height = count ? Math.max(2, (count / max) * (H - 1)) : 1;
        return (
          <g key={index}>
            <rect x={index * step + 0.5} y={H - height} width={Math.max(1, step - 1.5)} height={height} rx={0.8} className={hoursAgo < recentHours ? styles.hotBarNow : styles.hotBar} />
            <rect x={index * step} y={0} width={step} height={H} fill="transparent">
              <title>{`${hoursAgo === 0 ? "This hour" : `${hoursAgo}h ago`}: ${count} post${count === 1 ? "" : "s"}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

function HotOnVt() {
  const summary = useChatterStore((state) => state.summary);
  const fetchChatter = useChatterStore((state) => state.fetchChatter);
  const assets = useMarketStore((state) => state.assets);
  useEffect(() => {
    void fetchChatter();
  }, [fetchChatter]);
  const bySymbol = useMemo(() => new Map(assets.map((asset) => [asset.symbol, asset])), [assets]);
  const pick = (symbols: string[] | undefined) =>
    (symbols ?? [])
      .map((symbol) => summary?.talents.find((talent) => talent.symbol === symbol))
      .filter((talent): talent is ChatterTalent => Boolean(talent) && bySymbol.has(talent!.symbol))
      .slice(0, 6);
  // Three or more running hot makes a board; otherwise show who's simply busiest.
  const heated = pick(summary?.hot);
  const mode = heated.length >= 3 ? "hot" : "busiest";
  const hot = mode === "hot" ? heated : pick(summary?.busiest);
  if (!summary || hot.length < 2) return null;
  return (
    <section className={styles.hot} data-mode={mode} aria-label={`${mode === "hot" ? "Hot" : "Busiest"} on ${summary.board}`}>
      <header className={styles.wireHead}>
        <h2>{mode === "hot" ? "Hot" : "Busiest"} on {summary.board}</h2>
        <span>
          {mode === "hot" ? `Posts in hololive threads, last ${summary.recent_hours} hours, against each talent's usual` : `Most posts in hololive threads, last ${summary.recent_hours} hours`}
        </span>
        <Link href="/wire" className={styles.wireAll} prefetch={false}>
          The week on {summary.board} →
        </Link>
      </header>
      <ol className={styles.hotList} style={{ "--n": hot.length } as CSSProperties}>
        {hot.map((talent, index) => {
          const asset = bySymbol.get(talent.symbol)!;
          const heat = mode === "hot" ? heatLabel(talent) : null;
          return (
            <li key={talent.symbol}>
              <Link href={`/stocks/${encodeURIComponent(talent.symbol)}`} className={styles.hotTile} data-peek-stock={talent.symbol} prefetch={false}>
                <span className={styles.hotWho}>
                  <i className={styles.hotRank}>{index + 1}</i>
                  <Oshimark icon={asset.icon} symbol={talent.symbol} size={24} />
                  <b>{talent.symbol}</b>
                  <small>{asset.display_name}</small>
                </span>
                <span className={styles.hotNumbers}>
                  <strong>{heat ?? talent.posts_recent}</strong>
                  <small>
                    {heat ? `${talent.posts_recent} posts` : "posts"}
                    {talent.topic ? ` · ${CHATTER_TOPIC[talent.topic]}` : ""}
                  </small>
                </span>
                <HourlyBars hourly={talent.hourly} recentHours={summary.recent_hours} />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Settlement report ────────────────────────────────────────────────────────
type ReportLine = { symbol: string; left: string; right: string; tone: "up" | "down" | "flat"; tag?: string };

/** What a big stream is called on the report, when it's what lifted a fair value. */
const EVENT_TAGS: Record<string, string> = {
  three_d: "3D",
  new_outfit: "Outfit",
  original_song: "Song",
  anniversary: "Anniv.",
  birthday: "Bday",
  milestone: "Milestone",
  cover_song: "Cover",
};

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
            <span className={styles.fromTo}>
              {line.tag ? (
                <i className={styles.repTag} title="A big stream lifted this fair value">
                  {line.tag}
                </i>
              ) : null}
              {line.left}
            </span>
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
    // Revealed settlements only: the open against the target the day's ticks pulled toward.
    const gap = row.market_price && row.fair_value ? (row.fair_value - row.market_price) / row.market_price : null;
    const event = row.events?.find((kind) => EVENT_TAGS[kind]);
    return { symbol: row.symbol, left: `px ${fmt2(row.market_price)} · fair ${fmt2(row.fair_value)}`, right: signedPct(gap), tone: toneOf(gap), tag: event ? EVENT_TAGS[event] : undefined };
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

  // Supply: buybacks first, then sold out, then the least left for sale.
  const supplyLines = useMemo<ReportLine[]>(() => {
    return (report?.supply_watch ?? []).slice(0, 5).map((row) => ({
      symbol: row.symbol,
      left: `${Math.round(row.held).toLocaleString("en-US")} of ${Math.round(row.max_supply).toLocaleString("en-US")} held`,
      right: row.trading_state === "buyback" ? "BUYBACK" : row.shares_for_sale <= 0 ? "SOLD OUT" : `${Math.floor(row.shares_for_sale).toLocaleString("en-US")} left`,
      tone: row.trading_state === "buyback" || row.shares_for_sale <= 0 ? ("down" as const) : ("flat" as const),
    }));
  }, [report]);
  const revealed = report?.revealed_targets ?? null;
  const revealedDay = revealed?.market_date ? revealed.market_date.slice(5, 10).replace("-", "/") : null;
  const secretNote = report?.targets_revealed === false ? " Today's stay secret until Overnight lands: read the channels and guess." : "";

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
        <ReportColumn
          title={revealedDay ? `Fair value up · ${revealedDay}` : "Fair value up"}
          tone="up"
          lines={fairLines(revealed?.biggest_fair_value_increases)}
          note={`Revealed once a day's four ticks have landed. The % is the gap from the open to the target those ticks pulled toward.${secretNote}`}
        />
        <ReportColumn
          title={revealedDay ? `Fair value down · ${revealedDay}` : "Fair value down"}
          tone="down"
          lines={fairLines(revealed?.biggest_fair_value_decreases)}
          note="Stagnant channels and missed uploads get marked down."
        />
        <ReportColumn title="Supply watch" lines={supplyLines} note="Buying takes shares from the broker. Sold out means buys wait for sellers; max shares reset every Saturday." />
        <ReportColumn title="Gapped at the open" lines={gappers} note="Biggest price resets at settlement, either way. Not financial advice, anon." />
      </div>
    </section>
  );
}

// ── The Dividend Review ──────────────────────────────────────────────────────
function shortEvalDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Last Saturday's review (who paid, who charged, whose max shares moved) and the countdown to the next. */
function DividendReview() {
  const { user } = useAuth();
  const now = useNow();
  const [review, setReview] = useState<WeeklyEvaluation | null | undefined>(undefined);
  const [mine, setMine] = useState<MyDividendWeek | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch<WeeklyEvaluation>("/api/market/evaluations/latest")
      .then((result) => alive && setReview(result))
      .catch(() => alive && setReview(null));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    apiFetch<{ weeks: MyDividendWeek[] }>("/api/market/me/dividends?limit=1")
      .then((result) => alive && setMine(result.weeks[0] ?? null))
      .catch(() => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [user]);

  if (review === undefined) return null;
  const next = now ? nextEvaluationAt(now) : null;
  const day = review ? shortEvalDate(review.eval_date) : null;
  const rateLine = (row: EvaluationRow): ReportLine => ({ symbol: row.symbol, left: `${money(Math.abs(row.per_share))} a share`, right: signedPct(row.rate, 2), tone: toneOf(row.rate) });
  const supplyLines: ReportLine[] = review
    ? [...review.max_shares_raised.slice(0, 3), ...review.max_shares_lowered.slice(0, 2)].map((row) => ({
        symbol: row.symbol,
        left: `${Math.round(row.max_supply_before).toLocaleString("en-US")} → ${Math.round(row.max_supply_after).toLocaleString("en-US")}`,
        right: row.buyback ? "BUYBACK" : `${row.max_supply_after > row.max_supply_before ? "+" : ""}${Math.round(row.max_supply_after - row.max_supply_before).toLocaleString("en-US")}`,
        tone: row.buyback || row.max_supply_after < row.max_supply_before ? "down" : "up",
      }))
    : [];
  const myNet = user && review && mine?.eval_date === review.eval_date ? mine.net : null;

  return (
    <section className={styles.block} aria-labelledby="review-title">
      <div className={styles.blockHead}>
        <h2 id="review-title">
          The <Term k="evaluation">Dividend Review</Term>
        </h2>
        <Link href="/market/dividends" className={styles.label}>
          {day ? `${day} · ` : ""}full review →
        </Link>
      </div>
      <div className={styles.report}>
        <div className={`${styles.reportCol} ${styles.reviewNext}`}>
          <h3>Next review</h3>
          <b className={styles.reviewClock} suppressHydrationWarning>
            {next && now ? untilText(next - now) : "—"}
          </b>
          <span className={styles.meta}>Saturday 00:00 ET</span>
          {myNet !== null ? (
            <p className={styles.reviewMine}>
              Your last: <b className={styles[toneOf(myNet)]}>{myNet >= 0 ? "+" : ""}{money(myNet)}</b>
            </p>
          ) : null}
          <p className={styles.note}>
            {review
              ? `Last week ${review.paying_count} stocks paid ${money(review.dividends_total, { compact: true })} and ${review.charging_count} charged ${money(Math.abs(review.fees_total), { compact: true })}. Hold at the review to collect.`
              : "Channel growth over the week decides it: the top pays holders a dividend, the bottom charges a share fee. Hold at the review to collect."}
          </p>
        </div>
        {review ? (
          <>
            <ReportColumn title={`Paid · ${day}`} tone="up" lines={review.top_dividends.slice(0, 5).map(rateLine)} note="Dividend per share held at the review." />
            <ReportColumn title={`Charged · ${day}`} tone="down" lines={review.top_fees.slice(0, 5).map(rateLine)} note="The slowest-growing channels charge holders a fee." />
            <ReportColumn title="Max shares moved" lines={supplyLines} note="Max shares follow subscribers. Held above the new max starts a buyback." />
          </>
        ) : null}
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
  const [markets, setMarkets] = useState<PredictionMarketV2[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchFloor({ tab: "live", limit: 3 })
      .then((result) => alive && setMarkets(result.items))
      .catch(() => alive && setMarkets([]));
    return () => {
      alive = false;
    };
  }, []);
  const open = markets ?? [];
  return (
    <div className={styles.communityCol}>
      <div className={styles.colHead}>
        <h3>Predictions</h3>
        <Link href="/predictions" className={styles.label}>
          All markets →
        </Link>
      </div>
      {markets === null ? (
        <p className={styles.empty}>Loading markets…</p>
      ) : open.length ? (
        open.map((market) => {
          // Binary shows both sides with their labels (Yes/No, Up/Down); multi shows the leader.
          const yes = market.outcomes.find((outcome) => outcome.outcome_code === "yes");
          const no = market.outcomes.find((outcome) => outcome.outcome_code === "no");
          const top = market.market_type === "multi" ? predictionLeader(market.outcomes) : null;
          const main = top ?? yes;
          const pct = main ? Math.round(main.price * 100) : null;
          const barStyle = {
            "--pm-a": main ? outcomeColor(market, main) : "var(--blue)",
            "--pm-b": no && !top ? outcomeColor(market, no) : "var(--dim)",
          } as CSSProperties;
          return (
            <Link key={market.id} href={`/predictions/${encodeURIComponent(market.slug)}`} className={styles.pm}>
              <span className={styles.pmQ}>{market.title}</span>
              {main && pct !== null ? (
                <span className={styles.pmBar} style={barStyle}>
                  <span className={styles.pmYes} style={{ width: `${Math.max(top ? 34 : 22, Math.min(78, pct))}%` }}>
                    {main.label} {top ? `${pct}%` : `${pct}¢`}
                  </span>
                  <span className={styles.pmNo}>{top ? `${market.outcomes.length - 1} more` : `${no?.label ?? "No"} ${100 - pct}¢`}</span>
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
  const wire = useNewsStore((state) => state.wire);
  const wireLoaded = useNewsStore((state) => state.wireLoaded);
  const fetchWire = useNewsStore((state) => state.fetchWire);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);

  useEffect(() => {
    void fetchNews();
    void fetchWire();
    void fetchMarketIndexes();
    void fetchLivestreams();
    void fetchLeaderboard({ limit: 5 });
  }, [fetchLeaderboard, fetchLivestreams, fetchMarketIndexes, fetchNews, fetchWire]);

  // No articles at all: the Wire leads the front page, and its list carries on from there.
  const wireLeads = !newsItems.length && !isLoadingNews && wire.length > 0;
  const frontItems = wireLeads ? wire.slice(0, 6).map(wireStory) : newsItems;
  const wireItems = wireLeads ? wire.slice(6) : wire;

  return (
    <SiteShell>
      <div className={styles.page}>
        <Masthead assets={assets} />
        <TradingPausedBanner className={styles.paused} />
        <NewbieStrip />
        <FrontNews items={frontItems} isLoading={isLoadingNews || (!newsItems.length && !wireLoaded)} />
        <TheWire items={wireItems} />
        <HotOnVt />
        <SettlementReport assets={assets} />
        <DividendReview />
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
