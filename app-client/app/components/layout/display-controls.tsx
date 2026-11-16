"use client";

import { useId } from "react";
import { ThemeChoices } from "@/app/components/layout/theme-switch";
import { SnowDisplayRow } from "@/app/components/snow/snow-controls";
import { useMotion } from "@/app/providers/motion-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

/**
 * Calm mode, snow and the theme, as rows. The account menu, the signed-out Display button and the
 * phone's More sheet all show this, so the three places can't drift apart.
 */
export function DisplayControls() {
  const { calm, toggleCalm } = useMotion();
  const calmId = useId();

  return (
    <div className={styles.display}>
      <div className={styles.displayRow}>
        <span className={styles.displayName}>
          <span id={`${calmId}-name`}>Calm</span>
          <small id={`${calmId}-hint`}>No price flashes, scrolling tape or big animations</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={calm}
          aria-labelledby={`${calmId}-name`}
          aria-describedby={`${calmId}-hint`}
          className={styles.displayToggle}
          onClick={toggleCalm}
        >
          {calm ? "On" : "Off"}
        </button>
      </div>
      <SnowDisplayRow />
      <ThemeChoices />
    </div>
  );
}
