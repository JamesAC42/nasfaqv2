"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FaComment, FaEye, FaHeart, FaMagnifyingGlass, FaNewspaper, FaPencil } from "react-icons/fa6";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { FilterPanel } from "@/app/components/common/filter-panel";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { normalizeArticleListResponse } from "@/app/lib/normalizers";
import { getCompactNewsThumbnailUrl } from "@/app/lib/thumbnails";
import type { ArticleListResponse, ArticleSummary, NewsFeedPagination } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";

import styles from "@/app/components/articles/article-pages.module.scss";

const DEFAULT_PAGINATION: NewsFeedPagination = {
  total: 0,
  page: 1,
  limit: 12,
  page_count: 1,
  has_previous_page: false,
  has_next_page: false,
};

type ArticleFilters = {
  asset: string;
  query: string;
};

const DEFAULT_FILTERS: ArticleFilters = {
  asset: "",
  query: "",
};

function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${fmtInteger(count)} ${count === 1 ? singular : plural}`;
}

function normalizeSummaryText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
}

function EngagementStat({
  kind,
  value,
}: {
  kind: "views" | "likes" | "comments";
  value: number;
}) {
  const label = kind === "views" ? "view" : kind === "likes" ? "like" : "comment";
  const Icon = kind === "views" ? FaEye : kind === "likes" ? FaHeart : FaComment;

  return (
    <span
      className={styles.engagementStat}
      aria-label={formatCountLabel(value, label)}
      title={formatCountLabel(value, label)}
    >
      <span className={styles.engagementIcon} aria-hidden="true">
        <Icon />
      </span>
      <span>{fmtInteger(value)}</span>
    </span>
  );
}

function ArticleMetric({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className={styles.newsMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{meta}</em>
    </div>
  );
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  const subtitle = article.subtitle?.trim() || null;
  const preview = article.preview?.trim() || null;
  const showPreview = Boolean(preview) && normalizeSummaryText(preview) !== normalizeSummaryText(subtitle);

  return (
    <Link href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.cardLink}>
      <article className={`${styles.articleCard} ${article.thumbnail_url ? "" : styles.articleCardNoThumb}`.trim()}>
        {article.thumbnail_url ? <img src={getCompactNewsThumbnailUrl(article.thumbnail_url) || article.thumbnail_url} alt="" className={styles.thumb} /> : null}
        <div className={styles.cardBody}>
          <div className={styles.metaRow}>
            <span className={styles.pill}>Community</span>
            <span className={styles.muted}>{formatDate(article.published_at)}</span>
            <span className={styles.muted}>{article.author ? `By ${article.author.username}` : "Community article"}</span>
          </div>
          {article.related_assets.length ? (
            <div className={styles.assetRow}>
              {article.related_assets.slice(0, 4).map((asset) => (
                <ChannelTickerPill
                  key={asset.id}
                  channel={{
                    name: asset.display_name,
                    symbol: asset.symbol,
                    icon: asset.icon,
                  }}
                  className={styles.compactPill}
                  disableLink
                />
              ))}
            </div>
          ) : null}
          <h2 className={styles.cardTitle}>{article.title}</h2>
          {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          {showPreview ? <p className={styles.cardPreview}>{preview}</p> : null}
          <div className={styles.engagementRow}>
            <EngagementStat kind="views" value={article.views} />
            <EngagementStat kind="likes" value={article.likes} />
            <EngagementStat kind="comments" value={article.comment_count} />
          </div>
        </div>
      </article>
    </Link>
  );
}

export function ArticlesPage() {
  const pathname = usePathname();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const marketError = useMarketStore((state) => state.error);

  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [pagination, setPagination] = useState<NewsFeedPagination>(DEFAULT_PAGINATION);
  const [draftFilters, setDraftFilters] = useState<ArticleFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ArticleFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleItems = items;
  const communityCount = visibleItems.length;
  const activeFilterCount =
    (draftFilters.asset ? 1 : 0) +
    (draftFilters.query.trim() ? 1 : 0);
  const filterSummary = activeFilterCount
    ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
    : "All articles";

  function applyFilters() {
    setPage(1);
    setAppliedFilters({
      asset: draftFilters.asset,
      query: draftFilters.query.trim(),
    });
  }

  function resetFilters() {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  useEffect(() => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
    setItems([]);
    setPagination(DEFAULT_PAGINATION);
    setError(null);
  }, [pathname]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadArticles() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "12");
        params.set("page", String(page));
        params.set("type", "community");
        if (appliedFilters.asset) params.set("asset", appliedFilters.asset);
        if (appliedFilters.query) params.set("q", appliedFilters.query);
        const result = await apiFetch<Record<string, unknown>>(`/api/articles?${params.toString()}`, {
          signal: controller.signal,
        });
        const normalized: ArticleListResponse = normalizeArticleListResponse(result);
        setItems(normalized.items);
        setPagination(normalized.pagination);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setItems([]);
        setPagination(DEFAULT_PAGINATION);
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void loadArticles();
    return () => controller.abort();
  }, [appliedFilters, page]);

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <Image
            src="/articles-archive-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
            aria-hidden="true"
          />
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FaNewspaper aria-hidden="true" />
              Publishing desk
            </div>
            <h1 className={styles.title}>Articles Archive</h1>
            <div className={styles.heroMeta}>
              <span>{pagination.total ? `Showing ${visibleItems.length} of ${pagination.total} articles` : isLoading ? "Loading articles..." : "No articles match the current filters"}</span>
              <span>Page {pagination.page} of {pagination.page_count}</span>
              <span>{user ? "Writer tools available" : "Public archive"}</span>
            </div>
          </div>
          <div className={styles.heroMetrics}>
            <ArticleMetric label="Articles" value={fmtInteger(pagination.total)} meta={`${fmtInteger(visibleItems.length)} loaded`} />
            <ArticleMetric label="Community" value={fmtInteger(communityCount)} meta="visible feed" />
            {user ? <Link href="/articles/new" className={styles.primaryButton}><FaPencil aria-hidden="true" /> Write article</Link> : null}
          </div>
        </section>

        {marketError ? <div className="statusMessage statusMessageError">Market metadata error: {marketError}</div> : null}
        {error ? <div className="statusMessage statusMessageError">Article request error: {error}</div> : null}
        {isLoadingOverview ? <div className={styles.panel}>Loading asset metadata…</div> : null}

        <FilterPanel summary={filterSummary} description="Search titles, types, and related assets">
          <form
            className={styles.filterForm}
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <label className={`${styles.field} ${styles.searchField}`.trim()}>
                <span className={styles.fieldLabel}>Search</span>
                <span className={styles.searchInputShell}>
                  <FaMagnifyingGlass aria-hidden="true" />
                  <input
                    className={styles.filterInput}
                    value={draftFilters.query}
                    onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Search titles, subtitles, or tags"
                  />
                </span>
              </label>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Related asset</span>
                <AssetPicker
                  assets={assets}
                  value={draftFilters.asset}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, asset: value }))}
                  placeholder="Filter by asset"
                  emptyLabel="All assets"
                />
              </label>
            </div>
            <div className={styles.filterActions}>
              <span className={styles.filterMeta}>Filters apply when you search</span>
              <div className={styles.toolbarActions}>
                <button type="button" className={styles.secondaryButton} onClick={resetFilters} disabled={isLoading}>
                  Reset filters
                </button>
                <button type="submit" className={styles.primaryButton} disabled={isLoading}>
                  Search
                </button>
              </div>
            </div>
          </form>
        </FilterPanel>

        <section className={styles.panel}>
          <div className={styles.feedHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Article feed</h2>
              <p className={styles.sectionCopy}>Newest published community articles.</p>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.muted}>{pagination.total} total articles</span>
            </div>
          </div>
          {isLoading && !visibleItems.length ? <div className={styles.empty}>Loading articles…</div> : null}
          {!isLoading && !visibleItems.length ? <div className={styles.empty}>No articles matched the current filters.</div> : null}
          {visibleItems.length ? (
            <div className={styles.grid}>
              {visibleItems.map((article) => <ArticleCard key={article.id} article={article} />)}
            </div>
          ) : null}
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={isLoading || !pagination.has_previous_page}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span className={styles.muted}>Page {pagination.page} of {pagination.page_count}</span>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={isLoading || !pagination.has_next_page}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
