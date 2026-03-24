import { fmtDate } from "@/app/lib/format";
import type { NewsItem } from "@/app/lib/types";
import styles from "@/app/components/home/news-section.module.scss";

export function NewsSection({ items, error }: { items: NewsItem[]; error: string | null }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>News</h2>
      {items.length ? (
        <div className={styles.list}>
          {items.slice(0, 5).map((item) => (
            <article key={item.id} className={styles.item}>
              <div className={styles.meta}>{item.source} · {fmtDate(item.published_at)}</div>
              <strong>{item.headline}</strong>
              {item.summary ? <div>{item.summary}</div> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>{error ? `News feed unavailable: ${error}` : "News store scaffolded and ready for a real feed."}</div>
      )}
    </section>
  );
}
