"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { useApi } from "@/app/components/stock/use-stock-data";
import { formatEtTime } from "@/app/lib/market-clock";
import { unitLabel } from "@/app/lib/market-units";
import { normalizeOshiboardResponse } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import type { OshiboardResponse } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/leaderboard/leaderboard.module.scss";

type BoardStat = { symbol: string; members: number; updated: string | null };

/** Per-talent boards: who holds each talent as their oshi and biggest bag. */
export function OshiboardTab({ initialCoin }: { initialCoin?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { theme } = useTheme();
  const assets = useMarketStore((state) => state.assets);
  const [query, setQuery] = useState("");
  const [coin, setCoin] = useState((initialCoin ?? "").toUpperCase());

  const counts = useApi<BoardStat[]>("/api/leaderboard/oshiboard-assets", (raw) =>
    (Array.isArray(raw.rows) ? (raw.rows as Array<Record<string, unknown>>) : []).map((row) => ({
      symbol: String(row.symbol || "").toUpperCase(),
      members: Number(row.member_count || 0),
      updated: row.last_updated_at ? String(row.last_updated_at) : null,
    })),
  );
  const bySym = useMemo(() => new Map((counts.data ?? []).map((row) => [row.symbol, row])), [counts.data]);
  const sorted = useMemo(
    () => [...assets].sort((a, b) => (bySym.get(b.symbol.toUpperCase())?.members ?? 0) - (bySym.get(a.symbol.toUpperCase())?.members ?? 0) || a.symbol.localeCompare(b.symbol)),
    [assets, bySym],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? sorted.filter((asset) => asset.symbol.toLowerCase().includes(needle) || asset.display_name.toLowerCase().includes(needle)) : sorted;
  }, [query, sorted]);

  const selected = coin || sorted[0]?.symbol.toUpperCase() || "";
  const asset = useMemo(() => assets.find((entry) => entry.symbol.toUpperCase() === selected) ?? null, [assets, selected]);
  const board = useApi<OshiboardResponse>(selected ? `/api/leaderboard/oshiboard/${encodeURIComponent(selected)}?limit=100` : null, normalizeOshiboardResponse);

  useEffect(() => {
    if (!coin) return;
    router.replace(`${pathname}?tab=talent&coin=${encodeURIComponent(coin)}`, { scroll: false });
  }, [coin, pathname, router]);

  const totalPlayers = (counts.data ?? []).reduce((sum, row) => sum + row.members, 0);
  const biggest = sorted[0];
  const updated = (counts.data ?? []).reduce<string | null>((latest, row) => (row.updated && (!latest || row.updated > latest) ? row.updated : latest), null);
  const stats = board.data?.stats;
  const entries = board.data?.entries ?? [];
  const circulating = asset?.circulating_supply ?? null;
  const mine = user ? entries.find((entry) => entry.user_id === user.id) : undefined;
  const accent = asset ? talentAccent(asset.color, theme) : "var(--blue)";

  return (
    <>
      <div className={styles.kstrip}>
        <div>
          <span className={styles.label}>Talents</span>
          <b>{assets.length || "—"}</b>
          <small>each has a board</small>
        </div>
        <div>
          <span className={styles.label}>Oshiboard players</span>
          <b>{totalPlayers.toLocaleString("en-US")}</b>
          <small>holding their oshi</small>
        </div>
        <div>
          <span className={styles.label}>Biggest board</span>
          <b className={styles.ellipsis}>
            {biggest ? (
              <>
                <Oshimark icon={biggest.icon} symbol={biggest.symbol} size={16} /> {biggest.symbol} · {bySym.get(biggest.symbol.toUpperCase())?.members ?? 0}
              </>
            ) : (
              "—"
            )}
          </b>
          <small>members</small>
        </div>
        <div>
          <span className={styles.label}>Your spot</span>
          <b>{mine ? `#${mine.rank}` : "—"}</b>
          <small>{mine ? `on ${selected}` : user ? `not on ${selected || "this"} board` : "sign in"}</small>
        </div>
        <div>
          <span className={styles.label}>Updated</span>
          <b suppressHydrationWarning>{updated ? `${formatEtTime(new Date(updated))} ET` : "—"}</b>
          <small>last refresh</small>
        </div>
        <div>
          <span className={styles.label}>Rule</span>
          <b>Largest bag + oshi</b>
          <small>to qualify</small>
        </div>
      </div>

      <div className={styles.oshi}>
        <aside className={styles.picker}>
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search talent" aria-label="Search talent" />
          </label>
          <div className={styles.grid} role="listbox" aria-label="Talents">
            {visible.map((entry) => {
              const sym = entry.symbol.toUpperCase();
              return (
                <button key={sym} type="button" role="option" aria-selected={sym === selected} className={styles.cell} onClick={() => setCoin(sym)} title={`${entry.display_name} · ${bySym.get(sym)?.members ?? 0} members`}>
                  <Oshimark icon={entry.icon} symbol={sym} size={30} />
                  <small>{bySym.get(sym)?.members ?? 0}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={styles.detail} style={{ "--tal": accent } as React.CSSProperties}>
          {asset ? (
            <>
              <div className={styles.dHead}>
                <ArtSlot kind="keyart" symbol={asset.symbol} icon={asset.icon} accent={accent} width={200} className={styles.dArt} />
                <div>
                  <span className={styles.kick}>Oshiboard</span>
                  <h2>
                    <Oshimark icon={asset.icon} symbol={asset.symbol} size={36} />
                    {asset.display_name}
                  </h2>
                  <p className={styles.dim}>{unitLabel(asset.unit)}</p>
                  <p className={styles.dPx}>
                    <b>{asset.current_mid_price?.toFixed(2) ?? "—"}</b> <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)}</span> ·{" "}
                    <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`}>open stock page →</Link>
                  </p>
                  <p className={styles.rule}>A player shows up here when {asset.symbol} is both their oshi and their largest holding by shares.</p>
                </div>
              </div>
              <div className={styles.dStats}>
                <div>
                  <span className={styles.label}>Board members</span>
                  <b>{stats ? stats.member_count.toLocaleString("en-US") : "—"}</b>
                </div>
                <div>
                  <span className={styles.label}>Oshi shares</span>
                  <b>{stats ? stats.total_shares.toLocaleString("en-US") : "—"}</b>
                </div>
                <div>
                  <span className={styles.label}>Of circulating</span>
                  <b>{stats && circulating ? `${((stats.total_shares / circulating) * 100).toFixed(1)}%` : "—"}</b>
                </div>
                <div>
                  <span className={styles.label}>Board value</span>
                  <b>{stats ? money(stats.total_market_value, { compact: true }) : "—"}</b>
                </div>
                <div>
                  <span className={styles.label}>Leader</span>
                  <b className={styles.ellipsis}>{entries[0]?.username ?? "—"}</b>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.l}>#</th>
                      <th className={styles.l}>Player</th>
                      <th>Shares</th>
                      <th>Value</th>
                      <th className={styles.hideS}>Of circulating</th>
                      <th className={styles.hideS}>Net worth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.user_id} className={entry.user_id === user?.id ? styles.mine : undefined}>
                        <td className={`${styles.l} ${styles.rank}`}>{entry.rank}</td>
                        <td className={styles.l}>
                          <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.who}>
                            <PlayerAvatar username={entry.username} pictureUrl={entry.profile_picture_url} color={entry.profile_color} size={24} />
                            <b>{entry.username}</b>
                            {entry.rank === 1 ? <span className={styles.tag}>LEADER</span> : null}
                            {entry.user_id === user?.id ? <span className={styles.tagMe}>YOU</span> : null}
                          </Link>
                        </td>
                        <td>{entry.coin_quantity.toLocaleString("en-US")}</td>
                        <td>{money(entry.coin_market_value)}</td>
                        <td className={styles.hideS}>{circulating ? `${((entry.coin_quantity / circulating) * 100).toFixed(2)}%` : "—"}</td>
                        <td className={styles.hideS}>{money(entry.total_equity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!entries.length ? <p className={styles.empty}>{board.loading ? "Loading the board…" : `Nobody has made ${asset.symbol} their oshi and biggest bag yet. Could be you.`}</p> : null}
              </div>
            </>
          ) : (
            <p className={styles.empty}>{assets.length ? "Pick a talent." : "Loading talents…"}</p>
          )}
        </section>
      </div>
    </>
  );
}
