"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { SiteShell } from "@/app/components/layout/site-shell";
import { OshiboardTab } from "@/app/components/leaderboard/oshiboard-tab";
import { formatEtTime } from "@/app/lib/market-clock";
import { money, signedPct, toneOf } from "@/app/lib/time";
import type { LeaderboardEntry, LeaderboardScope, LeaderboardWindow, MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/leaderboard/leaderboard.module.scss";

export type LeaderboardTab = "players" | "talent";

const SCOPES: Array<[LeaderboardScope, string]> = [
  ["global", "GLOBAL"],
  ["friends", "FRIENDS"],
  ["rivals", "RIVALS"],
];
const WINDOWS: Array<[LeaderboardWindow, string]> = [
  ["1d", "1D"],
  ["7d", "7D"],
  ["all", "ALL TIME"],
];
const WINDOW_LABEL: Record<LeaderboardWindow, string> = { "1d": "Today", "7d": "7 days", all: "All-time" };

export function Leaderboard({ tab, coin }: { tab: LeaderboardTab; coin?: string }) {
  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <h1>Leaderboard</h1>
            <p>Every player ranked by net worth, updated as trades fill.</p>
          </div>
          <nav className={styles.tabs} aria-label="Leaderboard">
            <Link href="/leaderboard" aria-current={tab === "players" ? "page" : undefined} scroll={false}>
              PLAYERS
            </Link>
            <Link href="/leaderboard?tab=talent" aria-current={tab === "talent" ? "page" : undefined} scroll={false}>
              BY TALENT · OSHIBOARDS
            </Link>
          </nav>
        </header>
        {tab === "talent" ? <OshiboardTab initialCoin={coin} /> : <PlayersTab />}
      </div>
    </SiteShell>
  );
}

