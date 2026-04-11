"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaComment, FaHeart } from "react-icons/fa6";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { FilterPanel } from "@/app/components/common/filter-panel";
import { OptionPicker } from "@/app/components/common/option-picker";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { normalizeNewsFeedResponse } from "@/app/lib/normalizers";
import type { NewsFeedPagination, NewsFeedResponse, NewsItem } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/news-page.module.scss";

const DEFAULT_PAGINATION: NewsFeedPagination = {
  total: 0,
  page: 1,
  limit: 20,
  page_count: 1,
  has_previous_page: false,
  has_next_page: false,
};

type NewsFilters = {
  headlineQuery: string;
  stockQuery: string;
  unit: string;
  sort: string;
  limit: number;
};

function formatPublishedDate(value: string | null | undefined) {
  if (!value) return "Unknown date";
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

function getArticleHref(item: NewsItem) {
  return item.article_slug ? `/articles/${encodeURIComponent(item.article_slug)}` : "/articles";
}

function EngagementStat({
  kind,
  value,
}: {
  kind: "likes" | "comments";
  value: number | null | undefined;
}) {
  return (
    <span className={styles.engagementStat}>
      <span className={styles.engagementIcon} aria-hidden="true">
        {kind === "likes" ? <FaHeart /> : <FaComment />}
      </span>
      <span>{fmtInteger(value ?? 0)}</span>
    </span>
  );
}

export function NewsPage() {
  const marketError = useMarketStore((state) => state.error);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const assets = useMarketStore((state) => state.assets);

  const [draftFilters, setDraftFilters] = useState<NewsFilters>({
    headlineQuery: "",
    stockQuery: "",
    unit: "all",
    sort: "newest",
    limit: 20,
  });
  const [appliedFilters, setAppliedFilters] = useState<NewsFilters>({
    headlineQuery: "",
    stockQuery: "",
    unit: "all",
    sort: "newest",
    limit: 20,
  });
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [pagination, setPagination] = useState<NewsFeedPagination>(DEFAULT_PAGINATION);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function applyFilters() {
    setPage(1);
    setAppliedFilters({
      headlineQuery: draftFilters.headlineQuery.trim(),
      stockQuery: draftFilters.stockQuery.trim(),
      unit: draftFilters.unit,
      sort: draftFilters.sort,
      limit: draftFilters.limit,
    });
  }

  function resetFilters() {
    const nextFilters: NewsFilters = {
      headlineQuery: "",
      stockQuery: "",
      unit: "all",
      sort: "newest",
      limit: 20,
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function fetchNewsPage() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (appliedFilters.headlineQuery) params.set("q", appliedFilters.headlineQuery);
        if (appliedFilters.stockQuery) params.set("stock", appliedFilters.stockQuery);
        if (appliedFilters.unit !== "all") params.set("unit", appliedFilters.unit);
        params.set("sort", appliedFilters.sort);
        params.set("limit", String(appliedFilters.limit));
        params.set("page", String(page));

        const result = await apiFetch<Record<string, unknown>>(`/api/news?${params.toString()}`, {
          signal: controller.signal,
        });
        const normalized: NewsFeedResponse = normalizeNewsFeedResponse(result);
        setItems(normalized.items);
        setPagination(normalized.pagination);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setItems([]);
        setPagination(DEFAULT_PAGINATION);
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void fetchNewsPage();
    return () => controller.abort();
  }, [appliedFilters, page]);

  const unitOptions = Array.from(new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
  const unitPickerOptions = [
    { value: "all", label: "All units" },
    ...unitOptions.map((option) => ({ value: option, label: option })),
  ];
  const sortOptions = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "headline_asc", label: "Headline A-Z" },
    { value: "headline_desc", label: "Headline Z-A" },
  ];
  const limitOptions = [10, 20, 30, 50].map((option) => ({
    value: String(option),
    label: `${option} per page`,
  }));
  const activeFilterCount =
    (draftFilters.headlineQuery.trim() ? 1 : 0) +
    (draftFilters.stockQuery ? 1 : 0) +
    (draftFilters.unit !== "all" ? 1 : 0) +
    (draftFilters.sort !== "newest" ? 1 : 0) +
    (draftFilters.limit !== 20 ? 1 : 0);
  const filterSummary = activeFilterCount
    ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
    : "All stories";

  const resultSummary = pagination.total
    ? `Showing ${items.length} of ${pagination.total} stories`
    : isLoading
      ? "Loading stories..."
      : "No stories match the current filters";

  return (
    <SiteShell>
      <div className={shellStyles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>News Desk</div>
          <h1 className={styles.title}>HoloNews Archive</h1>
          <p className={styles.copy}>All HoloNews headlines in one feed. Browse the full database-backed archive.</p>
          <div className={styles.heroMeta}>
            <span>{resultSummary}</span>
            <span>Page {pagination.page} of {pagination.page_count}</span>
          </div>
        </section>

        {marketError ? <div className="statusMessage statusMessageError">Request error: {marketError}</div> : null}
        {error ? <div className="statusMessage statusMessageError">News request error: {error}</div> : null}
        {isLoadingOverview ? <div className={shellStyles.panel}>Loading market metadata…</div> : null}

        <FilterPanel summary={filterSummary} description="Search headlines and narrow the news feed">
          <form
            className={styles.filterForm}
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <div className={styles.filtersGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Headline search</span>
                <input
                  value={draftFilters.headlineQuery}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, headlineQuery: event.target.value }))}
                  className={styles.input}
                  placeholder="Search headline text"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Stock</span>
                <AssetPicker
                  assets={assets}
                  value={draftFilters.stockQuery}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, stockQuery: value }))}
                  placeholder="Filter by stock"
                  emptyLabel="All stocks"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit</span>
                <OptionPicker
                  value={draftFilters.unit}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, unit: value }))}
                  options={unitPickerOptions}
                  placeholder="All units"
                  searchable
                  searchPlaceholder="Search units"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Sort</span>
                <OptionPicker
                  value={draftFilters.sort}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, sort: value }))}
                  options={sortOptions}
                  placeholder="Newest first"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Items per page</span>
                <OptionPicker
                  value={String(draftFilters.limit)}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, limit: Number(value) }))}
                  options={limitOptions}
                  placeholder="20 per page"
                />
              </label>
            </div>
            <div className={styles.filterActions}>
              <div className={styles.paginationMeta}>
                <span>Filters apply when you search</span>
              </div>
              <div className={styles.filterActionButtons}>
                <button
                  type="button"
                  className={styles.resetButton}
                  onClick={resetFilters}
                  disabled={isLoading}
                >
                  Reset filters
                </button>
                <button type="submit" className={styles.searchButton} disabled={isLoading}>
                  Search
                </button>
              </div>
            </div>
          </form>
        </FilterPanel>

        {isLoading && !items.length ? <div className={shellStyles.panel}>Loading news feed…</div> : null}

        <section className={styles.feedPanel}>
          <div className={styles.feedHeader}>
            <h2 className={styles.sectionTitle}>News Feed</h2>
            <div className={styles.paginationMeta}>
              <span>{pagination.total} total stories</span>
            </div>
          </div>

          {items.length ? (
            <div className={styles.list}>
              {items.map((item) => (
                <article key={item.id} className={`${styles.item} ${item.thumbnail_url ? "" : styles.itemNoThumb}`.trim()}>
                  <Link href={getArticleHref(item)} className={styles.itemLink}>
                    {item.thumbnail_url ? (
                      <div className={styles.mediaLink}>
                        <img src={getCompactThumbnailUrl(item.thumbnail_url) || item.thumbnail_url} alt="" className={styles.thumb} />
                      </div>
                    ) : null}

                    <div className={styles.itemBody}>
                      <div className={styles.itemMeta}>
                        <span>{item.source}</span>
                        <span>{formatPublishedDate(item.published_at)}</span>
                      </div>
                      {item.characters?.length ? (
                        <div className={styles.pillRow}>
                          {item.characters.map((character) => (
                            <ChannelTickerPill
                              key={`${item.id}-${character.name}`}
                              channel={character}
                              className={styles.compactPill}
                              disableLink
                            />
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.headlineLink}>
                        <h3 className={styles.itemHeadline}>{item.headline}</h3>
                      </div>
                      {item.summary ? <p className={styles.itemSummary}>{item.summary}</p> : null}
                      <div className={styles.engagementRow}>
                        <EngagementStat kind="likes" value={item.like_count} />
                        <EngagementStat kind="comments" value={item.comment_count} />
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            !isLoading ? <div className={styles.empty}>No news items matched the current filters.</div> : null
          )}

          <div className={styles.paginationRow}>
            <button
              type="button"
              className={styles.paginationButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={isLoading || !pagination.has_previous_page}
            >
              Previous
            </button>
            <div className={styles.pageStatus}>Page {pagination.page} of {pagination.page_count}</div>
            <button
              type="button"
              className={styles.paginationButton}
              onClick={() => setPage((current) => current + 1)}
              disabled={isLoading || !pagination.has_next_page}
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
