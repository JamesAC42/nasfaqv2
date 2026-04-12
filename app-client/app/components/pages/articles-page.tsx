"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaComment, FaEye, FaHeart } from "react-icons/fa6";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { FilterPanel } from "@/app/components/common/filter-panel";
import { OptionPicker } from "@/app/components/common/option-picker";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { normalizeArticleListResponse } from "@/app/lib/normalizers";
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
  type: string;
  asset: string;
  query: string;
};

function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getCompactThumbnailUrl(url: string | null | undefined) {
  if (!url) return null;
  const lastSlashIndex = url.lastIndexOf("/");
  if (lastSlashIndex < 0 || lastSlashIndex === url.length - 1) return url;
  return `${url.slice(0, lastSlashIndex + 1)}thumbnail-${url.slice(lastSlashIndex + 1)}`;
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

function ArticleCard({ article }: { article: ArticleSummary }) {
  const subtitle = article.subtitle?.trim() || null;
  const preview = article.preview?.trim() || null;
  const showPreview = Boolean(preview) && normalizeSummaryText(preview) !== normalizeSummaryText(subtitle);

  return (
    <Link href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.cardLink}>
      <article className={`${styles.articleCard} ${article.thumbnail_url ? "" : styles.articleCardNoThumb}`.trim()}>
        {article.thumbnail_url ? <img src={getCompactThumbnailUrl(article.thumbnail_url) || article.thumbnail_url} alt="" className={styles.thumb} /> : null}
        <div className={styles.cardBody}>
          <div className={styles.metaRow}>
            <span className={styles.pill}>{article.is_news ? "News" : "Community"}</span>
            <span className={styles.muted}>{formatDate(article.published_at)}</span>
            <span className={styles.muted}>{article.author ? `By ${article.author.username}` : "Imported news item"}</span>
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

function hasApprovedArticleBody(article: ArticleSummary) {
  if (!article.is_news) return true;
  return Boolean(article.preview?.trim());
}

export function ArticlesPage() {
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const marketError = useMarketStore((state) => state.error);

  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [pagination, setPagination] = useState<NewsFeedPagination>(DEFAULT_PAGINATION);
  const [draftFilters, setDraftFilters] = useState<ArticleFilters>({
    type: "all",
    asset: "",
    query: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ArticleFilters>({
    type: "all",
    asset: "",
    query: "",
  });
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleItems = items.filter(hasApprovedArticleBody);
  const activeFilterCount =
    (draftFilters.type !== "all" ? 1 : 0) +
    (draftFilters.asset ? 1 : 0) +
    (draftFilters.query.trim() ? 1 : 0);
  const filterSummary = activeFilterCount
    ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
    : "All articles";

  function applyFilters() {
    setPage(1);
    setAppliedFilters({
      type: draftFilters.type,
      asset: draftFilters.asset,
      query: draftFilters.query.trim(),
    });
  }

  function resetFilters() {
    const nextFilters: ArticleFilters = {
      type: "all",
      asset: "",
      query: "",
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function loadArticles() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "12");
        params.set("page", String(page));
        if (appliedFilters.type !== "all") params.set("type", appliedFilters.type);
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
          <div className={styles.eyebrow}>Publishing Desk</div>
          <h1 className={styles.title}>Articles & News</h1>
          <p className={styles.copy}>
            Community-authored writeups and converted news entries live in the same system, with likes, saves, comments, related assets, and proposal workflows for news coverage.
          </p>
          <div className={styles.toolbar}>
            <div className={styles.metaRow}>
              <span className={styles.muted}>{pagination.total} total articles</span>
              <span className={styles.muted}>Page {pagination.page} of {pagination.page_count}</span>
            </div>
            <div className={styles.toolbarActions}>
              {user ? <Link href="/articles/new" className={styles.primaryButton}>Write article</Link> : null}
            </div>
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
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Search</span>
                <input
                  className={styles.filterInput}
                  value={draftFilters.query}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Search titles, subtitles, or tags"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Type</span>
                <OptionPicker
                  value={draftFilters.type}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, type: value }))}
                  placeholder="All article types"
                  options={[
                    { value: "all", label: "All article types" },
                    { value: "community", label: "Community articles" },
                    { value: "news", label: "News articles" },
                  ]}
                />
              </label>
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