// ── Players ──────────────────────────────────────────────────────────────
function useAssetLookup() {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(() => new Map<string, MarketAsset>(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
}

function windowChange(entry: LeaderboardEntry, window: LeaderboardWindow) {
  if (window === "1d") return entry.daily_change_pct ?? entry.change_pct;
  if (window === "7d") return entry.weekly_change_pct ?? entry.change_pct;
  return entry.change_pct;
}

function Badges({ entry }: { entry: LeaderboardEntry }) {
  const chips = entry.achievements.length ? entry.achievements.map((a) => ({ key: a.key, name: a.name, color: a.badge_color, description: a.description })) : entry.badges.map((name) => ({ key: name, name, color: null, description: null }));
  if (!chips.length) return <span className={styles.noBadge} title="No badges yet" />;
  return (
    <span className={styles.badges}>
      {chips.slice(0, 4).map((chip) => (
        <i key={chip.key} style={{ "--bc": chip.color || "var(--blue)" } as React.CSSProperties} title={chip.description ? `${chip.name}: ${chip.description}` : chip.name}>
          {chip.name.slice(0, 1)}
        </i>
      ))}
      {chips.length > 4 ? <small>+{chips.length - 4}</small> : null}
    </span>
  );
}

function PlayersTab() {
  const { user } = useAuth();
  const entries = useLeaderboardStore((state) => state.entries);
  const me = useLeaderboardStore((state) => state.me);
  const stats = useLeaderboardStore((state) => state.stats);
  const pagination = useLeaderboardStore((state) => state.pagination);
  const isLoading = useLeaderboardStore((state) => state.isLoading);
  const error = useLeaderboardStore((state) => state.error);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);
  const bySymbol = useAssetLookup();
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [window, setWindow] = useState<LeaderboardWindow>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    void fetchLeaderboard({ scope, window, page, limit: 25 });
  }, [fetchLeaderboard, page, scope, window, user]);

  const leader = entries.find((entry) => entry.rank === 1) ?? null;
  const podium = page === 1 && entries.length >= 3 ? [entries[1], entries[0], entries[2]] : [];
  const updated = stats.last_updated_at ? new Date(stats.last_updated_at) : null;

  const icon = (symbol: string | undefined | null) => (symbol ? bySymbol.get(symbol.toUpperCase())?.icon : null);

  return (
    <>
      <div className={styles.kstrip}>
        <div>
          <span className={styles.label}>Tracked players</span>
          <b>{stats.user_count.toLocaleString("en-US")}</b>
          <small>on the board</small>
        </div>
        <div>
          <span className={styles.label}>Updated</span>
          <b suppressHydrationWarning>{updated ? `${formatEtTime(updated)} ET` : "—"}</b>
          <small>last refresh</small>
        </div>
        <div>
          <span className={styles.label}>Desk to beat</span>
          <b className={styles.ellipsis}>
            {leader ? (
              <>
                {leader.largest_position ? <Oshimark icon={icon(leader.largest_position.symbol)} symbol={leader.largest_position.symbol} size={16} /> : null} {leader.username}
              </>
            ) : (
              "—"
            )}
          </b>
          <small>{leader ? money(leader.total_equity) : " "}</small>
        </div>
        <div>
          <span className={styles.label}>Top 10 cutoff</span>
          <b>{money(stats.cutoff_equity_top_10)}</b>
          <small>net worth</small>
        </div>
        <div>
          <span className={styles.label}>Top 100 cutoff</span>
          <b>{money(stats.cutoff_equity_top_100)}</b>
          <small>net worth</small>
        </div>
        <div>
          <span className={styles.label}>You</span>
          <b>{me ? `#${me.rank.toLocaleString("en-US")}` : "—"}</b>
          <small>{me ? `top ${Math.max(0.1, (1 - me.percentile) * 100).toFixed(1)}%` : user ? "make a trade to rank" : "sign in to rank"}</small>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.seg} role="group" aria-label="Who">
          {SCOPES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => (setScope(value), setPage(1))} disabled={value !== "global" && !user} title={value !== "global" && !user ? "Sign in to see friends and rivals" : undefined}>
              {label}
            </button>
          ))}
        </div>
        <div className={styles.seg} role="group" aria-label="Window">
          {WINDOWS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={window === value} onClick={() => (setWindow(value), setPage(1))}>
              {label}
            </button>
          ))}
        </div>
        <span className={styles.aside}>ranked by net worth · change over {WINDOW_LABEL[window].toLowerCase()}</span>
      </div>

      {podium.length ? (
        <div className={styles.podium}>
          {podium.map((entry) => {
            const change = windowChange(entry, window);
            return (
              <Link key={entry.user_id} href={`/profile/${encodeURIComponent(entry.username)}`} className={`${styles.step} ${styles[`r${entry.rank}`]}`} style={{ "--pc": entry.profile_color || "var(--blue)" } as React.CSSProperties}>
                <PlayerAvatar username={entry.username} pictureUrl={entry.profile_picture_url} color={entry.profile_color} hat={entry.equipped_hat} size={entry.rank === 1 ? 96 : 80} className={styles.stepAvatar} />
                <span className={styles.stepBody}>
                  <span className={styles.stepRank}>{entry.rank}</span>
                  <span className={styles.stepName}>
                    {entry.largest_position ? <Oshimark icon={icon(entry.largest_position.symbol)} symbol={entry.largest_position.symbol} size={18} /> : null}
                    {entry.username}
                  </span>
                  <span className={styles.stepEq}>{money(entry.total_equity)}</span>
                  <span className={styles.stepMeta}>
                    <span className={styles[toneOf(change)]}>{signedPct(change)}</span> {WINDOW_LABEL[window].toLowerCase()}
                    {entry.streaks.current_streak_days ? ` · ${entry.streaks.current_streak_days}d streak` : ""}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}

      {me ? (
        <div className={styles.me}>
          <div className={styles.meRank}>
            <span className={styles.label}>You are ranked</span>
            <b>#{me.rank.toLocaleString("en-US")}</b>
            <small>of {stats.user_count.toLocaleString("en-US")}</small>
          </div>
          <div>
            <span className={styles.label}>Net worth</span>
            <b>{money(me.total_equity)}</b>
          </div>
          <div>
            <span className={styles.label}>{WINDOW_LABEL[window]}</span>
            <b className={styles[toneOf(windowChange(me, window))]}>{signedPct(windowChange(me, window))}</b>
          </div>
          <div>
            <span className={styles.label}>Unrealized P/L</span>
            <b className={styles[toneOf(me.total_unrealized_pnl)]}>
              {me.total_unrealized_pnl >= 0 ? "+" : "−"}
              {money(Math.abs(me.total_unrealized_pnl))}
            </b>
          </div>
          <div>
            <span className={styles.label}>Streak</span>
            <b>{me.streaks.current_streak_days} days</b>
            <small>best {me.streaks.longest_streak_days}</small>
          </div>
          <div className={styles.near}>
            <span className={styles.label}>Closest ranks</span>
            {me.neighbors.length ? (
              me.neighbors.map((neighbor) => (
                <Link key={neighbor.user_id} href={`/profile/${encodeURIComponent(neighbor.username)}`}>
                  <span>#{neighbor.rank}</span>
                  <b>{neighbor.username}</b>
                  <em className={neighbor.rank < me.rank ? styles.down : styles.up} title={neighbor.rank < me.rank ? "to pass them" : "your lead"}>
                    {neighbor.gap_abs === null ? "—" : `${neighbor.rank < me.rank ? "−" : "+"}${money(Math.abs(neighbor.gap_abs))}`}
                  </em>
                </Link>
              ))
            ) : (
              <small>Nobody close yet.</small>
            )}
          </div>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.l}>#</th>
              <th className={styles.l}>Player</th>
              <th>Net worth</th>
              <th className={styles.hideS}>Exposure</th>
              <th>{WINDOW_LABEL[window]}</th>
              <th className={`${styles.l} ${styles.hideM}`}>Largest bag</th>
              <th className={`${styles.l} ${styles.hideM}`}>Best pick</th>
              <th className={`${styles.l} ${styles.hideS}`}>Badges</th>
              <th className={styles.hideS}>Streak</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const change = windowChange(entry, window);
              const exposure = entry.total_equity > 0 ? entry.holdings_market_value / entry.total_equity : 0;
              return (
                <tr key={entry.user_id} className={entry.is_me ? styles.mine : undefined}>
                  <td className={`${styles.l} ${styles.rank}`}>{entry.rank}</td>
                  <td className={styles.l}>
                    <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.who}>
                      <PlayerAvatar username={entry.username} pictureUrl={entry.profile_picture_url} color={entry.profile_color} hat={entry.equipped_hat} size={26} />
                      <b>{entry.username}</b>
                      {entry.is_me ? <span className={styles.tagMe}>YOU</span> : entry.is_friend ? <span className={styles.tag}>FRIEND</span> : entry.is_rival ? <span className={styles.tagRival}>RIVAL</span> : null}
                    </Link>
                  </td>
                  <td>{money(entry.total_equity)}</td>
                  <td className={styles.hideS}>
                    <span className={styles.expo} title={`${money(entry.holdings_market_value)} in stocks`}>
                      <i>
                        <s style={{ width: `${Math.min(100, exposure * 100)}%` }} />
                      </i>
                      {Math.round(exposure * 100)}%
                    </span>
                  </td>
                  <td className={styles[toneOf(change)]}>{signedPct(change)}</td>
                  <td className={`${styles.l} ${styles.hideM}`}>
                    {entry.largest_position ? (
                      <Link href={`/stocks/${encodeURIComponent(entry.largest_position.symbol)}`} className={styles.bag} data-peek-stock={entry.largest_position.symbol}>
                        <Oshimark icon={icon(entry.largest_position.symbol)} symbol={entry.largest_position.symbol} size={16} />
                        <b>{entry.largest_position.symbol}</b> {money(entry.largest_position.value, { compact: true })}
                      </Link>
                    ) : (
                      <span className={styles.dim}>all cash</span>
                    )}
                  </td>
                  <td className={`${styles.l} ${styles.hideM}`}>
                    {entry.best_asset ? (
                      <Link href={`/stocks/${encodeURIComponent(entry.best_asset.symbol)}`} className={styles.bag} data-peek-stock={entry.best_asset.symbol}>
                        <Oshimark icon={icon(entry.best_asset.symbol)} symbol={entry.best_asset.symbol} size={16} />
                        <b>{entry.best_asset.symbol}</b>
                        <span className={styles[toneOf(entry.best_asset.unrealized_pnl)]}>
                          {entry.best_asset.unrealized_pnl >= 0 ? "+" : "−"}
                          {money(Math.abs(entry.best_asset.unrealized_pnl), { compact: true })}
                        </span>
                      </Link>
                    ) : (
                      <span className={styles.dim}>—</span>
                    )}
                  </td>
                  <td className={`${styles.l} ${styles.hideS}`}>
                    <Badges entry={entry} />
                  </td>
                  <td className={styles.hideS}>{entry.streaks.current_streak_days ? <span className={styles.streak}>◆ {entry.streaks.current_streak_days}d</span> : <span className={styles.dim}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!entries.length ? <p className={styles.empty}>{isLoading ? "Loading the standings…" : error ? `Couldn't load the leaderboard (${error}).` : scope === "global" ? "Nobody ranked yet." : `No ${scope} yet. Add some from a profile page.`}</p> : null}
      </div>

      {pagination.page_count > 1 ? (
        <div className={styles.pager}>
          <button type="button" onClick={() => setPage(1)} disabled={page <= 1 || isLoading}>
            « TOP
          </button>
          <button type="button" onClick={() => setPage(page - 1)} disabled={!pagination.has_previous_page || isLoading}>
            ‹ PREV
          </button>
          <span>
            page {pagination.page.toLocaleString("en-US")} of {pagination.page_count.toLocaleString("en-US")}
          </span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={!pagination.has_next_page || isLoading}>
            NEXT ›
          </button>
          {me && me.rank > 25 ? (
            <button type="button" onClick={() => setPage(Math.ceil(me.rank / 25))} disabled={isLoading}>
              JUMP TO ME
            </button>
          ) : null}
        </div>
      ) : null}

      <p className={styles.foot}>Net worth is cash plus your stocks at the current mid price. Add friends and rivals from their profile pages; the Activity tape can filter to just their fills.</p>
    </>
  );
}
