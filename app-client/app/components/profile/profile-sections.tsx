"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { ShowcaseStrip } from "@/app/components/games/locker/showcase-strip";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime } from "@/app/lib/market-clock";
import { normalizeArticleListResponse } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { ArticleListResponse, PredictionPortfolioResponse, ProfileBundle, ProfileRelationUser } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/profile/profile.module.scss";

type Profile = ProfileBundle["profile"];
const enc = encodeURIComponent;
const START = 10_000;

function useIcons() {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
}

function Sec({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${styles.sec} ${className ?? ""}`}>
      <div className={styles.secHead}>
        <h2>{title}</h2>
        {aside ? <span className={styles.aside}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ── Net worth ────────────────────────────────────────────────────────────
const RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "all", label: "ALL", days: Infinity },
] as const;

export function NetworthChart({ profile }: { profile: Profile }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30d");
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => {
    const days = RANGES.find((entry) => entry.key === range)?.days ?? 30;
    const cutoff = Date.now() - days * 86_400_000;
    const all = profile.networth_history
      .map((point) => ({ t: Date.parse(point.recorded_at), v: point.total_equity }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      .sort((a, b) => a.t - b.t);
    all.push({ t: Date.now(), v: profile.stats.total_equity });
    return all.filter((point) => point.t >= cutoff);
  }, [profile, range]);

  const H = 220;
  const padR = 64;
  const model = useMemo(() => {
    if (points.length < 2 || !w) return null;
    const plotW = w - padR;
    const values = [...points.map((point) => point.v), START];
    const lo = Math.min(...values) * 0.98;
    const hi = Math.max(...values) * 1.02;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 30);
    const line = points.map((point, i) => `${i ? "L" : "M"}${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`).join("");
    return { plotW, lo, hi, x, y, line, area: `${line}L${plotW},${H - 22}L0,${H - 22}Z`, ticks: [0.1, 0.5, 0.9].map((f) => lo + (hi - lo) * f) };
  }, [points, w]);

  const first = points[0]?.v ?? 0;
  const last = points[points.length - 1]?.v ?? 0;
  const tone = last >= first ? "up" : "down";
  const hovered = hover !== null ? points[hover] : null;

  return (
    <Sec
      title="Net worth"
      aside={
        <span className={styles.tabs}>
          {RANGES.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={range === entry.key} onClick={() => setRange(entry.key)}>
              {entry.label}
            </button>
          ))}
        </span>
      }
    >
      <div className={`${styles.chart} ${styles[tone]}`} ref={box}>
        {model ? (
          <svg
            width={w}
            height={H}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const t = points[0].t + ((event.clientX - rect.left) / model.plotW) * (points[points.length - 1].t - points[0].t);
              let best = 0;
              points.forEach((point, i) => {
                if (Math.abs(point.t - t) < Math.abs(points[best].t - t)) best = i;
              });
              setHover(best);
            }}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label="Net worth over time"
          >
            <defs>
              <linearGradient id="nw-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" className={styles.fillTop} />
                <stop offset="1" className={styles.fillBottom} />
              </linearGradient>
            </defs>
            {model.ticks.map((value) => (
              <g key={value}>
                <line x1={0} x2={model.plotW} y1={model.y(value)} y2={model.y(value)} className={styles.gridLine} />
                <text x={w - 4} y={model.y(value) + 3} textAnchor="end" className={styles.axis}>
                  {money(value, { compact: true })}
                </text>
              </g>
            ))}
            <line x1={0} x2={model.plotW} y1={model.y(START)} y2={model.y(START)} className={styles.startLine} />
            <text x={4} y={model.y(START) - 4} className={styles.startLbl}>
              START $10K
            </text>
            <path d={model.area} fill="url(#nw-fill)" />
            <path d={model.line} className={styles.line} />
            <circle cx={model.x(points[points.length - 1].t)} cy={model.y(last)} r={3.5} className={styles.dot} />
            {hovered ? <line x1={model.x(hovered.t)} x2={model.x(hovered.t)} y1={8} y2={H - 22} className={styles.cross} /> : null}
            <text x={0} y={H - 6} className={styles.axis}>
              {new Date(points[0].t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
            <text x={model.plotW} y={H - 6} textAnchor="end" className={styles.axis}>
              NOW
            </text>
          </svg>
        ) : (
          <p className={styles.empty}>Not enough history yet. Net worth is snapshotted as the market runs.</p>
        )}
        {hovered && model ? (
          <div className={styles.tip} style={{ left: Math.min(Math.max(model.x(hovered.t), 60), model.plotW - 60) }}>
            <b>{money(hovered.v)}</b>
            <span>{new Date(hovered.t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          </div>
        ) : null}
      </div>
    </Sec>
  );
}

// ── Bags ─────────────────────────────────────────────────────────────────
export function Bags({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const icons = useIcons();
  const { theme } = useTheme();
  const openTrade = useTradeStore((state) => state.openTrade);
  const holdings = [...profile.holdings].filter((holding) => holding.quantity > 0).sort((a, b) => b.market_value - a.market_value);
  const invested = holdings.reduce((sum, holding) => sum + holding.market_value, 0);
  const equity = profile.stats.total_equity || 1;

  return (
    <Sec title="Bags" aside={`${money(invested)} in stocks · ${Math.round((invested / equity) * 100)}% of net worth`}>
      <div className={styles.alloc} role="img" aria-label="Allocation">
        {holdings.map((holding) => (
          <i key={holding.symbol} style={{ flex: holding.market_value, background: talentAccent(icons.get(holding.symbol.toUpperCase())?.color, theme) }} title={`${holding.symbol} ${money(holding.market_value)}`} />
        ))}
        <i className={styles.cash} style={{ flex: Math.max(0, profile.stats.cash_balance) }} title={`Cash ${money(profile.stats.cash_balance)}`}>
          CASH
        </i>
      </div>
      {holdings.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.l}>Stock</th>
                <th>Qty</th>
                <th className={styles.hideS}>Avg</th>
                <th className={styles.hideS}>Mid</th>
                <th>Value</th>
                <th>P/L</th>
                {isSelf ? <th className={styles.hideS} /> : null}
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => {
                const pct = holding.avg_cost_basis ? (holding.current_mid_price ?? 0) / holding.avg_cost_basis - 1 : null;
                return (
                  <tr key={holding.symbol}>
                    <td className={styles.l}>
                      <Link href={`/stocks/${enc(holding.symbol)}`} className={styles.sym} data-peek-stock={holding.symbol}>
                        <Oshimark icon={icons.get(holding.symbol.toUpperCase())?.icon} symbol={holding.symbol} size={18} />
                        <b>{holding.symbol}</b>
                      </Link>
                    </td>
                    <td>{holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className={styles.hideS}>{holding.avg_cost_basis.toFixed(2)}</td>
                    <td className={styles.hideS}>{holding.current_mid_price?.toFixed(2) ?? "—"}</td>
                    <td>{money(holding.market_value)}</td>
                    <td className={styles[toneOf(holding.unrealized_pnl)]}>
                      {holding.unrealized_pnl >= 0 ? "+" : "−"}
                      {money(Math.abs(holding.unrealized_pnl))} <small>{signedPct(pct)}</small>
                    </td>
                    {isSelf ? (
                      <td className={`${styles.rowAct} ${styles.hideS}`}>
                        <button type="button" onClick={() => openTrade(holding.symbol, "buy")}>
                          BUY
                        </button>
                        <button type="button" onClick={() => openTrade(holding.symbol, "sell")}>
                          SELL
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>{isSelf ? "No bags yet. Pick a talent on Stocks and make your first trade." : "All cash, no bags."}</p>
      )}
    </Sec>
  );
}

// ── Pending orders (self) ────────────────────────────────────────────────
export function PendingOrders() {
  const orders = useProfileStore((state) => state.pendingLiveOrders);
  const refreshTradingState = useProfileStore((state) => state.refreshTradingState);
  const icons = useIcons();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/market/orders/cancel", { method: "POST", body: JSON.stringify({ order_id: id }) });
      setConfirm(null);
      await refreshTradingState();
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sec title="Your pending orders" aside={`${orders.length} queued`}>
      {orders.length ? (
        orders.map((order) => (
          <div key={order.id} className={styles.row}>
            <Oshimark icon={icons.get(order.symbol.toUpperCase())?.icon} symbol={order.symbol} size={20} />
            <span>
              <b className={order.side === "buy" ? styles.up : styles.down}>
                {order.side.toUpperCase()} {order.requested_quantity}
              </b>{" "}
              {order.symbol}
              <small>executes after {order.execute_after ? `${formatEtTime(new Date(order.execute_after))} ET` : "the next batch"}</small>
            </span>
            <button type="button" className={confirm === order.id ? styles.confirm : styles.mini} disabled={busy} onClick={() => (confirm === order.id ? void cancel(order.id) : setConfirm(order.id))}>
              {confirm === order.id ? "CONFIRM" : "CANCEL"}
            </button>
          </div>
        ))
      ) : (
        <p className={styles.empty}>Nothing queued. Orders fill in 10-minute batches.</p>
      )}
      {error ? <p className={styles.err}>{error}</p> : null}
    </Sec>
  );
}

// ── Predictions (self) ───────────────────────────────────────────────────
export function PredictionExposure({ portfolio }: { portfolio: PredictionPortfolioResponse | null }) {
  const positions = portfolio?.positions ?? [];
  const orders = portfolio?.open_orders ?? [];
  const reserved = orders.reduce((sum, order) => sum + order.cash_reserved, 0);
  return (
    <Sec title="Prediction exposure" aside={<Link href="/predictions">markets →</Link>}>
      {positions.length ? (
        positions.slice(0, 6).map((position) => (
          <Link key={`${position.market_id}-${position.outcome_id}`} href={`/predictions/${enc(position.slug)}`} className={styles.row}>
            <span className={styles.outcome}>{position.outcome_label.slice(0, 3).toUpperCase()}</span>
            <span>
              {position.title}
              <small>
                {position.shares.toLocaleString("en-US")} sh @ {(position.avg_entry_price * 100).toFixed(0)}¢ · {position.status.replace(/_/g, " ")}
              </small>
            </span>
            <span className={`${styles.rv} ${styles[toneOf(position.realized_pnl_cash)]}`}>{position.realized_pnl_cash ? `${position.realized_pnl_cash >= 0 ? "+" : "−"}${money(Math.abs(position.realized_pnl_cash))}` : ""}</span>
          </Link>
        ))
      ) : (
        <p className={styles.empty}>No prediction positions.</p>
      )}
      {orders.length ? (
        <p className={styles.note}>
          {orders.length} open order{orders.length === 1 ? "" : "s"} reserving {money(reserved)}.
        </p>
      ) : null}
    </Sec>
  );
}

// ── Recent fills ─────────────────────────────────────────────────────────
export function RecentFills({ bundle, base, onPage }: { bundle: ProfileBundle; base: string; onPage: (trades: ProfileBundle["trades"]) => void }) {
  const icons = useIcons();
  const [busy, setBusy] = useState(false);
  const { items, pagination } = bundle.trades;
  const go = async (page: number) => {
    setBusy(true);
    try {
      onPage(await apiFetch<ProfileBundle["trades"]>(`${base}/trades?page=${page}&limit=10`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sec title="Recent fills" aside={pagination.total ? `${pagination.total.toLocaleString("en-US")} total` : undefined}>
      {items.length ? (
        <>
          {items.map((trade) => (
            <div key={trade.id} className={styles.fill}>
              <time suppressHydrationWarning title={new Date(trade.ts).toLocaleString()}>
                {timeAgo(trade.ts)}
              </time>
              <b className={trade.side === "buy" ? styles.up : styles.down}>{trade.side.toUpperCase()}</b>
              <Link href={`/stocks/${enc(trade.symbol)}`} className={styles.sym} data-peek-stock={trade.symbol}>
                <Oshimark icon={icons.get(trade.symbol.toUpperCase())?.icon} symbol={trade.symbol} size={16} />
                {trade.symbol}
              </Link>
              <span>{trade.quantity.toLocaleString("en-US")}</span>
              <span>@ {trade.price.toFixed(2)}</span>
            </div>
          ))}
          {pagination.page_count > 1 ? (
            <div className={styles.pager}>
              <button type="button" disabled={busy || !pagination.has_previous_page} onClick={() => void go(pagination.page - 1)}>
                ‹ NEWER
              </button>
              <span>
                {pagination.page} / {pagination.page_count}
              </span>
              <button type="button" disabled={busy || !pagination.has_next_page} onClick={() => void go(pagination.page + 1)}>
                OLDER ›
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.empty}>No fills yet.</p>
      )}
    </Sec>
  );
}

// ── Gacha badges ─────────────────────────────────────────────────────────
export function GachaBadges({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const badges = profile.gacha_badges;
  return (
    <Sec title="Showcase & badges" aside={<Link href={isSelf ? "/games/item-locker" : `/games/item-locker/${enc(profile.username)}`}>locker →</Link>}>
      <ShowcaseStrip username={profile.username} isSelf={isSelf} />
      {badges.length ? (
        <div className={styles.gacha}>
          {badges.slice(0, 12).map((badge) => (
            <span key={badge.id} className={`${styles.gItem} ${styles[`rar_${badge.reward.rarity}`] ?? ""}`} title={`${badge.reward.display_name} · ${badge.reward.rarity}`}>
              {badge.reward.image_url ? <img src={badge.reward.image_url} alt="" loading="lazy" /> : <i>{badge.reward.display_name.slice(0, 1)}</i>}
              <small>{badge.reward.display_name}</small>
            </span>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>{isSelf ? "No pulls yet. Try the gacha on the Games page." : "No gacha badges yet."}</p>
      )}
      {profile.gacha_total_spent_cash ? <p className={styles.note}>{money(profile.gacha_total_spent_cash)} spent on pulls.</p> : null}
    </Sec>
  );
}

// ── Oshiboards ───────────────────────────────────────────────────────────
export function Oshiboards({ profile }: { profile: Profile }) {
  return (
    <Sec title="Oshiboard" aside={<Link href="/leaderboard?tab=talent">boards →</Link>}>
      {profile.oshiboards.length ? (
        profile.oshiboards.map((board) => (
          <Link key={board.asset.symbol} href={`/leaderboard?tab=talent&coin=${enc(board.asset.symbol)}`} className={styles.row}>
            <Oshimark icon={board.asset.icon} symbol={board.asset.symbol} size={22} />
            <span>
              <b>#{board.rank}</b> of {board.member_count} on {board.asset.display_name}&apos;s board
              <small>{board.coin_quantity.toLocaleString("en-US")} shares · largest bag + oshi</small>
            </span>
            <span className={styles.rv}>
              {money(board.coin_market_value, { compact: true })}
              <small>value</small>
            </span>
          </Link>
        ))
      ) : (
        <p className={styles.empty}>{profile.oshi_coin ? `Not on ${profile.oshi_coin.symbol}'s board. It needs to be the largest bag too.` : "No oshi picked yet."}</p>
      )}
    </Sec>
  );
}

