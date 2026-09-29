import type { Metadata } from "next";
import { SiteShell } from "@/app/components/layout/site-shell";
import { CHANGELOG, type ChangeKind } from "@/app/lib/changelog";
import styles from "@/app/changelog/changelog.module.scss";

export const metadata: Metadata = {
  title: "What's new | NASFAQ",
  description: "What changed on NASFAQ in each update: new features, improvements and fixes.",
};

const DISCORD = "https://discord.gg/Bw4S6EbBNW";
const KIND_LABEL: Record<ChangeKind, string> = { new: "New", improved: "Better", fixed: "Fixed" };

const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  return (
    <SiteShell>
      <article className={styles.page}>
        <header className={styles.head}>
          <h1>What&apos;s new</h1>
          <p>
            Every update that changes something you&apos;d notice, newest first. Something broken, or something you&apos;d like? Say so in the{" "}
            <a href={DISCORD} target="_blank" rel="noopener noreferrer">
              Discord
            </a>
            .
          </p>
        </header>
        <ol className={styles.entries}>
          {CHANGELOG.map((entry) => (
            <li key={`${entry.date}-${entry.title}`} className={styles.entry}>
              <time dateTime={entry.date} className={styles.date}>
                {dateLabel(entry.date)}
              </time>
              <h2>{entry.title}</h2>
              <ul className={styles.changes}>
                {entry.changes.map((change, index) => (
                  <li key={index}>
                    <span className={styles.kind} data-kind={change.kind}>
                      {KIND_LABEL[change.kind]}
                    </span>
                    <span>{change.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </article>
    </SiteShell>
  );
}
