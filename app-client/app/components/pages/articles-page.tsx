"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { OptionPicker } from "@/app/components/common/option-picker";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
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

function formatDate(value: string | null) {
  if (!value) return "Unpublished";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <Link href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.cardLink}>
      <article className={styles.articleCard}>
        {article.thumbnail_url ? <img src={article.thumbnail_url} alt="" className={styles.thumb} /> : null}
        <div className={styles.cardBody}>
          <div className={styles.metaRow}>
            <span className={styles.pill}>{article.is_news ? "News" : "Community"}</span>
            <span className={styles.statusPill}>{formatDate(article.published_at)}</span>
          </div>
          <h2 className={styles.cardTitle}>{article.title}</h2>
          {article.subtitle ? <p className={styles.copy}>{article.subtitle}</p> : null}
          {article.preview ? <p className={styles.copy}>{article.preview}</p> : null}
          <div className={styles.metaRow}>
            <span className={styles.muted}>{article.author ? `By ${article.author.username}` : "Imported news item"}</span>
            <span className={styles.muted}>{article.likes} likes</span>
            <span className={styles.muted}>{article.comment_count} comments</span>
          </div>
          {article.related_assets.length ? (
            <div className={styles.assetRow}>
              {article.related_assets.slice(0, 4).map((asset) => (
                <span key={asset.id} className={styles.assetPill}>{asset.symbol}</span>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    </Link>
  );
}

export function ArticlesPage() {
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const marketError = useMarketStore((state) => state.error);

  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [pagination, setPagination] = useState<NewsFeedPagination>(DEFAULT_PAGINATION);
  const [type, setType] = useState("all");
  const [asset, setAsset] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadArticles() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "12");
        params.set("page", String(page));
        if (type !== "all") params.set("type", type);
        if (asset) params.set("asset", asset);
        if (query.trim()) params.set("q", query.trim());
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
  }, [asset, page, query, type]);

  useEffect(() => {
    setPage(1);
  }, [asset, query, type]);

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

        <section className={styles.panel}>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Search</span>
              <input
                className={styles.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, subtitles, or tags"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Type</span>
              <OptionPicker
                value={type}
                onChange={setType}
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
                value={asset}
                onChange={setAsset}
                placeholder="Filter by asset"
                emptyLabel="All assets"
              />
            </label>
          </div>
        </section>

        <section className={styles.panel}>
          {isLoading && !items.length ? <div className={styles.empty}>Loading articles…</div> : null}
          {!isLoading && !items.length ? <div className={styles.empty}>No articles matched the current filters.</div> : null}
          {items.length ? (
            <div className={styles.grid}>
              {items.map((article) => <ArticleCard key={article.id} article={article} />)}
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
