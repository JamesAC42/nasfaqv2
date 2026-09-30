"use client";

import Link from "next/link";
import { useState } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { createListing, type ExchangeCard, type ExchangeItem, type Listing, type PriceEntry } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { money } from "@/app/lib/time";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { Dialog } from "@/app/components/games/exchange/bits";
import styles from "@/app/components/games/exchange/exchange.module.scss";

const FEE = 0.05;
const HOURS = [1, 12, 24, 48];

/**
 * List one card copy (`card`) or one capsule item (`item`): a buy-now price, or an auction with an
 * opening bid, optional buy now and a clock.
 */
export function SellDialog({
  card = null,
  item = null,
  tradeable = 1,
  price,
  onClose,
  onListed,
}: {
  card?: ExchangeCard | null;
  item?: ExchangeItem | null;
  tradeable?: number;
  price?: PriceEntry | null;
  onClose: () => void;
  onListed?: (listing: Listing) => void;
}) {
  const suggestion = price?.floor ?? price?.last ?? price?.avg7d ?? null;
  const [kind, setKind] = useState<"fixed" | "auction">("fixed");
  const [fixed, setFixed] = useState(suggestion ? String(Math.max(1, Math.floor(suggestion))) : "");
  const [start, setStart] = useState(suggestion ? String(Math.max(1, Math.floor(suggestion * 0.6))) : "");
  const [buyNow, setBuyNow] = useState("");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listed, setListed] = useState<Listing | null>(null);

  const headline = kind === "fixed" ? Number(fixed) : Number(start);
  const receive = headline > 0 ? headline - Math.round(headline * FEE * 100) / 100 : null;
  const valid = kind === "fixed" ? Number(fixed) >= 1 : Number(start) >= 1 && (!buyNow || Number(buyNow) > Number(start));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const what = item ? { cosmetic_key: item.key } : { card_key: card?.key ?? "" };
      const result = await createListing(
        kind === "fixed"
          ? { ...what, kind, price: Number(fixed) }
          : { ...what, kind, start_price: Number(start), buy_now: buyNow ? Number(buyNow) : null, duration_hours: hours },
      );
      setListed(result.listing);
      onListed?.(result.listing);
      if (card) void useGamesStore.getState().loadCollection({ quiet: true });
      void useExchangeStore.getState().loadDesk();
    } catch (reason) {
      setError(gameErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const clean = (value: string) => value.replace(/[^0-9.]/g, "");

  return (
    <Dialog title={item ? `Sell ${item.name}` : card ? `Sell ${card.name} ${card.rarity}` : "Sell"} onClose={onClose}>
      <div className={styles.dealBody}>
        <div className={styles.dealCard}>
          {item ? <ItemArt item={item} width={170} /> : card ? <TalentCard card={card} width={170} /> : null}
          <small className={styles.note}>
            {item
              ? "It comes off your profile while it's listed (unequipped if you're wearing it) and comes back if it doesn't sell."
              : `${tradeable} tradeable cop${tradeable === 1 ? "y" : "ies"}. Selling one drops a star while you hold fewer than five.`}
          </small>
        </div>
        {listed ? (
          <div className={styles.dealInfo}>
            <p className={styles.success}>
              Listed. {listed.kind === "auction" ? `The auction runs ${hours}h.` : `It stays up for 7 days or until it sells.`}
            </p>
            <p className={styles.note}>The {item ? "item" : "copy"} sits in escrow until it sells or you cancel. You&apos;ll get an alert when it moves.</p>
            <div className={styles.dealActions}>
              <Link href="/games/exchange/desk" className={styles.btnPrimary} onClick={onClose}>
                My desk
              </Link>
              <button type="button" className={styles.btnGhost} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            className={styles.dealInfo}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className={styles.segment} role="radiogroup" aria-label="Listing type">
              <button type="button" role="radio" aria-checked={kind === "fixed"} onClick={() => setKind("fixed")}>
                Buy now
                <small>fixed price</small>
              </button>
              <button type="button" role="radio" aria-checked={kind === "auction"} onClick={() => setKind("auction")}>
                Auction
                <small>highest bid wins</small>
              </button>
            </div>

            {price && (price.last !== null || price.floor !== null) ? (
              <p className={styles.priceHint}>
                {price.floor !== null ? (
                  <span>
                    floor <b>{money(price.floor)}</b>
                  </span>
                ) : null}
                {price.last !== null ? (
                  <span>
                    last sale <b>{money(price.last)}</b>
                  </span>
                ) : null}
                {price.avg7d !== null ? (
                  <span>
                    7d avg <b>{money(price.avg7d)}</b>
                  </span>
                ) : null}
              </p>
            ) : (
              <p className={styles.priceHint}>No sales yet for this {item ? "item" : "card"}. You set the first price.</p>
            )}

            {kind === "fixed" ? (
              <label className={styles.field}>
                <span>Price</span>
                <span className={styles.moneyInput}>
                  <i>$</i>
                  <input inputMode="decimal" value={fixed} onChange={(event) => setFixed(clean(event.target.value))} autoFocus />
                </span>
              </label>
            ) : (
              <>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Opening bid</span>
                    <span className={styles.moneyInput}>
                      <i>$</i>
                      <input inputMode="decimal" value={start} onChange={(event) => setStart(clean(event.target.value))} autoFocus />
                    </span>
                  </label>
                  <label className={styles.field}>
                    <span>Buy now (optional)</span>
                    <span className={styles.moneyInput}>
                      <i>$</i>
                      <input inputMode="decimal" value={buyNow} placeholder="none" onChange={(event) => setBuyNow(clean(event.target.value))} />
                    </span>
                  </label>
                </div>
                <div className={styles.field}>
                  <span>Runs for</span>
                  <div className={styles.chips}>
                    {HOURS.map((value) => (
                      <button key={value} type="button" aria-pressed={hours === value} onClick={() => setHours(value)}>
                        {value}h
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <p className={styles.receipt}>
              {receive !== null ? (
                <>
                  You receive <b>{money(receive)}</b>
                  {kind === "auction" ? " or more" : ""} <small>after the 5% exchange fee</small>
                </>
              ) : (
                <small>Set a price to see what you&apos;d receive.</small>
              )}
            </p>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.dealActions}>
              <button type="submit" className={styles.btnPrimary} disabled={busy || !valid}>
                {busy ? "Listing…" : kind === "fixed" ? "List for sale" : "Start auction"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
