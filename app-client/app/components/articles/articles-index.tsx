"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { StockChip } from "@/app/components/common/stock-chip";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fromArticle, fromNews, splitHeadline, type Story } from "@/app/components/articles/stories";
import { apiFetch } from "@/app/lib/api";
import { UNIT_ORDER, unitName } from "@/app/lib/market-units";
import { normalizeArticleListResponse, normalizeNewsFeedResponse } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { getCompactNewsThumbnailUrl } from "@/app/lib/thumbnails";
import { timeAgo } from "@/app/lib/time";
import type { NewsFeedPagination } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/articles.module.scss";

export type FeedType = "all" | "news" | "community";
export type FeedQuery = { type: FeedType; q: string; stock: string; unit: string; sort: "newest" | "oldest"; page: number };

const TABS: Array<[FeedType, string]> = [
  ["all", "EVERYTHING"],
  ["news", "HOLONEWS"],
  ["community", "PLAYER ARTICLES"],
];
const PAGE_SIZE = 20;
const EMPTY_PAGE: NewsFeedPagination = { total: 0, page: 1, limit: PAGE_SIZE, page_count: 1, has_previous_page: false, has_next_page: false };

function toQueryString(query: FeedQuery) {
  const params = new URLSearchParams();
  if (query.type !== "all") params.set("type", query.type);
  if (query.q) params.set("q", query.q);
  if (query.stock) params.set("stock", query.stock);
  if (query.type === "news" && query.unit) params.set("unit", query.unit);
  if (query.type === "news" && query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Load one page of the feed. HoloNews uses the news endpoint (units, sort, summaries); the rest use articles. */
function useFeed(query: FeedQuery) {
  const [stories, setStories] = useState<Story[]>([]);
  const [pagination, setPagination] = useState<NewsFeedPagination>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(query.page), limit: String(PAGE_SIZE) });
    if (query.q) params.set("q", query.q);
    const request =
      query.type === "news"
        ? (() => {
            if (query.stock) params.set("stock", query.stock);
            if (query.unit) params.set("unit", query.unit);
            params.set("sort", query.sort);
            return apiFetch<Record<string, unknown>>(`/api/news?${params}`).then((raw) => {
              const feed = normalizeNewsFeedResponse(raw);
              return { stories: feed.items.map(fromNews), pagination: feed.pagination };
            });
          })()
        : (() => {
            if (query.stock) params.set("asset", query.stock);
            if (query.type === "community") params.set("type", "community");
            return apiFetch<Record<string, unknown>>(`/api/articles?${params}`).then((raw) => {
              const list = normalizeArticleListResponse(raw);
              return { stories: list.items.map(fromArticle), pagination: list.pagination };
            });
          })();
    request
      .then((result) => {
        if (cancelled) return;
        setStories(result.stories);
        setPagination(result.pagination);
      })
      .catch((reason) => {
        if (cancelled) return;
        setStories([]);
        setPagination(EMPTY_PAGE);
        setError(String((reason as Error).message || reason));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query.page, query.q, query.sort, query.stock, query.type, query.unit]);

  return { stories, pagination, loading, error };
}

function Thumb({ story, size }: { story: Story; size: "lead" | "row" }) {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  if (story.thumb) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={size === "row" ? getCompactNewsThumbnailUrl(story.thumb) || story.thumb : story.thumb} alt="" loading={size === "lead" ? "eager" : "lazy"} decoding="async" className={size === "lead" ? styles.leadImg : styles.rowImg} />;
  }
  const symbol = story.symbols[0] ?? "NEWS";
  const asset = assets.find((entry) => entry.symbol === symbol);
  return <ArtSlot kind="keyart" symbol={symbol} icon={asset?.icon} accent={talentAccent(asset?.color, theme)} width={size === "lead" ? 640 : 120} className={size === "lead" ? styles.leadImg : styles.rowImg} />;
}

function Byline({ story }: { story: Story }) {
  return (
    <span className={styles.byline} suppressHydrationWarning>
      <b className={story.kind === "news" ? styles.kNews : styles.kPlayer}>{story.kind === "news" ? "HOLONEWS" : "ARTICLE"}</b>
      {story.draft ? <b className={styles.kDraft}>DRAFT</b> : null}
      {story.author ? <span>by {story.author}</span> : story.source && !/holonews/i.test(story.source) ? <span>{story.source}</span> : null}
      <span>{timeAgo(story.at)}</span>
    </span>
  );
}

