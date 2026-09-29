"use client";

import type { CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { talentAccent } from "@/app/lib/talent-color";
import { unitLabel, unitName } from "@/app/lib/market-units";
import type { MarketAsset } from "@/app/lib/types";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/articles/headline-art.module.scss";

// Words in a headline that point at a whole unit (a branch-wide event with no single talent tagged).
const UNIT_WORDS: Array<[RegExp, (unit: string) => boolean]> = [
  [/\b(indonesia|indonesian|holoid|hololive id)\b/i, (unit) => /^Indonesia/i.test(unit)],
  [/\b(myth)\b/i, (unit) => /Myth/i.test(unit)],
  [/\b(council|promise)\b/i, (unit) => /Council|Promise/i.test(unit)],
  [/\b(advent)\b/i, (unit) => /Advent/i.test(unit)],
  [/\b(justice)\b/i, (unit) => /Justice/i.test(unit)],
  [/\b(holox|holo x)\b/i, (unit) => /holoX/i.test(unit)],
  [/\b(regloss|dev_is|dev is)\b/i, (unit) => /ReGLOSS/i.test(unit)],
  [/\b(flow glow)\b/i, (unit) => /FLOW GLOW/i.test(unit)],
  [/\b(gamers)\b/i, (unit) => /GAMERS/i.test(unit)],
  [/\b(hololive en|hololive english|holoen)\b/i, (unit) => /^English/i.test(unit)],
];

function unitCast(assets: MarketAsset[], title: string, units: string[]) {
  const wanted = new Set(units.map(unitName).filter(Boolean));
  for (const [re, test] of UNIT_WORDS) if (re.test(title)) for (const asset of assets) if (test(unitName(asset.unit))) wanted.add(unitName(asset.unit));
  // One or two units reads as "about them"; more than that is just hololive in general.
  if (!wanted.size || wanted.size > 2) return { label: null as string | null, cast: [] as MarketAsset[] };
  const members = assets.filter((asset) => wanted.has(unitName(asset.unit)));
  // Stable pick per headline, so the thumbnail doesn't reshuffle on every render.
  let seed = [...title].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const pool = [...members];
  const cast: MarketAsset[] = [];
  while (pool.length && cast.length < 3) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    cast.push(pool.splice(seed % pool.length, 1)[0]);
  }
  const names = [...wanted];
  return { label: names.length === 1 ? unitLabel(names[0]) : "hololive", cast };
}

/**
 * The picture for a story with no image and no talent tagged: the unit it's about (a few of its
 * talents), or else a newspaper clipping of the headline itself.
 */
export function HeadlineArt({ title, kind, at, units = [], size, className }: { title: string; kind: "news" | "community"; at: string | null; units?: string[]; size: "lead" | "row" | "mini"; className?: string }) {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  const { label, cast } = unitCast(assets, title, units);
  // The page's thumbnail class sizes the outer box; the layout lives on an inner stage that fills it.
  const classes = [styles.box, className].filter(Boolean).join(" ");

  if (cast.length >= 2) {
    return (
      <span className={classes} aria-hidden="true">
        <span className={`${styles.stage} ${styles.cast}`} data-size={size} style={{ "--tal": talentAccent(cast[0].color, theme), "--n": String(cast.length) } as CSSProperties}>
          {cast.map((asset) => (
            <ArtSlot key={asset.symbol} kind="keyart" symbol={asset.symbol} icon={asset.icon} accent={talentAccent(asset.color, theme)} width={size === "lead" ? 320 : 160} className={styles.face} />
          ))}
          {label && size !== "mini" ? <span className={styles.unit}>{label}</span> : null}
        </span>
      </span>
    );
  }

  const words = title.replace(/\s+/g, " ").trim().split(" ");
  const short = words.slice(0, size === "lead" ? 12 : 7).join(" ") + (words.length > (size === "lead" ? 12 : 7) ? "…" : "");
  const date = at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <span className={classes} aria-hidden="true">
      <span className={`${styles.stage} ${styles.paper}`} data-size={size}>
      <span className={styles.mast}>
        <b>{kind === "news" ? "HOLONEWS" : "THE FLOOR"}</b>
        {size !== "mini" ? <small suppressHydrationWarning>{date}</small> : null}
      </span>
      {size === "mini" ? (
        <span className={styles.mono}>{kind === "news" ? "HN" : "NF"}</span>
      ) : (
        <>
          <span className={styles.head}>{short}</span>
          <span className={styles.cols}>
            <i />
            <i />
            <i />
          </span>
        </>
      )}
      </span>
    </span>
  );
}
