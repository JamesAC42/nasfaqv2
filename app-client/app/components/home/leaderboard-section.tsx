import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtNumber, fmtPct } from "@/app/lib/format";
import type { LeaderboardEntry } from "@/app/lib/types";
import styles from "@/app/components/home/leaderboard-section.module.scss";

type LeaderboardSectionProps = {
  entries: LeaderboardEntry[];
  error: string | null;
  title?: string;
  limit?: number;
};

function initialsFor(username: string) {
  return username.trim().slice(0, 2).toUpperCase() || "NA";
}

export function LeaderboardSection({
  entries,
  error,
  title = "Leaderboard",
  limit = 5,
}: LeaderboardSectionProps) {
  const visibleEntries = entries.slice(0, limit);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <Link href="/leaderboard" className={styles.link}>Full board</Link>
      </div>
      {visibleEntries.length ? (
        <div className={styles.rows}>
          {visibleEntries.map((entry) => (
            <div key={entry.id} className={styles.row}>
              <div className={styles.rank}>#{entry.rank}</div>
              <div className={styles.identity}>
                <div
                  className={styles.avatar}
                  style={entry.profile_color ? ({ "--leaderboard-accent": entry.profile_color } as CSSProperties) : undefined}
                >
                  {entry.profile_picture_url ? <img src={entry.profile_picture_url} alt="" className={styles.avatarImage} /> : initialsFor(entry.username)}
                </div>
                <div className={styles.meta}>
                  <strong>{entry.label}</strong>
                  <span>{entry.best_asset ? `Best pick ${entry.best_asset.symbol}` : "Building their stack"}</span>
                </div>
              </div>
              <div className={styles.metrics}>
                <strong>{fmtNumber(entry.total_equity, "$")}</strong>
                <span className={(entry.change_pct ?? 0) >= 0 ? styles.positive : styles.negative}>
                  {entry.change_pct === null || entry.change_pct === undefined ? "—" : `${entry.change_pct > 0 ? "+" : ""}${fmtPct(entry.change_pct)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>{error ? `Leaderboard unavailable: ${error}` : "No leaderboard entries yet."}</div>
      )}
    </section>
  );
}
