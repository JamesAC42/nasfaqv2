"use client";

import type { IconType } from "react-icons";
import { FiMoon, FiSun } from "react-icons/fi";
import { LuLeaf } from "react-icons/lu";
import { findSeason } from "@/app/lib/seasons";
import { useTheme, type ThemeChoice } from "@/app/providers/theme-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

const ICONS: Record<ThemeChoice, IconType> = { dark: FiMoon, light: FiSun, fall: LuLeaf };

function themeLabel(choice: ThemeChoice) {
  return findSeason(choice)?.label ?? (choice === "light" ? "Light mode" : "Dark mode");
}

/** Top bar: one button that steps through the themes, showing the one it switches to. */
export function ThemeButton() {
  const { next, toggleTheme } = useTheme();
  const Icon = ICONS[next];
  const label = `Switch to ${themeLabel(next).toLowerCase()}`;

  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={label} onClick={toggleTheme}>
      <Icon className={styles.icon} />
    </button>
  );
}

/** Phone menu: every theme on offer as its own button. */
export function ThemeChoices() {
  const { choice, choices, setChoice } = useTheme();

  return choices.map((option) => (
    <button
      key={option}
      type="button"
      className={styles.textButton}
      aria-pressed={choice === option}
      onClick={() => setChoice(option)}
    >
      {(findSeason(option)?.label ?? option).toUpperCase()}
    </button>
  ));
}
