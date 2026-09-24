import type { CSSProperties } from "react";
import { fmtInteger } from "@/app/lib/format";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import styles from "@/app/components/games/collection/collection-stats.module.scss";

type Props = {
  unique: number;
  total: number;
  counts: Partial<Record<Rarity, number>>;
  /** Cards possible per rarity (the talent count). Omit to hide the per-rarity denominators. */
  perRarity?: number | null;
  shards?: number | null;
  className?: string;
};

/** Completion, a rarity-stacked progress bar, and the count per rarity. */
export function CollectionStats({ unique, total, counts, perRarity = null, shards = null, className }: Props) {
  const pct = total > 0 ? (unique / total) * 100 : 0;
  return (
    <div className={[styles.stats, className].filter(Boolean).join(" ")}>
      <div className={styles.hero}>
        <span className={styles.label}>Binder</span>
        <b className={styles.pct}>
          {pct >= 99.95 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}
          <small>%</small>
        </b>
        <span className={styles.sub}>
          <b>{fmtInteger(unique)}</b> / {fmtInteger(total)} cards
        </span>
      </div>

      <div className={styles.right}>
        <div className={styles.bar} role="img" aria-label={`${fmtInteger(unique)} of ${fmtInteger(total)} cards owned`}>
          {RARITIES.map((rarity) => {
            const count = counts[rarity] ?? 0;
            if (!count || !total) return null;
            return <i key={rarity} style={{ width: `${(count / total) * 100}%`, "--rc": RARITY_COLOR[rarity] } as CSSProperties} data-rarity={rarity} />;
          })}
        </div>
        <dl className={styles.rarities}>
          {RARITIES.map((rarity) => {
            const count = counts[rarity] ?? 0;
            return (
              <div key={rarity} style={{ "--rc": RARITY_COLOR[rarity] } as CSSProperties} data-rarity={rarity} data-empty={count === 0 || undefined}>
                <dt title={RARITY_NAME[rarity]}>{rarity}</dt>
                <dd>
                  <b>{fmtInteger(count)}</b>
                  {perRarity ? <small>/{fmtInteger(perRarity)}</small> : null}
                </dd>
              </div>
            );
          })}
          {shards !== null ? (
            <div className={styles.shardCell}>
              <dt>Shards</dt>
              <dd>
                <i aria-hidden="true" />
                <b>{fmtInteger(shards)}</b>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
