"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import type { SnowEngine, SnowOptions } from "@/app/components/snow/snow-engine";
import { useSnow } from "@/app/lib/snow";
import { useTheme } from "@/app/providers/theme-provider";
import { useMomentStore } from "@/app/stores/moment-store";
import styles from "@/app/components/snow/snow.module.scss";

const SLEIGH_DELAY_MS = 9000; // lets the tick's own moment have the screen first

/** The snow, when it's on. The engine is its own chunk, so nobody who isn't using it downloads it. */
export function SnowLayer() {
  const { on, still, settings } = useSnow();
  const { amount, speed, size, wind, settle, reactive } = settings;
  const options = useMemo<SnowOptions>(() => ({ amount, speed, size, wind, settle, reactive, still }), [amount, reactive, settle, size, speed, still, wind]);
  return on ? <SnowCanvas options={options} /> : null;
}

function SnowCanvas({ options }: { options: SnowOptions }) {
  const { theme } = useTheme();
  const pathname = usePathname();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SnowEngine | null>(null);
  const latest = useRef({ options, theme });

  useEffect(() => {
    latest.current = { options, theme };
    engineRef.current?.setOptions(options);
    engineRef.current?.setTone(theme);
  }, [options, theme]);

  useEffect(() => {
    engineRef.current?.pageChanged();
  }, [pathname]);

  useEffect(() => {
    let mounted = true;
    void import("@/app/components/snow/snow-engine").then(({ SnowEngine: Engine }) => {
      if (!mounted || !canvasRef.current) return;
      engineRef.current = new Engine(canvasRef.current, latest.current.options, latest.current.theme);
    });
    return () => {
      mounted = false;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // The market's rhythm: a gust when a batch lands, a bigger one on a tick, and if the tick left more
  // stocks up than down, a Santa rally. Your own fill turns some of the snow gold.
  const reactive = options.reactive;
  useEffect(() => {
    if (!reactive) return;
    let sleighTimer = 0;
    const unsubscribe = useMomentStore.subscribe((state, previous) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (state.batchAt !== previous.batchAt) engine.gust();
      if (state.fillAt !== previous.fillAt) engine.goldRush();
      if (state.tick && state.tick !== previous.tick) {
        engine.gust(160);
        const rising = state.tick.moves.filter((move) => move.pct > 0).length;
        if (rising > state.tick.moves.length / 2) {
          window.clearTimeout(sleighTimer);
          sleighTimer = window.setTimeout(() => engineRef.current?.flySleigh(), SLEIGH_DELAY_MS);
        }
      }
    });
    return () => {
      window.clearTimeout(sleighTimer);
      unsubscribe();
    };
  }, [reactive]);

  // Type "snow" for a blizzard or "santa" for the sleigh, anywhere you aren't typing into a field.
  useEffect(() => {
    let typed = "";
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      typed = (typed + event.key.toLowerCase()).slice(-5);
      if (typed.endsWith("snow")) {
        typed = "";
        engineRef.current?.blizzard();
      } else if (typed.endsWith("santa")) {
        typed = "";
        engineRef.current?.flySleigh();
      }
    };
    window.addEventListener("keydown", onKey, { passive: true });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