// ── Head to head (visitor vs profile) ────────────────────────────────────
export function HeadToHead({ profile }: { profile: Profile }) {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  if (!user || !portfolio) return null;
  const mine = portfolio.total_equity;
  const theirs = profile.stats.total_equity;
  const share = mine + theirs > 0 ? mine / (mine + theirs) : 0.5;
  const shared = profile.holdings.filter((holding) => holding.quantity > 0 && portfolio.holdings.some((own) => own.symbol === holding.symbol && own.quantity > 0)).map((holding) => holding.symbol);
  return (
    <Sec title="Head to head" aside="you vs them">
      <div className={styles.h2h}>
        <div>
          <b>{money(mine)}</b>
          <small>you</small>
        </div>
        <span className={styles.vs}>VS</span>
        <div>
          <b>{money(theirs)}</b>
          <small>
            {profile.username} · #{profile.rank}
          </small>
        </div>
      </div>
      <div className={styles.h2hBar}>
        <i style={{ width: `${share * 100}%` }} />
      </div>
      <p className={styles.note}>
        {mine >= theirs ? `You're ahead by ${money(mine - theirs)}.` : `${money(theirs - mine)} to catch up.`}
        {shared.length ? ` You both hold ${shared.slice(0, 4).join(", ")}.` : ""}
      </p>
    </Sec>
  );
}

