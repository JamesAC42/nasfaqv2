import { fmtDate, fmtInteger } from "@/app/lib/format";
import type { LivestreamItem } from "@/app/lib/types";
import styles from "@/app/components/home/livestream-section.module.scss";

export function LivestreamSection({ items, error }: { items: LivestreamItem[]; error: string | null }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Livestreams</h2>
      {items.length ? (
        <div className={styles.list}>
          {items.slice(0, 5).map((item) => (
            <article key={item.id} className={styles.item}>
              <strong>{item.title}</strong>
              <div>{item.creator}</div>
              <div className={styles.meta}>Viewers {fmtInteger(item.viewer_count)} · Started {fmtDate(item.started_at)} · {item.status}</div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>{error ? `Livestream feed unavailable: ${error}` : "Livestream store scaffolded and ready for styling."}</div>
      )}
    </section>
  );
}
