import { SiteShell } from "@/app/components/layout/site-shell";
import styles from "@/app/components/pages/page-shell.module.scss";

const articleCards = [
  {
    title: "Creator Thesis",
    copy: "Long-form breakdowns where users can publish conviction pieces on channels, catalysts, and valuation shifts.",
  },
  {
    title: "Watchlist Notes",
    copy: "Shorter market notes for event calendars, milestone tracking, and follow-up coverage after big moves.",
  },
  {
    title: "Draft Workspace",
    copy: "A dedicated surface for creating and managing community-authored articles once the submission flow is wired in.",
  },
];

export function ArticlesPage() {
  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Articles</h1>
          <p className={styles.copy}>This route is reserved for user-created articles. There is no article API in the current client yet, so the page is scaffolded and ready for the authoring flow.</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.grid}>
            {articleCards.map((card) => (
              <article key={card.title} className={styles.card}>
                <div className={styles.eyebrow}>User Content</div>
                <div className={styles.cardTitle}>{card.title}</div>
                <div className={styles.meta}>{card.copy}</div>
              </article>
            ))}
          </div>
          <div className={styles.empty}>Article creation, publishing, and listing can be wired here once the backend contract exists.</div>
        </section>
      </div>
    </SiteShell>
  );
}
