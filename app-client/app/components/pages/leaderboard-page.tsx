"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteShell } from "@/app/components/layout/site-shell";
import { LoadingSpinner } from "@/app/components/common/loading-spinner";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { LeaderboardEntry, LeaderboardScope, LeaderboardWindow } from "@/app/lib/types";
import { useAuthStore } from "@/app/stores/auth-store";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import pageStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/leaderboard-page.module.scss";

const SCOPE_OPTIONS: Array<{ value: LeaderboardScope; label: string }> = [
  { value: "global", label: "Global" },
  { value: "friends", label: "Friends" },
  { value: "rivals", label: "Rivals" },
];

const WINDOW_OPTIONS: Array<{ value: LeaderboardWindow; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "all", label: "All Time" },
];

function initialsFor(username: string) {
  return username.trim().slice(0, 2).toUpperCase() || "NA";
}

function AchievementRow({ entry }: { entry: LeaderboardEntry }) {
  const chips = entry.achievements.length
    ? entry.achievements.slice(0, 3).map((achievement) => ({
        key: achievement.key,
        label: achievement.name,
        color: achievement.badge_color,
      }))
    : entry.badges.slice(0, 3).map((badge) => ({
        key: badge,
        label: badge,
        color: null,
      }));

  return (
    <div className={styles.badgeRow}>
      {entry.streaks.current_streak_days > 0 ? (
        <span className={styles.streakBadge}>{entry.streaks.current_streak_days}d streak</span>
      ) : null}
      {chips.length ? chips.map((chip) => (
        <span
          key={chip.key}
          className={styles.badge}
          style={chip.color ? ({ "--leaderboard-badge-accent": chip.color } as CSSProperties) : undefined}
        >
          {chip.label}
        </span>
      )) : <span className={styles.badgeMuted}>No badge</span>}
    </div>
  );
}

function LeaderboardIdentity({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className={styles.identity}>
      <div
        className={styles.avatar}
        style={entry.profile_color ? ({ "--leaderboard-accent": entry.profile_color } as CSSProperties) : undefined}
      >
        {entry.profile_picture_url ? (
          <img src={entry.profile_picture_url} alt="" className={styles.avatarImage} />
        ) : (
          initialsFor(entry.username)
        )}
      </div>
      <div className={styles.identityMeta}>
        <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.profileLink}>
          {entry.username}
        </Link>
        <div className={styles.identityFlags}>
          {entry.is_me ? <span className={styles.badge}>You</span> : null}
          {!entry.is_me && entry.is_friend ? <span className={styles.badge}>Friend</span> : null}
          {!entry.is_me && entry.is_rival ? <span className={styles.badge}>Rival</span> : null}
        </div>
      </div>
    </div>
  );
}

function PodiumCard({ entry, tone }: { entry: LeaderboardEntry; tone: "gold" | "silver" | "bronze" }) {
  return (
    <article className={`${styles.podiumCard} ${styles[tone]}`}>
      <div className={styles.podiumRank}>#{entry.rank}</div>
      <LeaderboardIdentity entry={entry} />
      <strong className={styles.podiumValue}>{fmtNumber(entry.total_equity, "$")}</strong>
      <span className={(entry.change_pct ?? 0) >= 0 ? pageStyles.positive : pageStyles.negative}>
        {entry.change_pct === null ? "—" : `${entry.change_pct > 0 ? "+" : ""}${fmtPct(entry.change_pct)}`}
      </span>
      <div className={styles.podiumMeta}>
        <span>{entry.streaks.current_streak_days > 0 ? `${fmtInteger(entry.streaks.current_streak_days)} day current streak` : "No active streak"}</span>
        <span>{entry.streaks.longest_streak_days > 0 ? `Best streak ${fmtInteger(entry.streaks.longest_streak_days)} days` : "No recorded streak"}</span>
        <span>{entry.largest_position ? `Largest bag ${entry.largest_position.symbol}` : "No concentrated bag yet"}</span>
        <span>{entry.best_asset ? `Best pick ${entry.best_asset.symbol}` : "Still flat across picks"}</span>
      </div>
      <AchievementRow entry={entry} />
    </article>
  );
}

