import type { CSSProperties } from "react";
import styles from "@/app/components/games/shared/playing-card.module.scss";

const SUIT_GLYPH = { S: "♠", H: "♥", D: "♦", C: "♣" } as const;
const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" } as const;
const RANK_LABEL: Record<string, string> = { "11": "J", "12": "Q", "13": "K", "14": "A", "1": "A" };
const RANK_NAME: Record<string, string> = { A: "ace", J: "jack", Q: "queen", K: "king" };

export type PlayingCardFace = { rank: number | string; suit: "S" | "H" | "D" | "C" };

/** A standard playing card (blackjack, high-low). `null` draws it face down. */
export function PlayingCard({
  card,
  width = 72,
  className,
  deal = false,
  highlight = false,
}: {
  card: PlayingCardFace | null;
  width?: number;
  className?: string;
  /** Animate in (slide + flip) when it mounts. */
  deal?: boolean;
  highlight?: boolean;
}) {
  const style = { "--w": `${width}px` } as CSSProperties;
  const classes = [styles.card, deal ? styles.deal : "", highlight ? styles.highlight : "", className].filter(Boolean).join(" ");
  if (!card) {
    return <span className={`${classes} ${styles.down}`} style={style} role="img" aria-label="Face-down card" />;
  }
  const rank = RANK_LABEL[String(card.rank)] ?? String(card.rank);
  const red = card.suit === "H" || card.suit === "D";
  const glyph = SUIT_GLYPH[card.suit];
  return (
    <span className={classes} style={style} data-red={red || undefined} role="img" aria-label={`${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[card.suit]}`}>
      <span className={styles.corner}>
        <b>{rank}</b>
        <i>{glyph}</i>
      </span>
      <span className={styles.pip}>{glyph}</span>
      <span className={`${styles.corner} ${styles.flip}`}>
        <b>{rank}</b>
        <i>{glyph}</i>
      </span>
    </span>
  );
}
