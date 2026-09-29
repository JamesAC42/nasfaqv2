"use client";

import { useEffect, useRef } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import styles from "@/app/components/common/talent-coin.module.scss";

/**
 * A talent's stock as a coin: a 3D disc in her color with her oshimark struck on the face and the
 * ticker on the back. It idles with a slow wobble and a light sweep; bump `spin` (any new number)
 * and it flips end over end for about a second, like a coin tossed on the counter (a placed order).
 */
export function TalentCoin({
  icon,
  symbol,
  accent,
  size = 56,
  spin = 0,
}: {
  icon: string | null | undefined;
  symbol: string;
  /** Her talent color (a CSS color). */
  accent: string;
  size?: number;
  /** Change it to toss the coin. */
  spin?: number;
}) {
  const tossRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = tossRef.current;
    if (!spin || !el) return;
    // Restart the toss even if one is running: drop the flag, force a reflow, set it again.
    el.removeAttribute("data-tossing");
    void el.offsetWidth;
    el.setAttribute("data-tossing", "");
    const stop = window.setTimeout(() => el.removeAttribute("data-tossing"), 1_150);
    return () => window.clearTimeout(stop);
  }, [spin]);

  const edge = Array.from({ length: 6 }, (_, index) => index);
  return (
    <span className={styles.coin} style={{ "--tal": accent, "--size": `${size}px` } as React.CSSProperties} aria-hidden="true">
      <span ref={tossRef} className={styles.toss}>
        <span className={styles.body}>
          {edge.map((index) => (
            <span key={index} className={styles.edge} style={{ "--z": `${index - 2.5}px` } as React.CSSProperties} />
          ))}
          <span className={`${styles.face} ${styles.front}`}>
            <span className={styles.stamp}>
              <Oshimark icon={icon} symbol={symbol} size={Math.round(size * 0.52)} />
            </span>
          </span>
          <span className={`${styles.face} ${styles.back}`}>
            <b>{symbol}</b>
          </span>
        </span>
      </span>
    </span>
  );
}
