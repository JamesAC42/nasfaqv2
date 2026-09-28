"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { addWish, fetchCardDetail, removeWish, type CardDetail, type Listing } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { RARITIES, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import { useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { unitLabel } from "@/app/lib/market-units";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { Countdown, RarityTag, ago } from "@/app/components/games/exchange/bits";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ListingDialog } from "@/app/components/games/exchange/listing-dialog";
import { SellDialog } from "@/app/components/games/exchange/sell-dialog";
import styles from "@/app/components/games/exchange/exchange.module.scss";

/** Wishlist toggle: a new listing of this card then rings your bell. */
function WantButton({ symbol, rarity, cardKey, wanted, count, onChange }: { symbol: string; rarity: string; cardKey: string; wanted: boolean; count: number; onChange: (wanted: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (wanted) await removeWish(symbol, rarity);
      else await addWish(cardKey);
      onChange(!wanted);
    } catch (reason) {
      setError(gameErrorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const others = count - (wanted ? 1 : 0);
  return (
    <>
      <button type="button" className={wanted ? styles.btnPrimary : styles.btnGhost} aria-pressed={wanted} disabled={busy} onClick={() => void toggle()} title={wanted ? "Take it off your wishlist" : "Get a notification when someone lists this card"}>
        {wanted ? "♥ On your wishlist" : "♡ Want it"}
      </button>
      {others > 0 ? <span className={styles.note}>{others} other {others === 1 ? "player wants" : "players want"} it</span> : null}
      {error ? <span className={styles.error}>{error}</span> : null}
    </>
  );
}

/** One card on the exchange: its price history, what's for sale now, and a way to sell yours. */
export function CardPage({ symbol, rarity }: { symbol: string; rarity: Rarity }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Listing | null>(null);
  const [selling, setSelling] = useState(false);
  const prices = useExchangeStore((state) => state.prices);
  const key = `card:${symbol}:${rarity}`;

  const load = useCallback(() => {
    fetchCardDetail(symbol, rarity)
      .then(setDetail)
      .catch((reason) => setError(gameErrorText(reason)));
  }, [symbol, rarity]);

  useEffect(() => {
    load();
  }, [load]);

  // Anything happening to this card reloads the page's numbers.
  const onEvent = useCallback(
    (payload: GamesPayload) => {
      if (payload.type !== "event") return;
      const event = payload.event as { card_key?: string; listing?: { card_key: string } };
      if (event.card_key === key || event.listing?.card_key === key) load();
    },
    [key, load],
  );
  useGamesEvents("exchange", onEvent);

  const card = detail?.card;
  const stats = detail?.stats;

  return (
    <ExchangeFrame title={card ? `${card.name} · ${rarity}` : `${symbol} · ${rarity}`} blurb={<>Price history, live listings and auctions for this card.</>}>
      <Link href="/games/exchange" className={styles.backLink}>
        ← Market
      </Link>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!detail || !card ? (
        <div className={styles.cardHero} aria-busy="true">
          <span className={styles.ghostTile} />
        </div>
      ) : (
        <>
          <section className={styles.cardHero}>
            <div className={styles.cardHeroArt}>
              <TalentCard card={card} width={230} />
              <nav className={styles.rarityHop} aria-label="Other rarities">
                {RARITIES.map((entry) => (
                  <Link key={entry} href={`/games/exchange/card/${symbol}/${entry}`} aria-current={entry === rarity ? "page" : undefined}>
                    {entry}
                  </Link>
                ))}
              </nav>
            </div>
            <div className={styles.cardHeroInfo}>
              <p className={styles.dealKicker}>
                <RarityTag rarity={rarity} /> {RARITY_NAME[rarity]} · {unitLabel(card.unit)}
              </p>
              <dl className={styles.statGrid}>
                <div>
                  <dt>Last sale</dt>
                  <dd>{money(stats?.last ?? null)}</dd>
                </div>
                <div>
                  <dt>Floor</dt>
                  <dd>{money(stats?.floor ?? null)}</dd>
                </div>
                <div>
                  <dt>30d range</dt>
                  <dd>{stats?.low30d !== null && stats?.high30d !== null ? `${money(stats?.low30d)} – ${money(stats?.high30d)}` : "—"}</dd>
                </div>
                <div>
                  <dt>Sales 30d</dt>
                  <dd>{stats?.sales30d ?? 0}</dd>
                </div>
                <div>
                  <dt>Owners</dt>
                  <dd>{stats?.owners ?? 0}</dd>
                </div>
                <div>
                  <dt>Copies out there</dt>
                  <dd>
                    {stats?.in_circulation ?? 0}
                    {stats?.in_escrow ? <small> · {stats.in_escrow} on sale</small> : null}
                  </dd>
                </div>
              </dl>
              <PriceChart history={detail.history} floor={stats?.floor ?? null} />
              <div className={styles.dealActions}>
                {detail.mine && detail.mine.tradeable > 0 ? (
                  <button type="button" className={styles.btnPrimary} onClick={() => setSelling(true)}>
                    Sell yours · {detail.mine.tradeable} tradeable
                  </button>
                ) : detail.mine ? (
                  <span className={styles.note}>You own {detail.mine.copies}; starter-pack copies stay with you.</span>
                ) : user ? (
                  <span className={styles.note}>You don&apos;t own this one yet.</span>
                ) : null}
                {user ? <WantButton symbol={symbol} rarity={rarity} cardKey={key} wanted={Boolean(detail.wanted)} count={detail.wanted_by ?? 0} onChange={(wanted) => setDetail((current) => (current ? { ...current, wanted, wanted_by: Math.max(0, (current.wanted_by ?? 0) + (wanted ? 1 : -1)) } : current))} /> : null}
                <Link href={`/games/cards/gallery/${symbol}`} className={styles.btnGhost}>
                  Her gallery
                </Link>
              </div>
            </div>
          </section>

          <div className={styles.cardColumns}>
            <section className={styles.panel} aria-label="For sale now">
              <h2 className={styles.sectionTitle}>For sale now · {detail.listings.length}</h2>
              {detail.listings.length ? (
                <ul className={styles.rows}>
                  {detail.listings.map((listing) => (
                    <li key={listing.id}>
                      <button type="button" className={styles.rowButton} onClick={() => setOpen(listing)}>
                        <span className={styles.rowKind} data-kind={listing.kind}>
                          {listing.kind === "auction" ? "AUCTION" : "BUY NOW"}
                        </span>
                        <span className={styles.rowMain}>
                          <b className={styles.cash}>{money(listing.ask)}</b>
                          <small>
                            {listing.kind === "auction"
                              ? `${listing.bid_count} bid${listing.bid_count === 1 ? "" : "s"}${listing.buy_now !== null ? ` · buy now ${money(listing.buy_now)}` : ""}`
                              : `from ${listing.seller.username}`}
                          </small>
                        </span>
                        {listing.kind === "auction" ? <Countdown endsAt={listing.ends_at} /> : <span className={styles.rowGo}>Buy →</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>None listed right now.{detail.mine?.tradeable ? " Yours would be the only one." : ""}</p>
              )}
            </section>
            <section className={styles.panel} aria-label="Recent sales">
              <h2 className={styles.sectionTitle}>Recent sales</h2>
              {detail.history.length ? (
                <ul className={styles.rows}>
                  {[...detail.history]
                    .reverse()
                    .slice(0, 12)
                    .map((sale, index) => (
                      <li key={`${sale.at}-${index}`} className={styles.saleRow}>
                        <b className={styles.cash}>{money(sale.price)}</b>
                        <small>
                          {sale.buyer ?? "someone"} from {sale.seller ?? "someone"} · {sale.kind === "auction" ? "auction" : "buy now"}
                        </small>
                        <small>{ago(sale.at)}</small>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className={styles.note}>No sales yet. The first one sets the price.</p>
              )}
            </section>
          </div>
        </>
      )}
      {open ? <ListingDialog listing={open} onClose={() => setOpen(null)} onChanged={() => load()} /> : null}
      {selling && card && detail?.mine ? (
        <SellDialog card={{ ...card, key }} tradeable={detail.mine.tradeable} price={prices?.[key] ?? null} onClose={() => setSelling(false)} onListed={() => load()} />
      ) : null}
    </ExchangeFrame>
  );
}

/** Every sale as a dot on a line, with the current floor as a dashed guide. */
function PriceChart({ history, floor }: { history: CardDetail["history"]; floor: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real width so labels stay 10px whatever the column is.
  const [width, setWidth] = useState(520);
  const [box, setBox] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);
  const points = useMemo(() => history.map((sale) => ({ t: Date.parse(sale.at), price: sale.price, kind: sale.kind })), [history]);
  if (points.length < 1) {
    return <div className={styles.chartEmpty}>No sales yet: the chart starts with the first one.</div>;
  }
  const W = width;
  const H = 180;
  const pad = { l: 8, r: 56, t: 14, b: 18 };
  const values = points.map((point) => point.price).concat(floor !== null ? [floor] : []);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1) {
    hi += 1;
    lo = Math.max(0, lo - 1);
  }
  const span = hi - lo;
  lo = Math.max(0, lo - span * 0.12);
  hi += span * 0.12;
  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (price: number) => pad.t + (1 - (price - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const single = points.length === 1;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(single ? W / 2 : x(point.t)).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const active = hover !== null ? points[hover] : points[points.length - 1];

  return (
    <figure className={styles.chart} ref={setBox}>
      <figcaption>
        {hover !== null ? "Sale" : "Last sale"} <b>{money(active.price)}</b> <small>{new Date(active.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${points.length} sales between ${money(Math.min(...points.map((p) => p.price)))} and ${money(Math.max(...points.map((p) => p.price)))}`} onMouseLeave={() => setHover(null)}>
        {[hi, (hi + lo) / 2, lo].map((value) => (
          <g key={value}>
            <line x1={pad.l} x2={W - pad.r} y1={y(value)} y2={y(value)} className={styles.chartGrid} />
            <text x={W - pad.r + 6} y={y(value) + 3} className={styles.chartAxis}>
              {money(value, { compact: true })}
            </text>
          </g>
        ))}
        {floor !== null ? (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(floor)} y2={y(floor)} className={styles.chartFloor} />
            <text x={pad.l + 4} y={y(floor) - 4} className={styles.chartFloorLabel}>
              floor {money(floor)}
            </text>
          </g>
        ) : null}
        {!single ? <path d={path} className={styles.chartLine} /> : null}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={single ? W / 2 : x(point.t)}
            cy={y(point.price)}
            r={hover === index ? 5 : 3.2}
            className={styles.chartDot}
            data-kind={point.kind}
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>
    </figure>
  );
}
