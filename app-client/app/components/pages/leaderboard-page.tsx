"use client";

import { useEffect } from "react";
import { LeaderboardSection } from "@/app/components/home/leaderboard-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import styles from "@/app/components/pages/page-shell.module.scss";

export function LeaderboardPage() {
  const entries = useLeaderboardStore((state) => state.entries);
  const error = useLeaderboardStore((state) => state.error);
  const isLoading = useLeaderboardStore((state) => state.isLoading);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Leaderboard</h1>
          <p className={styles.copy}>The leaderboard has been moved off the homepage and into a dedicated route.</p>
        </section>

        {isLoading && !entries.length ? <div className={styles.panel}>Loading leaderboard…</div> : null}
        <LeaderboardSection entries={entries} error={error} />
      </div>
    </SiteShell>
  );
}
