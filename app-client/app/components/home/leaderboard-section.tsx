import { fmtNumber, fmtPct } from "@/app/lib/format";
import type { LeaderboardEntry } from "@/app/lib/types";
import styles from "@/app/components/home/leaderboard-section.module.scss";

export function LeaderboardSection({ entries, error }: { entries: LeaderboardEntry[]; error: string | null }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Leaderboard</h2>
      {entries.length ? (
        <ol className={styles.list}>
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.id}>
              #{entry.rank} <strong>{entry.label}</strong> {fmtNumber(entry.value, "$")} {entry.change_pct !== null && entry.change_pct !== undefined ? `(${fmtPct(entry.change_pct)})` : ""}
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.empty}>{error ? `Leaderboard unavailable: ${error}` : "Leaderboard store scaffolded and ready for wiring to a backend feed."}</div>
      )}
    </section>
  );
}
