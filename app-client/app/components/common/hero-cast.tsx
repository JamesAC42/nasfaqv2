"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { talentAccent } from "@/app/lib/talent-color";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/common/hero-cast.module.scss";

export type HeroTalent = { symbol: string; icon?: string | null; color?: string | null };

/**
 * A page header's cast: a few talents' key art standing at the right edge, behind the title row
 * and tinted by the first one's colour. Pages pass whoever the page is about right now (who's live,
 * who's in the news). Renders nothing without talents.
 *
 * `fill`: as many as the header has room for (up to `max`), stepping back to the left across it and
 * fading out behind the title, so a wide screen shows a crowd and a narrow one only a few.
 */
export function HeroCast({ talents, max = 3, fill = false, className }: { talents: HeroTalent[]; max?: number; fill?: boolean; className?: string }) {
  const { theme } = useTheme();
  if (fill) return <FilledCast talents={talents} max={max} className={className} />;
  const cast = talents.slice(0, max);
  if (!cast.length) return null;
  return (
    <div className={[styles.cast, className].filter(Boolean).join(" ")} style={{ "--tal": talentAccent(cast[0].color, theme) } as CSSProperties} aria-hidden="true">
      <div className={styles.row} data-count={cast.length}>
        {cast.map((talent, index) => (
          <ArtSlot
            key={talent.symbol}
            kind="keyart"
            symbol={talent.symbol}
            icon={talent.icon}
            accent={talentAccent(talent.color, theme)}
            width={360}
            priority={index === 0}
            className={styles.figure}
            fallback={<span />}
          />
        ))}
      </div>
    </div>
  );
}

// Fill mode's geometry, as fractions of the header's height: the figures hang from near its top
// and run taller than it (faces and shoulders show), the ones behind a step smaller.
const TOP = 0.1;
const FRONT_H = 1.75;
const BACK_H = FRONT_H * 0.88;
const ASPECT = 4 / 5;
/** How far left the second figure sits from the front one's right edge, in front-figure widths. */
const FIRST_STEP = 0.72;
/** And each one after that from the last, in back-figure widths. */
const STEP = 0.68;
/** Below this header width (phones), only the front figure, as in the default cast. */
const NARROW = 560;

function FilledCast({ talents, max, className }: { talents: HeroTalent[]; max: number; className?: string }) {
  const { theme } = useTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // The cast mounts once talents arrive (the live list loads after the page), so measure from then.
  const hasCast = talents.length > 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize((current) => (current && current.w === el.clientWidth && current.h === el.clientHeight ? current : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasCast]);

  if (!hasCast) return null;

  // Where each figure's right edge sits, front first; stop once one would start past the left edge.
  const spots: Array<{ right: number; height: number; top: number }> = [];
  if (size) {
    const { w, h } = size;
    const frontH = h * FRONT_H;
    const backH = h * BACK_H;
    let right = w * 0.04;
    spots.push({ right, height: frontH, top: h * TOP });
    right += frontH * ASPECT * FIRST_STEP;
    while (w >= NARROW && spots.length < Math.min(max, talents.length) && right < w) {
      spots.push({ right, height: backH, top: h * TOP + frontH * 0.03 });
      right += backH * ASPECT * STEP;
    }
  }

  return (
    <div ref={box} className={[styles.cast, styles.fill, className].filter(Boolean).join(" ")} style={{ "--tal": talentAccent(talents[0].color, theme) } as CSSProperties} aria-hidden="true">
      {spots.map((spot, index) => {
        const talent = talents[index];
        return (
          <span
            key={talent.symbol}
            className={styles.spot}
            data-back={index > 0 || undefined}
            style={{ right: spot.right, top: spot.top, height: spot.height, zIndex: spots.length - index }}
          >
            <ArtSlot kind="keyart" symbol={talent.symbol} icon={talent.icon} accent={talentAccent(talent.color, theme)} width={360} priority={index === 0} className={styles.figure} fallback={<span />} />
          </span>
        );
      })}
    </div>
  );
}