function Counts({ story }: { story: Story }) {
  return (
    <span className={styles.counts}>
      <span title="Views">{story.views.toLocaleString("en-US")} views</span>
      <span title="Likes">♥ {story.likes}</span>
      <span title="Comments">{story.comments} comments</span>
    </span>
  );
}

function Lead({ story }: { story: Story }) {
  const heading = story.kind === "news" ? splitHeadline(story.title) : { title: story.title, dek: null };
  return (
    <article className={styles.lead}>
      <Link href={story.href} className={styles.leadLink}>
        <Thumb story={story} size="lead" />
        <span className={styles.leadText}>
          <Byline story={story} />
          <h2>{heading.title}</h2>
          {story.dek || heading.dek ? <p>{story.dek || heading.dek}</p> : null}
        </span>
      </Link>
      <div className={styles.leadFoot}>
        {story.symbols.length ? (
          <span className={styles.chips}>
            {story.symbols.slice(0, 5).map((symbol) => (
              <StockChip key={symbol} symbol={symbol} />
            ))}
          </span>
        ) : null}
        <Counts story={story} />
      </div>
    </article>
  );
}

function Row({ story }: { story: Story }) {
  const heading = story.kind === "news" ? splitHeadline(story.title) : { title: story.title, dek: null };
  const dek = story.dek || heading.dek;
  return (
    <article className={styles.row}>
      <Link href={story.href} className={styles.rowLink}>
        <Thumb story={story} size="row" />
        <span className={styles.rowBody}>
          <Byline story={story} />
          <b className={styles.rowTitle}>{heading.title}</b>
          {dek ? <span className={styles.rowDek}>{dek}</span> : null}
        </span>
      </Link>
      <div className={styles.rowFoot}>
        {story.symbols.length ? (
          <span className={styles.chips}>
            {story.symbols.slice(0, 4).map((symbol) => (
              <StockChip key={symbol} symbol={symbol} />
            ))}
          </span>
        ) : null}
        <Counts story={story} />
      </div>
    </article>
  );
}

