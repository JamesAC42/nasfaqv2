"use client";

import { TalentCard } from "@/app/components/games/cards/talent-card";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { useOwnedCards } from "@/app/components/games/exchange/use-owned-cards";
import type { Listing } from "@/app/lib/games/exchange";
import { money } from "@/app/lib/time";
import { Countdown } from "@/app/components/games/exchange/bits";
import styles from "@/app/components/games/exchange/exchange.module.scss";

/** What a listing is selling, in words: "Pekora SR" or "Crown (rare item)". */
export function listingName(listing: Pick<Listing, "card" | "item">) {
  if (listing.item) return `${listing.item.name} (${listing.item.rarity} item)`;
  return listing.card ? `${listing.card.name} ${listing.card.rarity}` : "a listing";
}

/** One listing in a grid: the card or capsule item, what it costs, and (for auctions) the clock and the bidding. */
export function ListingTile({ listing, onOpen, width = 150, flash = false }: { listing: Listing; onOpen: (listing: Listing) => void; width?: number; flash?: boolean }) {
  const auction = listing.kind === "auction";
  const owns = useOwnedCards();
  const flag = listing.is_mine ? <span className={styles.flag}>yours</span> : listing.is_leading ? <span className={styles.flag} data-tone="lead">winning</span> : null;
  return (
    <button
      type="button"
      className={styles.tile}
      data-kind={listing.kind}
      data-rarity={listing.card?.rarity ?? listing.item?.rarity}
      data-flash={flash || undefined}
      data-mine={listing.is_mine || undefined}
      data-leading={listing.is_leading || undefined}
      onClick={() => onOpen(listing)}
      aria-label={`${listingName(listing)}, ${auction ? `auction at ${money(listing.ask)}` : `buy now ${money(listing.price)}`}`}
    >
      {listing.item ? <ItemArt item={listing.item} width={width} compact /> : listing.card ? <TalentCard card={listing.card} owned={listing.is_mine || owns(listing.card.key)} width={width} compact tilt={false} /> : null}
      <span className={styles.tileBody}>
        {auction ? (
          <>
            <span className={styles.tileRow}>
              <small>{listing.bid_count ? `${listing.bid_count} bid${listing.bid_count === 1 ? "" : "s"}` : "opening bid"}</small>
              <Countdown endsAt={listing.ends_at} />
            </span>
            <span className={styles.tilePriceRow}>
              <span className={styles.tilePrice}>{money(listing.ask)}</span>
              {flag}
            </span>
            {listing.buy_now !== null ? <small className={styles.tileSub}>buy now {money(listing.buy_now)}</small> : <small className={styles.tileSub}>auction</small>}
          </>
        ) : (
          <>
            <span className={styles.tileRow}>
              <small>buy now</small>
            </span>
            <span className={styles.tilePriceRow}>
              <span className={styles.tilePrice}>{money(listing.price)}</span>
              {flag}
            </span>
            <small className={styles.tileSub}>from {listing.seller.username}</small>
          </>
        )}
      </span>
    </button>
  );
}
