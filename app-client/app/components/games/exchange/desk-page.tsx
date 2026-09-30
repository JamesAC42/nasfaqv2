"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { cardPath, cardValue, type Listing, type Wish } from "@/app/lib/games/exchange";
import { useGamesEvents } from "@/app/lib/games/use-games-socket";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { CardName, Countdown, ItemName, ago } from "@/app/components/games/exchange/bits";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ListingDialog } from "@/app/components/games/exchange/listing-dialog";
import { SellPicker } from "@/app/components/games/exchange/market-page";
import styles from "@/app/components/games/exchange/exchange.module.scss";

const REASON: Record<string, string> = {
  email_verification_required: "Verify your email to trade on the exchange.",
  exchange_account_too_new: "New accounts can trade a few days after signing up.",
};

/** Your side of the exchange: what you're selling, what you're bidding on, what you've won, and what your binder is worth. */
export function DeskPage() {
  const { user, initialized } = useAuth();
  const desk = useExchangeStore((state) => state.desk);
  const prices = useExchangeStore((state) => state.prices);
  const collection = useGamesStore((state) => state.collection);
  const [open, setOpen] = useState<Listing | null>(null);
  const [selling, setSelling] = useState(false);

  const refresh = useCallback(() => {
    void useExchangeStore.getState().loadDesk();
    void useExchangeStore.getState().loadPrices(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    if (!collection) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [user, collection, refresh]);

  // Your alerts (outbid, sold, won) change this page: reload it.
  useGamesEvents(user ? "me" : null, refresh);

  const worth = useMemo(() => {
    if (!collection || !prices) return null;
    let value = 0;
    let priced = 0;
    for (const card of collection.cards) {
      const price = cardValue(prices, card.key);
      if (price === null) continue;
      value += price * (card.copies ?? 1);
      priced += 1;
    }
    return { value, priced, total: collection.cards.length };
  }, [collection, prices]);

  if (initialized && !user) {
    return (
      <ExchangeFrame title="My desk">
        <SignInToPlay what="sell and bid on cards" />
      </ExchangeFrame>
    );
  }

  const limits = desk?.limits;
  const leading = desk?.bids.filter((listing) => listing.is_leading) ?? [];
  const outbid = desk?.bids.filter((listing) => !listing.is_leading) ?? [];

  return (
    <ExchangeFrame title="My desk" blurb={<>Your listings, your bids, and what your binder would fetch on today&apos;s market.</>}>
      {desk && !desk.eligibility.eligible ? (
        <p className={styles.notice}>
          {REASON[desk.eligibility.reason ?? ""] ?? "You can't trade yet."}
          {desk.eligibility.available_at ? ` Opens ${new Date(desk.eligibility.available_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}
        </p>
      ) : null}

      <section className={styles.ticker} aria-label="Your exchange numbers">
        <div>
          <small>Binder value</small>
          <b>{worth ? money(worth.value, { compact: true }) : "…"}</b>
          {worth ? <em>{worth.priced} of {worth.total} cards have a market price</em> : null}
        </div>
        <div>
          <small>Listings</small>
          <b>
            {limits ? `${limits.active_listings}/${limits.max_active_listings}` : "…"}
          </b>
        </div>
        <div>
          <small>Winning</small>
          <b>{leading.length}</b>
        </div>
        <div>
          <small>Outbid</small>
          <b className={outbid.length ? styles.warnText : undefined}>{outbid.length}</b>
        </div>
        <div>
          <small>New today</small>
          <b>{limits ? `${limits.daily_actions}/${limits.max_daily_actions}` : "…"}</b>
          <em>listings and offers</em>
        </div>
        <button type="button" className={styles.sellButton} onClick={() => setSelling(true)} disabled={desk ? !desk.eligibility.eligible : false}>
          Sell a card
        </button>
      </section>

      <div className={styles.deskGrid}>
        <DeskSection title="Your bids" empty="You're not bidding on anything. Auctions ending soon are on the market page." listings={desk?.bids ?? null} onOpen={setOpen} kind="bids" />
        <DeskSection title="Selling" empty="Nothing listed. Sell a spare duplicate: it's how prices get set." listings={desk?.listings ?? null} onOpen={setOpen} kind="selling" />
        <WishlistSection wishes={desk ? desk.wishlist ?? [] : null} />
        <DeskSection title="Won and bought" empty="Nothing yet." listings={desk?.won ?? null} onOpen={setOpen} kind="won" />
        <DeskSection title="Closed listings" empty="Nothing closed yet." listings={desk?.closed ?? null} onOpen={setOpen} kind="closed" />
      </div>

      {open ? <ListingDialog listing={open} onClose={() => setOpen(null)} onChanged={refresh} /> : null}
      {selling ? <SellPicker onClose={() => setSelling(false)} onListed={refresh} /> : null}
    </ExchangeFrame>
  );
}

function DeskSection({ title, empty, listings, onOpen, kind }: { title: string; empty: string; listings: Listing[] | null; onOpen: (listing: Listing) => void; kind: "bids" | "selling" | "won" | "closed" }) {
  return (
    <section className={styles.panel} aria-label={title}>
      <h2 className={styles.sectionTitle}>
        {title}
        {listings?.length ? <small>{listings.length}</small> : null}
      </h2>
      {listings === null ? (
        <p className={styles.note}>Loading…</p>
      ) : listings.length ? (
        <ul className={styles.deskList}>
          {listings.map((listing) => (
            <li key={listing.id}>
              <button type="button" className={styles.deskRow} onClick={() => onOpen(listing)} data-state={deskState(listing, kind)}>
                {listing.item ? <ItemArt item={listing.item} width={56} compact /> : listing.card ? <TalentCard card={listing.card} width={56} compact tilt={false} /> : null}
                <span className={styles.rowMain}>
                  {listing.item ? <ItemName item={listing.item} /> : listing.card ? <CardName card={listing.card} /> : null}
                  <small>{deskLine(listing, kind)}</small>
                </span>
                <span className={styles.rowEnd}>
                  <b className={styles.cash}>{money(kind === "closed" || kind === "won" ? listing.sale_price ?? listing.ask : listing.ask)}</b>
                  {listing.status === "active" && listing.kind === "auction" ? <Countdown endsAt={listing.ends_at} /> : listing.closed_at ? <small>{ago(listing.closed_at)}</small> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>{empty}</p>
      )}
      {kind === "won" && listings?.length ? (
        <Link href="/games/collection" className={styles.textLink}>
          See them in your binder →
        </Link>
      ) : null}
    </section>
  );
}

/** Cards you want: the bell rings when one is listed. Add them from a card's page. */
function WishlistSection({ wishes }: { wishes: Wish[] | null }) {
  return (
    <section className={styles.panel} aria-label="Wishlist">
      <h2 className={styles.sectionTitle}>
        Wishlist
        {wishes?.length ? <small>{wishes.length}</small> : null}
      </h2>
      {wishes === null ? (
        <p className={styles.note}>Loading…</p>
      ) : wishes.length ? (
        <ul className={styles.deskList}>
          {wishes.map((wish) =>
            wish.card ? (
              <li key={wish.card_key}>
                <Link href={cardPath(wish.card_key)} className={styles.deskRow} data-state={wish.listed ? "leading" : undefined}>
                  <TalentCard card={wish.card} width={56} compact tilt={false} />
                  <span className={styles.rowMain}>
                    <CardName card={wish.card} />
                    <small>{wish.listed ? `${wish.listed} for sale now` : "None for sale · you'll get a notification"}{wish.owned ? " · you have one" : ""}</small>
                  </span>
                  <span className={styles.rowEnd}>{wish.floor !== null ? <b className={styles.cash}>{money(wish.floor)}</b> : <small>—</small>}</span>
                </Link>
              </li>
            ) : null
          )}
        </ul>
      ) : (
        <p className={styles.note}>Nothing on it. Open any card on the market and tap “Want it”: you&apos;ll get a notification when someone lists it.</p>
      )}
    </section>
  );
}

function deskState(listing: Listing, kind: string) {
  if (kind === "bids") return listing.is_leading ? "leading" : "outbid";
  if (kind === "closed") return listing.status;
  return undefined;
}

function deskLine(listing: Listing, kind: string) {
  if (kind === "bids") {
    return listing.is_leading ? `You're winning · ${listing.bid_count} bids` : `Outbid · your top ${money(listing.my_top_bid ?? null)} · next ${money(listing.min_bid)}`;
  }
  if (kind === "selling") {
    return listing.kind === "auction" ? `Auction · ${listing.bid_count ? `${listing.bid_count} bids, ${listing.leader?.username} leads` : "no bids yet"}` : "Buy now";
  }
  if (kind === "won") return `From ${listing.seller.username}`;
  if (listing.status === "sold") return `Sold to ${listing.buyer?.username ?? "someone"} · you got ${money((listing.sale_price ?? 0) - (listing.fee ?? 0))}`;
  return listing.status === "expired" ? `Ended unsold · back in your ${listing.item ? "locker" : "binder"}` : "Cancelled";
}

