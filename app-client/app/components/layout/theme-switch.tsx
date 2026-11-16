"use client";

import { useId } from "react";
import { findSeason } from "@/app/lib/seasons";
import { useTheme, type ThemeChoice } from "@/app/providers/theme-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

function themeLabel(choice: ThemeChoice) {
  return findSeason(choice)?.label ?? (choice === "light" ? "Light" : "Dark");
}

/** The Display menus: every theme on offer (dark, the seasonal ones, light) as its own button. */
export function ThemeChoices() {
  const { choice, choices, setChoice } = useTheme();
  const labelId = useId();

  return (
    <div className={styles.displayRow} data-stacked="">
      <span id={labelId} className={styles.displayName}>
        Theme
      </span>
      <div className={styles.themeChoices} role="group" aria-labelledby={labelId}>
        {choices.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.displayToggle}
            aria-pressed={choice === option}
            onClick={() => setChoice(option)}
          >
            {themeLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