// ── Friends & rivals ─────────────────────────────────────────────────────
type Relation = {
  friend: (name: string) => Promise<void>;
  accept: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  rival: (name: string, active: boolean) => Promise<void>;
};

function Person({ person, children, mark }: { person: ProfileRelationUser; children?: React.ReactNode; mark?: string }) {
  return (
    <div className={styles.person}>
      {mark ? <span className={styles.mark}>{mark}</span> : null}
      <PlayerAvatar username={person.username} pictureUrl={person.profile_picture_url} color={person.profile_color} size={22} />
      <Link href={`/profile/${enc(person.username)}`}>{person.username}</Link>
      {children ? <span className={styles.pAct}>{children}</span> : null}
    </div>
  );
}

export function FriendsRivals({ profile, isSelf, busy, relation }: { profile: Profile; isSelf: boolean; busy: string | null; relation: Relation }) {
  const incoming = isSelf ? profile.pending_friend_requests?.incoming ?? [] : [];
  const outgoing = isSelf ? profile.pending_friend_requests?.outgoing ?? [] : [];
  return (
    <Sec title="Friends & rivals" aside={`${profile.friends.length} friends · ${profile.rivals.length} rivals`}>
      {incoming.map((person) => (
        <Person key={`in-${person.id}`} person={person} mark="◆">
          <small>wants to be friends</small>
          <button type="button" className={styles.miniOn} disabled={busy !== null} onClick={() => void relation.accept(person.username)}>
            ACCEPT
          </button>
          <button type="button" className={styles.mini} disabled={busy !== null} onClick={() => void relation.remove(person.username)}>
            IGNORE
          </button>
        </Person>
      ))}
      {outgoing.map((person) => (
        <Person key={`out-${person.id}`} person={person} mark="◇">
          <small>pending</small>
          <button type="button" className={styles.mini} disabled={busy !== null} onClick={() => void relation.remove(person.username)}>
            CANCEL
          </button>
        </Person>
      ))}
      {profile.friends.map((person) => (
        <Person key={`f-${person.id}`} person={person} />
      ))}
      {profile.rivals.length ? <div className={styles.subLabel}>Rivals</div> : null}
      {profile.rivals.map((person) => (
        <Person key={`r-${person.id}`} person={person} mark="✕">
          {isSelf ? (
            <button type="button" className={styles.mini} disabled={busy !== null} onClick={() => void relation.rival(person.username, false)}>
              DROP
            </button>
          ) : null}
        </Person>
      ))}
      {!incoming.length && !outgoing.length && !profile.friends.length && !profile.rivals.length ? (
        <p className={styles.empty}>{isSelf ? "No friends or rivals yet. Add them from their profiles or the leaderboard." : "No friends or rivals yet."}</p>
      ) : null}
    </Sec>
  );
}

