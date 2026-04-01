import Link from "next/link";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { fmtInteger } from "@/app/lib/format";
import type { LivestreamItem } from "@/app/lib/types";
import styles from "@/app/components/home/livestream-section.module.scss";

function topLivestreams(items: LivestreamItem[]) {
  return [...items]
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0))
    .slice(0, 4);
}

export function LivestreamSection({ items, error }: { items: LivestreamItem[]; error: string | null }) {
  const streams = topLivestreams(items);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Top Livestreams</h2>
          <p className={styles.copy}>The most active live channels right now, lifted into a dedicated home panel below the news feed.</p>
        </div>
        <Link href="/livestreams" className={styles.viewAllLink}>
          View all streams
        </Link>
      </div>

      {error ? <div className={styles.empty}>Livestream feed unavailable: {error}</div> : null}

      {streams.length ? (
        <div className={styles.grid}>
          {streams.map((item) => (
            <article key={item.id} className={styles.card}>
              {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
              <div className={styles.body}>
                <div className={styles.row}>
                  <span className={styles.livePill}>Live</span>
                  <span className={styles.viewerCount}>{fmtInteger(item.viewer_count)} viewers</span>
                </div>
                <strong className={styles.streamTitle}>{item.title}</strong>
                <div className={styles.creatorRow}>
                  <AssetCoin symbol={item.creator.slice(0, 1)} icon={item.creator_icon} className={styles.creatorIcon} />
                  <span>{item.creator}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : !error ? (
        <div className={styles.empty}>No live channels are available right now.</div>
      ) : null}
    </section>
  );
}
