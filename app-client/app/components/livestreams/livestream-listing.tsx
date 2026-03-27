"use client";

import { useEffect } from "react";
import { fmtDate, fmtInteger } from "@/app/lib/format";
import { getIconUrl } from "@/app/lib/normalizers";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import styles from "@/app/components/livestreams/livestream-listing.module.scss";

export function LivestreamListing() {
  const items = useLivestreamStore((state) => state.items);
  const error = useLivestreamStore((state) => state.error);
  const isLoading = useLivestreamStore((state) => state.isLoading);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);

  useEffect(() => {
    void fetchLivestreams();
  }, [fetchLivestreams]);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Livestreams</h1>
          <p className={styles.copy}>Current live streams ranked by viewer count.</p>
        </div>
      </div>

      {error ? <div className={styles.empty}>Livestream feed unavailable: {error}</div> : null}
      {isLoading && !items.length ? <div className={styles.empty}>Loading livestreams…</div> : null}

      <div className={styles.list}>
        {items.map((item) => (
          <article key={item.id} className={styles.card}>
            {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
            <div className={styles.body}>
              <strong className={styles.cardTitle}>{item.title}</strong>
              <div className={styles.meta}>
                {getIconUrl(item.creator_icon) ? <img src={getIconUrl(item.creator_icon) || ""} alt="" className={styles.icon} /> : null}
                <span>{item.creator}</span>
              </div>
              <div className={styles.stats}>
                <span className={styles.livePill}>LIVE</span>
                <span>{fmtInteger(item.viewer_count)} viewers</span>
                <span>Started {fmtDate(item.started_at)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
