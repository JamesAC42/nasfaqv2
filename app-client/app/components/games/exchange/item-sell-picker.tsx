"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMyItems, type MyItem } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { formatLeft, Dialog } from "@/app/components/games/exchange/bits";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { SellDialog } from "@/app/components/games/exchange/sell-dialog";
import styles from "@/app/components/games/exchange/exchange.module.scss";

/**
 * Pick one of your capsule items to sell. Items you received in the last 24 hours show with when
 * they're free; set rewards and untradable prizes aren't offered.
 */
export function ItemSellPicker({ onClose, onListed, initialKey = null }: { onClose: () => void; onListed?: () => void; initialKey?: string | null }) {
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<MyItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyItems()
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        const start = initialKey ? result.items.find((item) => item.key === initialKey && item.tradable) : null;
        if (start) setPicked(start);
      })
      .catch((reason) => !cancelled && setError(gameErrorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [initialKey]);

  if (picked) return <SellDialog item={picked} onClose={onClose} onListed={() => onListed?.()} />;

  const offered = (items ?? []).filter((item) => item.tradable || item.reason === "on_hold");
  const kept = (items ?? []).length - offered.length;
  return (
    <Dialog title="Sell an item" onClose={onClose} wide>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : items === null ? (
        <p className={styles.note}>Loading your locker…</p>
      ) : offered.length ? (
        <div className={styles.pickGrid}>
          {offered.map((item) => (
            <button key={item.key} type="button" className={styles.pickCard} disabled={!item.tradable} onClick={() => setPicked(item)} title={item.tradable ? undefined : "Received in the last 24 hours"}>
              <ItemArt item={item} width={112} compact />
              <small>{item.tradable ? item.name : <HoldLeft at={item.available_at} />}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.note}>
          Nothing to sell yet. Items from the <Link href="/games/capsule">capsule machine</Link> can be sold or traded.
        </p>
      )}
      {items && kept ? <p className={styles.note}>{kept} of your items stay with you: set rewards and a few special prizes can&apos;t be traded.</p> : null}
    </Dialog>
  );
}

/** "free in 13h 20m": how long until a received item can go back on the exchange. */
export function HoldLeft({ at }: { at: string | null }) {
  const left = useRemaining(at ? Date.parse(at) : null, 30_000);
  if (left === null) return null;
  return <>{left > 0 ? `free in ${formatLeft(left)}` : "free now"}</>;
}
