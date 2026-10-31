"use client";

import type { IconType } from "react-icons";
import { LuLeaf } from "react-icons/lu";
import { SEASONS, type SeasonId } from "@/app/lib/seasons";
import { useSeason } from "@/app/providers/theme-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

const ICONS: Record<SeasonId, IconType> = { fall: LuLeaf };

// Top-bar switch for the season's colours, next to the theme toggle. It's in the server HTML and
// CSS shows it only while <html data-season-now> is set (and colours it while the season is on),
// so it doesn't pop in and shift the bar after hydration.
export function SeasonButton() {
  const { season, on, toggle } = useSeason();
  const Icon = ICONS[season?.id ?? SEASONS[0].id];
  const label = season?.label ?? "Seasonal colours";

  return (
    <button
      type="button"
      className={`${styles.iconButton} ${styles.seasonButton}`}
      aria-pressed={on}
      aria-label={label}
      title={`${label}: ${on ? "on" : "off"}`}
      onClick={toggle}
    >
      <Icon className={styles.icon} />
    </button>
  );
}

/** The phone menu's version. The menu only opens after hydration, so this can simply not render. */
export function SeasonSheetButton() {
  const { season, on, toggle } = useSeason();
  if (!season) return null;

  return (
    <button type="button" className={styles.textButton} aria-pressed={on} onClick={toggle}>
      {season.label.toUpperCase()} {on ? "ON" : "OFF"}
    </button>
  );
}
