"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchItemDetail, type ItemDetail, type Listing } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { typeLabel } from "@/app/components/games/locker/cosmetics";
import { Countdown, ItemRarityTag, ago } from "@/app/components/games/exchange/bits";
import { PriceChart } from "@/app/components/games/exchange/card-page";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { HoldLeft } from "@/app/components/games/exchange/item-sell-picker";
import { ListingDialog } from "@/app/components/games/exchange/listing-dialog";
import { SellDialog } from "@/app/components/games/exchange/sell-dialog";
import styles from "@/app/components/games/exchange/exchange.module.scss";

const MINE_NOTE: Record<string, string> = {
  not_from_capsule: "Yours came from a set reward, so it stays with you.",
  untradable: "This one can't be traded.",
};

/** One capsule item on the exchange: its sales, what's for sale now, and a way to sell yours. */
export function ItemPage({ cosmeticKey }: { cosmeticKey: string }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Listing | null>(null);
  const [selling, setSelling] = useState(false);

  const load = useCallback(() => {
    fetchItemDetail(cosmeticKey)
      .then(setDetail)
      .catch((reason) => setError(gameErrorText(reason)));
  }, [cosmeticKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Anything happening to this item reloads the page's numbers.
  const onEvent = useCallback(
    (payload: GamesPayload) => {
      if (payload.type !== "event") return;
      const event = payload.event as { cosmetic_key?: string | null; listing?: { cosmetic_key: string | null } };
      if (event.cosmetic_key === cosmeticKey || event.listing?.cosmetic_key === cosmeticKey) load();
    },
    [cosmeticKey, load],
  );
  useGamesEvents("exchange", onEvent);

  const item = detail?.item;
  const stats = detail?.stats;
  const mine = detail?.mine;
  const myListing = detail?.listings.find((listing) => listing.is_mine) ?? null;

  return (
    <ExchangeFrame title={item ? item.name : "Capsule item"} blurb={<>Sales, live listings and auctions for this capsule item.</>}>
      <Link href="/games/exchange?market=items" className={styles.backLink}>
        ← Capsule items
      </Link>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!detail || !item ? (
        <div className={styles.cardHero} aria-busy="true">
          <span className={styles.ghostTile} />
        </div>
      ) : (
        <>
          <section className={styles.cardHero}>
            <div className={styles.cardHeroArt}>
              <ItemArt item={item} width={230} />
            </div>
            <div className={styles.cardHeroInfo}>
              <p className={styles.dealKicker}>
                <ItemRarityTag rarity={item.rarity} /> {item.type ? typeLabel(item.type) : "Capsule item"}
                {!item.tradable ? " · can't be traded" : ""}
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
                  <dt>7d average</dt>
                  <dd>{money(stats?.avg7d ?? null)}</dd>
                </div>
                <div>
                  <dt>Owners</dt>
                  <dd>
                    {stats?.owners ?? 0}
                    {stats?.in_escrow ? <small> · {stats.in_escrow} on sale</small> : null}
                  </dd>
                </div>
              </dl>
              <PriceChart history={detail.history} floor={stats?.floor ?? null} />
              <div className={styles.dealActions}>
                {myListing ? (
                  <button type="button" className={styles.btnGhost} onClick={() => setOpen(myListing)}>
                    Yours is on sale · {money(myListing.ask)}
                  </button>
                ) : mine?.tradable ? (
                  <button type="button" className={styles.btnPrimary} onClick={() => setSelling(true)}>
                    Sell yours
                  </button>
                ) : mine?.reason === "on_hold" ? (
                  <span className={styles.note}>
                    You got yours on the exchange, so it can go again after 24 hours: <HoldLeft at={mine.available_at} />.
                  </span>
                ) : mine ? (
                  <span className={styles.note}>{MINE_NOTE[mine.reason ?? ""] ?? "You own this one."}</span>
                ) : user ? (
                  <span className={styles.note}>You don&apos;t own this one yet. Players hold one of each item.</span>
                ) : null}
                <Link href="/games/capsule" className={styles.btnGhost}>
                  Capsule machine
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
                        {listing.kind === "auction" ? <Countdown endsAt={listing.ends_at} /> : <span className={styles.rowGo}>{listing.is_mine ? "Yours" : "Buy →"}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>None listed right now.</p>
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
      {selling && item ? <SellDialog item={item} onClose={() => setSelling(false)} onListed={() => load()} /> : null}
    </ExchangeFrame>
  );
}
