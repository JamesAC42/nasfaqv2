"use client";

import Link from "next/link";
import { useState } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { listingName } from "@/app/components/games/exchange/listing-tile";
import { useOwnedCards } from "@/app/components/games/exchange/use-owned-cards";
import { buyListing, cancelListing, listingPath, placeBid, type Listing } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { Cash, Countdown, Dialog, RarityTag } from "@/app/components/games/exchange/bits";
import styles from "@/app/components/games/exchange/exchange.module.scss";

/** Buy, bid on, or (for your own) cancel a listing. */
export function ListingDialog({ listing: initial, onClose, onChanged }: { listing: Listing; onClose: () => void; onChanged?: (listing: Listing) => void }) {
  const { user } = useAuth();
  const [listing, setListing] = useState(initial);
  const owns = useOwnedCards();
  const [amount, setAmount] = useState(String(initial.min_bid ?? ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const auction = listing.kind === "auction";
  const active = listing.status === "active";
  const card = listing.card;
  const item = listing.item;
  const home = item ? "locker" : "binder";

  const settle = (next: Listing, message: string) => {
    setListing(next);
    setAmount(String(next.min_bid ?? ""));
    setDone(message);
    onChanged?.(next);
    void useProfileStore.getState().fetchPortfolio();
    void useGamesStore.getState().loadCollection({ quiet: true });
    void useExchangeStore.getState().loadDesk();
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await action();
    } catch (reason) {
      const err = reason as Error & { body?: { min_bid?: number } };
      if (err.message === "bid_too_low" && err.body?.min_bid) {
        setAmount(String(err.body.min_bid));
        setError(`Someone got there first. The next bid is at least ${money(err.body.min_bid)}.`);
      } else setError(gameErrorText(reason));
    } finally {
      setBusy(null);
    }
  };

  const bidValue = Number(amount);
  const quick = listing.min_bid ? [listing.min_bid, Math.ceil(listing.min_bid * 1.1), Math.ceil(listing.min_bid * 1.25)] : [];

  return (
    <Dialog title={item ? item.name : card ? `${card.name} ${card.rarity}` : listingName(listing)} onClose={onClose}>
      <div className={styles.dealBody}>
        <div className={styles.dealCard}>
          {item ? <ItemArt item={item} width={180} /> : card ? <TalentCard card={card} owned={listing.is_mine || owns(card.key)} width={180} /> : null}
          <Link href={listingPath(listing)} className={styles.textLink} onClick={onClose}>
            Price history →
          </Link>
        </div>
        <div className={styles.dealInfo}>
          <p className={styles.dealKicker}>
            {card ? <RarityTag rarity={card.rarity} /> : item ? <span className={styles.itemTag}>{item.rarity} item</span> : null} {auction ? "Auction" : "Buy now"} · listed by{" "}
            <b>{listing.seller.username}</b>
          </p>
          {auction ? (
            <>
              <dl className={styles.dealFacts}>
                <div>
                  <dt>{listing.bid_count ? "Top bid" : "Opening bid"}</dt>
                  <dd>
                    <Cash value={listing.ask} className={styles.big} />
                  </dd>
                </div>
                <div>
                  <dt>{active ? "Ends in" : "Ended"}</dt>
                  <dd>{active ? <Countdown endsAt={listing.ends_at} className={styles.big} /> : <b className={styles.big}>{listing.status}</b>}</dd>
                </div>
                <div>
                  <dt>Bids</dt>
                  <dd>
                    <b>{listing.bid_count}</b>
                    {listing.leader ? <small>{listing.is_leading ? "you're winning" : `${listing.leader.username} leads`}</small> : null}
                  </dd>
                </div>
              </dl>
              {listing.extensions ? <p className={styles.note}>Extended {listing.extensions}× by late bids.</p> : null}
            </>
          ) : (
            <dl className={styles.dealFacts}>
              <div>
                <dt>Price</dt>
                <dd>
                  <Cash value={listing.price} className={styles.big} />
                </dd>
              </div>
            </dl>
          )}

          {!user ? (
            <p className={styles.note}>
              <Link href="/login">Sign in</Link> to buy or bid.
            </p>
          ) : listing.is_mine ? (
            active ? (
              <div className={styles.dealActions}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  disabled={busy !== null || (auction && listing.bid_count > 0)}
                  onClick={() => void run("cancel", async () => settle((await cancelListing(listing.id)).listing, `Listing cancelled. It's back in your ${home}.`))}
                >
                  {busy === "cancel" ? "Cancelling…" : "Cancel listing"}
                </button>
                {auction && listing.bid_count > 0 ? <small className={styles.note}>Auctions with bids run to the end.</small> : null}
              </div>
            ) : null
          ) : active ? (
            <div className={styles.dealActions}>
              {auction ? (
                <form
                  className={styles.bidForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("bid", async () => {
                      const result = await placeBid(listing.id, bidValue);
                      settle(result.listing, result.bought ? `Bought at the buy-now price, ${money(result.price)}.` : result.extended ? "You're winning. Late bid: the clock was pushed out." : "You're winning.");
                    });
                  }}
                >
                  <label>
                    <span>Your bid</span>
                    <span className={styles.moneyInput}>
                      <i>$</i>
                      <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} aria-label="Bid amount" />
                    </span>
                  </label>
                  <div className={styles.quickBids}>
                    {quick.map((value) => (
                      <button key={value} type="button" onClick={() => setAmount(String(value))}>
                        {money(value)}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className={styles.btnPrimary} disabled={busy !== null || !(bidValue >= (listing.min_bid ?? 0))}>
                    {busy === "bid" ? "Bidding…" : `Bid ${money(bidValue || null)}`}
                  </button>
                  <small className={styles.note}>The cash is held until you&apos;re outbid, then refunded in full. Bids in the last 2 minutes add 2 minutes.</small>
                </form>
              ) : null}
              {listing.buy_now !== null ? (
                <button
                  type="button"
                  className={auction ? styles.btnSecondary : styles.btnPrimary}
                  disabled={busy !== null}
                  onClick={() => void run("buy", async () => settle((await buyListing(listing.id)).listing, `It's yours for ${money(listing.buy_now)}.`))}
                >
                  {busy === "buy" ? "Buying…" : `Buy now · ${money(listing.buy_now)}`}
                </button>
              ) : null}
              {item ? <small className={styles.note}>An item you win or buy can go back on the exchange after 24 hours.</small> : null}
            </div>
          ) : (
            <p className={styles.note}>
              {listing.status === "sold" ? `Sold to ${listing.buyer?.username ?? "someone"} for ${money(listing.sale_price)}.` : `This listing is ${listing.status}.`}
            </p>
          )}
          {done ? (
            <p className={styles.success} role="status">
              {done}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
