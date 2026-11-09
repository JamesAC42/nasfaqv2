"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { CosmeticChip } from "@/app/components/common/cosmetic-chip";
import { Medal, type MedalTier } from "@/app/components/common/medal";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { SceneArt } from "@/app/components/common/scene-art";
import { Term } from "@/app/components/common/tip";
import { apiFetch } from "@/app/lib/api";
import { money, toneOf } from "@/app/lib/time";
import type { DividendBoard, DividendBoardPlace, DividendBoardWindow, DividendBreakdown, MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/leaderboard/leaderboard.module.scss";

// The leaderboard's Dividends tab (api/src/services/dividendBoard.js, the dividend-spotlight flag):
// from the most earned at the Saturday review down to the highest fees, for the latest week or all
// time, with a breakdown by stock under each player. Oshi protection's column only shows when the API
// sends its figures, which it does only for viewers the oshi-protection flag is on for.

const PAGE_SIZE = 25;
const MEDALS: Record<number, string> = { 1: "site-medal-gold", 2: "site-medal-silver", 3: "site-medal-bronze" };
const TIER: Record<number, MedalTier> = { 1: "gold", 2: "silver", 3: "bronze" };
const WINDOWS: Array<[DividendBoardWindow, string]> = [
  ["latest", "LATEST WEEK"],
  ["all", "ALL TIME"],
];

const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

function shortDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function DividendsBoard() {
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const bySymbol = useMemo(() => new Map<string, MarketAsset>(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
  const icon = (symbol: string) => bySymbol.get(symbol.toUpperCase())?.icon;

  const [window, setWindow] = useState<DividendBoardWindow>("latest");
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState<DividendBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState<DividendBoardPlace | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<DividendBoard>(`/api/leaderboard/dividends?window=${window}&page=${page}&limit=${PAGE_SIZE}`)
      .then((result) => {
        if (!alive) return;
        setBoard(result);
        setError(null);
      })
      .catch((reason) => {
        if (alive) setError(String((reason as Error)?.message || reason));
      });
    return () => {
      alive = false;
    };
  }, [page, window]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    apiFetch<DividendBoardPlace>(`/api/leaderboard/dividends/me?window=${window}`)
      .then((result) => {
        if (alive) setPlace(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, window]);

  const isLoading = !error && (board?.window !== window || board?.pagination.page !== page);
  const entries = board?.entries ?? [];
  const totals = board?.totals ?? null;
  const pagination = board?.pagination ?? null;
  const me = user && place?.window === window ? place.me : null;
  // The API only sends these with the oshi-protection flag: no figures, no column.
  const showOshi = totals?.oshi_waived !== undefined;
  const columns = showOshi ? 7 : 6;
  const podium = page === 1 && entries.length >= 3 && entries[2].net > 0 ? [entries[1], entries[0], entries[2]] : [];
  const span = window === "all" ? (board?.weeks ? `over ${board.weeks} ${board.weeks === 1 ? "review" : "reviews"}` : "every review") : board?.eval_date ? `review of ${shortDate(board.eval_date)}` : "the latest review";

  const choose = (next: DividendBoardWindow) => {
    setWindow(next);
    setPage(1);
    setOpen(null);
  };
  const goTo = (next: number) => {
    setPage(next);
    setOpen(null);
  };

  return (
    <>
      <div className={styles.kstrip}>
        <div>
          <span className={styles.label}>Top earner</span>
          <b className={styles.ellipsis}>{board?.top ? board.top.username : "—"}</b>
          <small className={styles.up}>{board?.top ? signed(board.top.net) : " "}</small>
        </div>
        <div>
          <span className={styles.label}>Highest net fees</span>
          <b className={styles.ellipsis}>{board?.bottom ? board.bottom.username : "—"}</b>
          <small className={styles.down}>{board?.bottom ? signed(board.bottom.net) : " "}</small>
        </div>
        <div>
          <span className={styles.label}>
            <Term k="dividend">Dividends</Term>
          </span>
          <b className={styles.up}>{totals ? money(totals.dividends, { compact: true }) : "—"}</b>
          <small>paid as Credit</small>
        </div>
        <div>
          <span className={styles.label}>Share fees</span>
          <b className={styles.down}>{totals ? money(totals.fees, { compact: true }) : "—"}</b>
          <small>{span}</small>
        </div>
        {showOshi ? (
          <div>
            <span className={styles.label}>Oshi saved</span>
            <b className={styles.saved}>{money(totals?.oshi_waived, { compact: true })}</b>
            <small>fees skipped</small>
          </div>
        ) : (
          <div>
            <span className={styles.label}>On the board</span>
            <b>{totals ? totals.players.toLocaleString("en-US") : "—"}</b>
            <small>players</small>
          </div>
        )}
        <div>
          <span className={styles.label}>You</span>
          <b>{me ? `#${me.rank.toLocaleString("en-US")}` : "—"}</b>
          <small>
            {me ? (
              <span className={styles[toneOf(me.net)]}>{signed(me.net)}</span>
            ) : !user ? (
              "sign in to rank"
            ) : !user.email_verified ? (
              <Link href="/profile">verify your email to rank</Link>
            ) : user.suspension ? (
              "not ranked while suspended"
            ) : (
              "not on this board"
            )}
          </small>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.seg} role="group" aria-label="Window">
          {WINDOWS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={window === value} onClick={() => choose(value)}>
              {label}
            </button>
          ))}
        </div>
        <span className={styles.aside}>most earned down to highest fees · {span}</span>
      </div>

      {podium.length ? (
        <div className={styles.podium}>
          <SceneArt slot="market-leaderboard-podium" fill width={1400} className={styles.podiumArt} />
          {podium.map((entry) => (
            <Link key={entry.user_id} href={`/profile/${encodeURIComponent(entry.username)}`} className={`${styles.step} ${styles[`r${entry.rank}`]}`} style={{ "--pc": entry.profile_color || "var(--blue)" } as React.CSSProperties}>
              {MEDALS[entry.rank] ? <SceneArt slot={MEDALS[entry.rank]} width={48} className={styles.stepMedal} fallback={<Medal tier={TIER[entry.rank]} mark={entry.rank} />} /> : null}
              <PlayerAvatar username={entry.username} pictureUrl={entry.profile_picture_url} color={entry.profile_color} hat={entry.equipped_hat} equipped={entry.equipped} size={entry.rank === 1 ? 96 : 80} className={styles.stepAvatar} />
              <span className={styles.stepBody}>
                <span className={styles.stepRank}>{entry.rank}</span>
                <span className={styles.stepName}>{entry.username}</span>
                <span className={`${styles.stepEq} ${styles.up}`}>{signed(entry.net)}</span>
                <span className={styles.stepMeta}>
                  {entry.stocks} {entry.stocks === 1 ? "stock" : "stocks"}
                  {entry.fees ? ` · ${money(entry.fees)} in fees` : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {me ? (
        <div className={styles.me}>
          <div className={styles.meRank}>
            <span className={styles.label}>You are ranked</span>
            <b>#{me.rank.toLocaleString("en-US")}</b>
            <small>of {(place?.players ?? 0).toLocaleString("en-US")}</small>
          </div>
          <div>
            <span className={styles.label}>Net</span>
            <b className={styles[toneOf(me.net)]}>{signed(me.net)}</b>
          </div>
          <div>
            <span className={styles.label}>Dividends</span>
            <b className={styles.up}>{money(me.dividends)}</b>
          </div>
          <div>
            <span className={styles.label}>Share fees</span>
            <b className={styles.down}>{money(me.fees)}</b>
          </div>
          {me.oshi_waived !== undefined ? (
            <div>
              <span className={styles.label}>Oshi saved</span>
              <b className={styles.saved}>{money(me.oshi_waived)}</b>
            </div>
          ) : (
            <div>
              <span className={styles.label}>Stocks</span>
              <b>{me.stocks}</b>
            </div>
          )}
          <div className={styles.meLink}>
            <span className={styles.label}>Your review</span>
            <Link href="/market/dividends">Stock by stock, week by week →</Link>
          </div>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.divTable}`}>
          <thead>
            <tr>
              <th className={styles.l}>#</th>
              <th className={styles.l}>Player</th>
              <th>Net</th>
              <th className={styles.hideS}>
                <Term k="dividend" side="bottom">Dividends</Term>
              </th>
              <th className={styles.hideS}>Share fees</th>
              {showOshi ? <th className={styles.hideS}>Oshi saved</th> : null}
              <th>By stock</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isOpen = open === entry.user_id;
              const mine = entry.user_id === user?.id;
              const panel = `dividend-lines-${entry.user_id}`;
              return (
                <Fragment key={entry.user_id}>
                  <tr className={mine ? styles.mine : undefined}>
                    <td className={`${styles.l} ${styles.rank}`}>{entry.rank}</td>
                    <td className={styles.l}>
                      <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.who}>
                        <PlayerAvatar username={entry.username} pictureUrl={entry.profile_picture_url} color={entry.profile_color} hat={entry.equipped_hat} equipped={entry.equipped} size={26} />
                        <b>{entry.username}</b>
                        <CosmeticChip cosmetic={entry.equipped?.profile_badge ?? null} size={16} />
                        {mine ? <span className={styles.tagMe}>YOU</span> : null}
                      </Link>
                    </td>
                    <td className={styles[toneOf(entry.net)]}>
                      <b>{signed(entry.net)}</b>
                    </td>
                    <td className={`${styles.hideS} ${entry.dividends ? styles.up : styles.dim}`}>{entry.dividends ? money(entry.dividends) : "—"}</td>
                    <td className={`${styles.hideS} ${entry.fees ? styles.down : styles.dim}`}>{entry.fees ? money(entry.fees) : "—"}</td>
                    {showOshi ? <td className={`${styles.hideS} ${entry.oshi_waived ? styles.saved : styles.dim}`}>{entry.oshi_waived ? money(entry.oshi_waived) : "—"}</td> : null}
                    <td>
                      <button type="button" className={styles.expand} aria-expanded={isOpen} aria-controls={panel} aria-label={`${entry.username}, ${entry.stocks} ${entry.stocks === 1 ? "stock" : "stocks"}: ${isOpen ? "hide" : "show"} the breakdown`} onClick={() => setOpen(isOpen ? null : entry.user_id)}>
                        {entry.stocks} <i aria-hidden="true">{isOpen ? "▾" : "▸"}</i>
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr id={panel} className={styles.linesRow}>
                      <td colSpan={columns}>
                        {/* On a phone the row has no room for these columns. */}
                        <p className={styles.linesSplit}>
                          {money(entry.dividends)} in dividends · {money(entry.fees)} in fees
                          {entry.oshi_waived ? ` · ${money(entry.oshi_waived)} oshi saved` : ""}
                        </p>
                        <Breakdown key={`${entry.user_id}:${window}`} userId={entry.user_id} window={window} showOshi={showOshi} icon={icon} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!entries.length ? (
          <p className={styles.empty}>
            {error ? `Couldn’t load the board (${error}).` : isLoading ? "Adding up the divs…" : board?.eval_date ? "Nobody’s on this board yet." : "The first Dividend Review lands Saturday at 00:00 ET."}
          </p>
        ) : null}
      </div>

      {pagination && pagination.page_count > 1 ? (
        <div className={styles.pager}>
          <button type="button" onClick={() => goTo(1)} disabled={page <= 1 || isLoading}>
            « TOP
          </button>
          <button type="button" onClick={() => goTo(page - 1)} disabled={!pagination.has_previous_page || isLoading}>
            ‹ PREV
          </button>
          <span>
            page {pagination.page.toLocaleString("en-US")} of {pagination.page_count.toLocaleString("en-US")}
          </span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={!pagination.has_next_page || isLoading}>
            NEXT ›
          </button>
          <button type="button" onClick={() => goTo(pagination.page_count)} disabled={page >= pagination.page_count || isLoading}>
            HIGHEST FEES »
          </button>
          {me && me.rank > PAGE_SIZE ? (
            <button type="button" onClick={() => goTo(Math.ceil(me.rank / PAGE_SIZE))} disabled={isLoading}>
              JUMP TO ME
            </button>
          ) : null}
        </div>
      ) : null}

      <p className={styles.foot}>
        Net is what the Saturday review paid in dividends, less the share fees it charged.
        {showOshi ? " Oshi saved is the fee a player’s oshi skipped on the shares they held all week; it was never charged, so it isn’t in the net." : ""} <Link href="/how-to-play#weekly">How dividends work →</Link>
      </p>
    </>
  );
}

/** One player's dividends and fees by stock, fetched when opened. */
function Breakdown({ userId, window, showOshi, icon }: { userId: number; window: DividendBoardWindow; showOshi: boolean; icon: (symbol: string) => string | null | undefined }) {
  const [data, setData] = useState<DividendBreakdown | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<DividendBreakdown>(`/api/leaderboard/dividends/players/${userId}?window=${window}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [userId, window]);

  if (failed) return <p className={styles.linesNote}>Couldn’t load this breakdown.</p>;
  if (!data) return <p className={styles.linesNote}>Loading…</p>;
  if (!data.lines.length) return <p className={styles.linesNote}>Nothing paid or charged.</p>;

  return (
    <table className={styles.lines}>
      <thead>
        <tr>
          <th className={styles.l}>Stock</th>
          <th>Dividends</th>
          <th>Share fees</th>
          {showOshi ? <th>Oshi saved</th> : null}
          {window === "all" ? <th className={styles.hideS}>Reviews</th> : null}
        </tr>
      </thead>
      <tbody>
        {data.lines.map((line) => (
          <tr key={line.symbol}>
            <td className={styles.l}>
              <Link href={`/stocks/${encodeURIComponent(line.symbol)}`} className={styles.bag} data-peek-stock={line.symbol} prefetch={false}>
                <Oshimark icon={icon(line.symbol)} symbol={line.symbol} size={16} />
                <b>{line.symbol}</b>
                <small className={styles.hideS}>{line.display_name}</small>
              </Link>
            </td>
            <td className={line.dividends ? styles.up : styles.dim}>{line.dividends ? money(line.dividends) : "—"}</td>
            <td className={line.fees ? styles.down : styles.dim}>{line.fees ? money(line.fees) : "—"}</td>
            {showOshi ? (
              <td className={line.oshi_waived ? styles.saved : styles.dim}>
                {line.oshi_waived ? money(line.oshi_waived) : "—"}
                {line.oshi_waived && line.oshi_protected_quantity ? <small className={styles.hideS}> on {Math.floor(line.oshi_protected_quantity).toLocaleString("en-US")} sh</small> : null}
              </td>
            ) : null}
            {window === "all" ? <td className={styles.hideS}>{line.weeks}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