export function ArticlesIndex({ initial }: { initial: FeedQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const [query, setQuery] = useState<FeedQuery>(initial);
  const [draftQ, setDraftQ] = useState(initial.q);
  const [ticker, setTicker] = useState(initial.stock);
  const { stories, pagination, loading, error } = useFeed(query);

  const update = (patch: Partial<FeedQuery>) => setQuery((current) => ({ ...current, page: 1, ...patch }));

  useEffect(() => {
    router.replace(`${pathname}${toQueryString(query)}`, { scroll: false });
  }, [pathname, query, router]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery((current) => (current.q === draftQ.trim() ? current : { ...current, q: draftQ.trim(), page: 1 })), 350);
    return () => window.clearTimeout(id);
  }, [draftQ]);

  const stockAsset = assets.find((asset) => asset.symbol === query.stock) ?? null;
  const talents = useMemo(() => {
    const counts = new Map<string, number>();
    stories.forEach((story) => story.symbols.forEach((symbol) => counts.set(symbol, (counts.get(symbol) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [stories]);
  const units = useMemo(() => {
    const present = new Set(assets.map((asset) => asset.unit).filter((unit): unit is string => Boolean(unit)));
    return [...present].sort((a, b) => {
      const ia = UNIT_ORDER.indexOf(unitName(a));
      const ib = UNIT_ORDER.indexOf(unitName(b));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [assets]);

  const filtered = Boolean(query.q || query.stock || query.unit);
  const showLead = query.page === 1 && !filtered && stories.length > 3;
  const lead = showLead ? stories.find((story) => story.thumb) ?? stories[0] : null;
  const rest = lead ? stories.filter((story) => story !== lead) : stories;

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <h1>Articles</h1>
            <p>HoloNews headlines as they land, and what players wrote about them.</p>
          </div>
          <nav className={styles.tabs} aria-label="Feed">
            {TABS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={query.type === value} onClick={() => update({ type: value, unit: value === "news" ? query.unit : "", sort: value === "news" ? query.sort : "newest" })}>
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder={query.type === "news" ? "Search headlines" : "Search titles, subtitles and tags"} aria-label="Search" />
            {draftQ ? (
              <button type="button" onClick={() => setDraftQ("")} aria-label="Clear search">
                ✕
              </button>
            ) : null}
          </label>
          <label className={styles.ticker}>
            {stockAsset ? <Oshimark icon={stockAsset.icon} symbol={stockAsset.symbol} size={16} /> : <span className={styles.dim}>$</span>}
            <input
              value={ticker}
              maxLength={4}
              placeholder="TICKER"
              aria-label="Filter by stock"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                setTicker(next);
                if (!next) update({ stock: "" });
                else if (assets.some((asset) => asset.symbol === next)) update({ stock: next });
              }}
            />
          </label>
          {query.type === "news" ? (
            <>
              <select className={styles.select} value={query.unit} onChange={(event) => update({ unit: event.target.value })} aria-label="Unit">
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitName(unit)}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={query.sort} onChange={(event) => update({ sort: event.target.value as FeedQuery["sort"] })} aria-label="Sort">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </>
          ) : null}
          <span className={styles.count}>{loading ? "loading…" : `${pagination.total.toLocaleString("en-US")} ${pagination.total === 1 ? "story" : "stories"}`}</span>
        </div>

        {filtered ? (
          <div className={styles.tags}>
            {query.q ? (
              <button type="button" onClick={() => (setDraftQ(""), update({ q: "" }))}>
                “{query.q}” ✕
              </button>
            ) : null}
            {query.stock ? (
              <button type="button" onClick={() => (setTicker(""), update({ stock: "" }))}>
                ${query.stock} ✕
              </button>
            ) : null}
            {query.unit ? (
              <button type="button" onClick={() => update({ unit: "" })}>
                {unitName(query.unit)} ✕
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.layout}>
          <main className={styles.feed}>
            {error ? <p className={styles.empty}>Couldn&apos;t load the feed ({error}).</p> : null}
            {lead ? <Lead story={lead} /> : null}
            {rest.map((story) => (
              <Row key={story.key} story={story} />
            ))}
            {!loading && !stories.length && !error ? (
              <p className={styles.empty}>{filtered ? "Nothing matches those filters." : query.type === "community" ? "No player articles yet. Be the first." : "No stories yet."}</p>
            ) : null}
            {loading && !stories.length ? <p className={styles.empty}>Loading stories…</p> : null}
            {pagination.page_count > 1 ? (
              <div className={styles.pager}>
                <button type="button" disabled={!pagination.has_previous_page || loading} onClick={() => (setQuery((current) => ({ ...current, page: current.page - 1 })), window.scrollTo({ top: 0 }))}>
                  ‹ NEWER
                </button>
                <span>
                  page {pagination.page} of {pagination.page_count.toLocaleString("en-US")}
                </span>
                <button type="button" disabled={!pagination.has_next_page || loading} onClick={() => (setQuery((current) => ({ ...current, page: current.page + 1 })), window.scrollTo({ top: 0 }))}>
                  OLDER ›
                </button>
              </div>
            ) : null}
          </main>

          <aside className={styles.rail}>
            <section className={styles.cta}>
              <h2>Write one</h2>
              <p>Call a pump, explain a dump, or write the long version of a HoloNews headline. Articles are tagged to the talents they cover and show up on their stock pages.</p>
              {user ? (
                <Link href="/articles/new" className={styles.primary}>
                  WRITE AN ARTICLE
                </Link>
              ) : (
                <Link href="/login" className={styles.ghost}>
                  SIGN IN TO WRITE
                </Link>
              )}
            </section>
            {talents.length ? (
              <section className={styles.railSec}>
                <h2>Talents in these stories</h2>
                <div className={styles.talents}>
                  {talents.map(([symbol, count]) => {
                    const asset = assets.find((entry) => entry.symbol === symbol);
                    return (
                      <button key={symbol} type="button" aria-pressed={query.stock === symbol} onClick={() => (setTicker(query.stock === symbol ? "" : symbol), update({ stock: query.stock === symbol ? "" : symbol }))} title={asset?.display_name}>
                        <Oshimark icon={asset?.icon} symbol={symbol} size={18} />
                        <b>{symbol}</b>
                        <small>{count}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section className={styles.railSec}>
              <h2>How coverage works</h2>
              <ol className={styles.how}>
                <li>HoloNews headlines import on their own, tagged to the talents in them.</li>
                <li>Anyone can open the draft room on a headline and propose the full article.</li>
                <li>Players vote on the drafts, and an editor approves one as the official version.</li>
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </SiteShell>
  );
}
