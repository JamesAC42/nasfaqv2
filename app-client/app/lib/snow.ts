"use client";

import { useCallback } from "react";
import { useStoredState } from "@/app/lib/use-stored-state";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";

// The snow overlay's settings, kept in the browser so they work signed out. Snow is offered while the
// winter season is (app/lib/seasons.ts), on any theme. Until a player says otherwise it follows the
// theme: on with Winter lights unless they're in calm mode, off everywhere else. Forcing it on in calm
// mode gets nearly still snow.

export type SnowSettings = {
  /** The player's own on/off; null follows the theme. */
  on: boolean | null;
  /** 0 to 1. */
  amount: number;
  speed: number;
  size: number;
  /** -1 (blowing left) to 1 (blowing right); 0 is still air with a little wander. */
  wind: number;
  /** Piles up along panel edges and the bottom of the screen. */
  settle: boolean;
  /** Moves around the pointer, shakes with scrolling, gusts when a batch or tick lands. */
  reactive: boolean;
};

export const SNOW_DEFAULTS: SnowSettings = { on: null, amount: 0.42, speed: 0.4, size: 0.45, wind: 0.12, settle: true, reactive: true };

export const SNOW_AMOUNT_MIN = 0.05;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function parseSnowSettings(value: unknown): SnowSettings | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<Record<keyof SnowSettings, unknown>>;
  return {
    on: typeof stored.on === "boolean" ? stored.on : null,
    amount: clamp(stored.amount, SNOW_AMOUNT_MIN, 1, SNOW_DEFAULTS.amount),
    speed: clamp(stored.speed, 0, 1, SNOW_DEFAULTS.speed),
    size: clamp(stored.size, 0, 1, SNOW_DEFAULTS.size),
    wind: clamp(stored.wind, -1, 1, SNOW_DEFAULTS.wind),
    settle: typeof stored.settle === "boolean" ? stored.settle : SNOW_DEFAULTS.settle,
    reactive: typeof stored.reactive === "boolean" ? stored.reactive : SNOW_DEFAULTS.reactive,
  };
}

const STORAGE = { parse: parseSnowSettings };

export function useSnow() {
  const { choice, seasonsNow } = useTheme();
  const { calm } = useMotion();
  const [settings, setSettings] = useStoredState("nasfaq.snow", SNOW_DEFAULTS, STORAGE);
  const offered = seasonsNow.includes("winter");
  const on = offered && (settings.on ?? (choice === "winter" && !calm));
  const update = useCallback((change: Partial<SnowSettings>) => setSettings((current) => ({ ...current, ...change })), [setSettings]);
  const reset = useCallback(() => setSettings(SNOW_DEFAULTS), [setSettings]);
  return { offered, on, still: calm, settings, update, reset };
}
