"use client";

import { useEffect, useMemo, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { SceneArt } from "@/app/components/common/scene-art";
import { getMarketClock, TICKS } from "@/app/lib/market-clock";
import { useArtStore } from "@/app/stores/art-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";

const VARIANTS = TICKS.map((tick) => tick.key);

/**
 * The ticks 4koma: a talent as a chibi stock broker through the market day (ringing the bell at
 * Open, lunch at the desk, shouting orders Late, asleep on the keyboard Overnight), one panel over
 * each stop of the timeline below. Art: SYM/tick/{open,lunch,late,overnight} from the art pipeline;
 * with several talents drawn, each visit picks one. Until any exist, the quiet halftone band shows.
 */
export function TickKoma({ className }: { className?: string }) {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);
  const assets = useMarketStore((state) => state.assets);
  const [pick, setPick] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const cast = useMemo(() => {
    const images = manifest?.images ?? {};
    const symbols = new Set<string>();
    for (const id of Object.keys(images)) {
      const match = /^([A-Z0-9_]+)\/tick\/open$/.exec(id);
      if (match && VARIANTS.every((variant) => images[`${match[1]}/tick/${variant}`])) symbols.add(match[1]);
    }
    return [...symbols].sort();
  }, [manifest]);

  // Chosen after mount so the server and client render the same first frame.
  useEffect(() => {
    if (!cast.length) return;
    const timer = window.setTimeout(() => {
      setPick(Math.floor(Math.random() * cast.length));
      setNext(getMarketClock(Date.now()).nextTick.key);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cast]);

  if (!cast.length) return <SceneArt slot="howto-ticks" className={className} width={1100} />;
  const symbol = cast[pick ?? 0];
  const asset = assets.find((entry) => entry.symbol === symbol);

  return (
    <ol className={`${styles.koma} ${className ?? ""}`} aria-label={`${asset?.display_name ?? symbol} through the market day`}>
      {TICKS.map((tick) => (
        <li key={tick.key} className={styles.komaPanel} data-next={next === tick.key || undefined}>
          <ArtSlot slot="tick" variant={tick.key} symbol={symbol} icon={asset?.icon} width={400} fit="cover" alt={`${tick.label}: ${KOMA_ALT[tick.key]}`} className={styles.komaArt} />
          <span className={styles.komaTag}>{tick.label}</span>
        </li>
      ))}
    </ol>
  );
}

const KOMA_ALT: Record<string, string> = {
  open: "ringing the opening bell",
  lunch: "lunch at the trading desk",
  late: "shouting orders into two phones",
  overnight: "asleep on the keyboard",
};
