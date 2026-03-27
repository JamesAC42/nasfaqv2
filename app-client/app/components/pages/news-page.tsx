"use client";

import { useEffect } from "react";
import { NewsSection } from "@/app/components/home/news-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useMarketStore } from "@/app/stores/market-store";
import { useNewsStore } from "@/app/stores/news-store";
import styles from "@/app/components/pages/page-shell.module.scss";

export function NewsPage() {
  const assets = useMarketStore((state) => state.assets);
  const marketError = useMarketStore((state) => state.error);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);

  const items = useNewsStore((state) => state.items);
  const error = useNewsStore((state) => state.error);
  const isLoading = useNewsStore((state) => state.isLoading);
  const fetchNews = useNewsStore((state) => state.fetchNews);

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchNews()]);
  }, [fetchNews, refreshOverview]);

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>News</h1>
          <p className={styles.copy}>Market headlines and related tickers now live on their own route instead of sharing space with the trading dashboard.</p>
        </section>

        {marketError ? <div className="statusMessage statusMessageError">Request error: {marketError}</div> : null}
        {isLoadingOverview || (isLoading && !items.length) ? <div className={styles.panel}>Loading news feed…</div> : null}

        <NewsSection items={items} assets={assets} error={error} />
      </div>
    </SiteShell>
  );
}