// ── Articles ─────────────────────────────────────────────────────────────
export function Articles({ bundle, base, isSelf, onChange }: { bundle: ProfileBundle; base: string; isSelf: boolean; onChange: (next: Partial<ProfileBundle>) => void }) {
  const [tab, setTab] = useState<"mine" | "saved">("mine");
  const [busy, setBusy] = useState(false);
  const list: ArticleListResponse | null = tab === "saved" ? bundle.saved_articles : bundle.articles;
  const go = async (page: number) => {
    setBusy(true);
    try {
      const url = tab === "saved" ? `/api/profiles/me/saved-articles?page=${page}&limit=6` : `${base}/articles?page=${page}&limit=6`;
      const next = normalizeArticleListResponse(await apiFetch<Record<string, unknown>>(url));
      onChange(tab === "saved" ? { saved_articles: next } : { articles: next });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sec
      title="Articles"
      aside={
        isSelf ? (
          <span className={styles.tabs}>
            <button type="button" aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
              MINE
            </button>
            <button type="button" aria-pressed={tab === "saved"} onClick={() => setTab("saved")}>
              SAVED
            </button>
          </span>
        ) : (
          `${bundle.profile.stats.article_count} written`
        )
      }
    >
      {list?.items.length ? (
        list.items.map((article) => (
          <Link key={article.id} href={`/articles/${enc(article.slug)}`} className={styles.article}>
            <b>{article.title}</b>
            <small suppressHydrationWarning>
              {timeAgo(article.published_at ?? article.created_at)} · {article.comment_count} comments · {article.likes} likes
              {tab === "saved" && article.author ? ` · by ${article.author.username}` : ""}
            </small>
          </Link>
        ))
      ) : (
        <p className={styles.empty}>{tab === "saved" ? "Nothing saved yet." : isSelf ? "You haven't written anything yet." : "No articles yet."}</p>
      )}
      {list && list.pagination.page_count > 1 ? (
        <div className={styles.pager}>
          <button type="button" disabled={busy || !list.pagination.has_previous_page} onClick={() => void go(list.pagination.page - 1)}>
            ‹
          </button>
          <span>
            {list.pagination.page} / {list.pagination.page_count}
          </span>
          <button type="button" disabled={busy || !list.pagination.has_next_page} onClick={() => void go(list.pagination.page + 1)}>
            ›
          </button>
        </div>
      ) : null}
      {isSelf ? (
        <Link href="/articles/new" className={styles.more}>
          Write an article →
        </Link>
      ) : null}
    </Sec>
  );
}

// ── Achievements ─────────────────────────────────────────────────────────
export function Achievements({ profile }: { profile: Profile }) {
  const list = [...profile.achievements].sort((a, b) => String(b.earned_at ?? "").localeCompare(String(a.earned_at ?? "")));
  return (
    <Sec title="Achievements" aside={`${list.length} earned`} className={styles.wide}>
      {list.length ? (
        <div className={styles.ach}>
          {list.map((achievement) => (
            <div key={achievement.key} className={styles.achItem} style={{ "--bc": achievement.badge_color || "var(--blue)" } as React.CSSProperties} title={achievement.earned_at ? `Earned ${new Date(achievement.earned_at).toLocaleDateString()}` : undefined}>
              <i>{achievement.name.slice(0, 1)}</i>
              <span>
                <b>{achievement.name}</b>
                <small>{achievement.description}</small>
                {achievement.reward_cash ? <small className={styles.up}>+{money(achievement.reward_cash)}</small> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No achievements yet. Your first trade earns one.</p>
      )}
    </Sec>
  );
}