export function LeaderboardPage() {
  const user = useAuthStore((state) => state.user);
  const entries = useLeaderboardStore((state) => state.entries);
  const me = useLeaderboardStore((state) => state.me);
  const stats = useLeaderboardStore((state) => state.stats);
  const pagination = useLeaderboardStore((state) => state.pagination);
  const error = useLeaderboardStore((state) => state.error);
  const isLoading = useLeaderboardStore((state) => state.isLoading);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [window, setWindow] = useState<LeaderboardWindow>("1d");

  useEffect(() => {
    void fetchLeaderboard({ scope, window, page: 1, limit: 25 });
  }, [fetchLeaderboard, scope, window]);

  const topThree = entries.slice(0, 3);
  const tableRows = entries.slice(3);

  return (
    <SiteShell>
      <div className={pageStyles.stack}>
        <section className={pageStyles.hero}>
          <h1 className={pageStyles.title}>Leaderboard</h1>
          <p className={pageStyles.copy}>
            Track the richest desks on NASFAQ by live net worth, follow your rivals, and see how far you are from the next spot.
          </p>
          <div className={styles.heroMeta}>
            <span>{fmtInteger(stats.user_count)} tracked users</span>
            <span>Updated {fmtDate(stats.last_updated_at)}</span>
            {stats.cutoff_equity_top_10 !== null ? <span>Top 10 cutoff {fmtNumber(stats.cutoff_equity_top_10, "$")}</span> : null}
          </div>
        </section>

        <section className={pageStyles.panel}>
          <div className={styles.controlRow}>
            <div className={styles.controlGroup}>
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={scope === option.value ? styles.controlActive : styles.controlButton}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.controlGroup}>
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={window === option.value ? styles.controlActive : styles.controlButton}
                  onClick={() => setWindow(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {scope !== "global" && !user ? (
            <div className={styles.inlineNotice}>Log in to compare against your {scope} leaderboard.</div>
          ) : null}
        </section>

        {me ? (
          <section className={`${pageStyles.panel} ${styles.meCard}`}>
            <div>
              <div className={styles.eyebrow}>Your position</div>
              <div className={styles.meRank}>#{me.rank}</div>
              <div className={styles.meMeta}>
                <span>{fmtNumber(me.total_equity, "$")} net worth</span>
                <span className={(me.change_pct ?? 0) >= 0 ? pageStyles.positive : pageStyles.negative}>
                  {me.change_pct === null ? "—" : `${me.change_pct > 0 ? "+" : ""}${fmtPct(me.change_pct)}`}
                </span>
                <span>{(Math.max(0, me.percentile) * 100).toFixed(1)} percentile</span>
                <span>{me.streaks.current_streak_days}d current streak</span>
                <span>{me.streaks.longest_streak_days}d best streak</span>
              </div>
            </div>
            <div className={styles.neighbors}>
              {me.neighbors.length ? me.neighbors.map((neighbor) => (
                <div key={neighbor.user_id} className={styles.neighbor}>
                  <span>#{neighbor.rank} {neighbor.username}</span>
                  <strong>{fmtNumber(neighbor.total_equity, "$")}</strong>
                  <span>{neighbor.gap_abs === null ? "—" : `${neighbor.gap_abs > 0 ? "+" : ""}${fmtNumber(neighbor.gap_abs, "$")}`}</span>
                </div>
              )) : <div className={styles.inlineNotice}>No nearby users in this scope yet.</div>}
            </div>
          </section>
        ) : null}

        {isLoading && !entries.length ? (
          <div className={pageStyles.panel}>
            <LoadingSpinner label="Loading leaderboard" />
          </div>
        ) : null}

        {error && !entries.length ? (
          <div className={pageStyles.panel}>
            <div className={styles.inlineNotice}>
              {error === "unauthenticated" ? "Log in to open this scoped leaderboard." : `Leaderboard unavailable: ${error}`}
            </div>
          </div>
        ) : null}

        {topThree.length ? (
          <section className={styles.podiumGrid}>
            {topThree[1] ? <PodiumCard entry={topThree[1]} tone="silver" /> : null}
            {topThree[0] ? <PodiumCard entry={topThree[0]} tone="gold" /> : null}
            {topThree[2] ? <PodiumCard entry={topThree[2]} tone="bronze" /> : null}
          </section>
        ) : null}

        <section className={pageStyles.panel}>
          <div className={styles.tableHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Standings</h2>
              <p className={styles.sectionCopy}>Current equity decides rank. The selected window controls the move column.</p>
            </div>
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => void fetchLeaderboard({ scope, window, page: pagination.page - 1, limit: pagination.limit })}
                disabled={!pagination.has_previous_page || isLoading}
              >
                Prev
              </button>
              <span>Page {pagination.page} / {pagination.page_count}</span>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => void fetchLeaderboard({ scope, window, page: pagination.page + 1, limit: pagination.limit })}
                disabled={!pagination.has_next_page || isLoading}
              >
                Next
              </button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Net Worth</th>
                  <th>Move</th>
                  <th>Largest Bag</th>
                  <th>Best Pick</th>
                  <th>Badges</th>
                </tr>
              </thead>
              <tbody>
                {(tableRows.length ? tableRows : entries).map((entry) => (
                  <tr key={entry.id} className={entry.is_me ? styles.rowHighlight : undefined}>
                    <td>#{entry.rank}</td>
                    <td><LeaderboardIdentity entry={entry} /></td>
                    <td>
                      <div className={styles.metricCell}>
                        <strong>{fmtNumber(entry.total_equity, "$")}</strong>
                        <span>{fmtNumber(entry.cash_balance, "$")} cash</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.metricCell}>
                        <strong className={(entry.change_pct ?? 0) >= 0 ? pageStyles.positive : pageStyles.negative}>
                          {entry.change_pct === null ? "—" : `${entry.change_pct > 0 ? "+" : ""}${fmtPct(entry.change_pct)}`}
                        </strong>
                        <span>{entry.change_abs === null ? "—" : `${entry.change_abs > 0 ? "+" : ""}${fmtNumber(entry.change_abs, "$")}`}</span>
                      </div>
                    </td>
                    <td>{entry.largest_position ? `${entry.largest_position.symbol} · ${fmtNumber(entry.largest_position.value, "$")}` : "—"}</td>
                    <td>{entry.best_asset ? `${entry.best_asset.symbol} · ${fmtNumber(entry.best_asset.unrealized_pnl, "$")}` : "—"}</td>
                    <td>
                      <AchievementRow entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
