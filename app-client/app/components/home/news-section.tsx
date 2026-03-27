import { fmtDate } from "@/app/lib/format";
import { fmtPct } from "@/app/lib/format";
import type { MarketAsset, NewsItem } from "@/app/lib/types";
import styles from "@/app/components/home/news-section.module.scss";

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function RelatedTickerPills({ item, assets }: { item: NewsItem; assets: MarketAsset[] }) {
  const byName = new Map<string, MarketAsset>();
  for (const asset of assets) {
    byName.set(normalizeName(asset.display_name), asset);
  }

  const relatedAssets = (item.related_names || [])
    .map((name) => byName.get(normalizeName(name)))
    .filter((asset): asset is MarketAsset => Boolean(asset));

  if (!relatedAssets.length) return null;

  return (
    <div className={styles.pillRow}>
      {relatedAssets.map((asset) => {
        const tone = (asset.move_24h_pct ?? 0) >= 0 ? styles.pillUp : styles.pillDown;
        return (
          <span key={`${item.id}-${asset.symbol}`} className={`${styles.tickerPill} ${tone}`}>
            <strong>{asset.symbol}</strong>
            <span>{asset.display_name}</span>
            <span>{fmtPct(asset.move_24h_pct)}</span>
          </span>
        );
      })}
    </div>
  );
}

export function NewsSection({ items, assets, error }: { items: NewsItem[]; assets: MarketAsset[]; error: string | null }) {
  const featured = items.filter((item) => item.thumbnail_url);
  const headlines = items.filter((item) => !item.thumbnail_url);

  return (
    <section className={styles.section}>
      <div>
        <h2 className={styles.title}>News</h2>
      </div>
      {items.length ? (
        <>
          {featured.length ? (
            <div className={styles.featuredList}>
              {featured.map((item, index) => (
                <article key={item.id} className={index === 0 ? `${styles.item} ${styles.itemLead}` : `${styles.item} ${styles.itemFeatured}`}>
                  {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={index === 0 ? styles.leadThumb : styles.thumb} /> : null}
                  <div className={styles.itemBody}>
                    <div className={index === 0 ? styles.leadKicker : styles.featuredKicker}>{index === 0 ? "Lead Story" : "Featured"}</div>
                    <strong className={index === 0 ? styles.leadHeadline : styles.headline}>{item.headline}</strong>
                    <div className={styles.meta}>{fmtDate(item.published_at)} · {item.source}</div>
                    {item.summary ? <div className={styles.summary}>{item.summary}</div> : null}
                    <RelatedTickerPills item={item} assets={assets} />
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {headlines.length ? (
            <div className={styles.list}>
              {headlines.map((item) => (
                <article key={item.id} className={styles.item}>
                  <div className={styles.itemBody}>
                    <strong className={styles.headline}>{item.headline}</strong>
                    <div className={styles.meta}>{fmtDate(item.published_at)} · {item.source}</div>
                    {item.summary ? <div className={styles.summary}>{item.summary}</div> : null}
                    <RelatedTickerPills item={item} assets={assets} />
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.empty}>{error ? `News feed unavailable: ${error}` : "News store scaffolded and ready for a real feed."}</div>
      )}
    </section>
  );
}
