"use client";

import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { LuSnowflake } from "react-icons/lu";
import { SNOW_AMOUNT_MIN, useSnow, type SnowSettings } from "@/app/lib/snow";
import shellStyles from "@/app/components/layout/site-shell.module.scss";
import styles from "@/app/components/snow/snow.module.scss";

function Slider({
  label,
  value,
  min,
  max,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  readout: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const filled = min < 0 ? { "--from": `${50 + Math.min(value, 0) * 50}%`, "--to": `${50 + Math.max(value, 0) * 50}%` } : { "--from": "0%", "--to": `${((value - min) / (max - min)) * 100}%` };
  return (
    <div className={styles.row}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        style={filled as CSSProperties}
        aria-valuetext={readout}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>{readout}</output>
    </div>
  );
}

function percent(value: number) {
  return String(Math.round(value * 100));
}

function windReadout(wind: number) {
  if (Math.abs(wind) < 0.03) return "calm";
  return `${wind < 0 ? "←" : "→"} ${Math.round(Math.abs(wind) * 100)}`;
}

/** Every snow setting. They apply as you move them, so you can watch the page while you tune it. */
function SnowPanel() {
  const { on, still, settings, update, reset } = useSnow();
  const set = (change: Partial<SnowSettings>) => update(change);

  return (
    <div className={styles.panel} role="group" aria-label="Snow settings">
      <div className={styles.head}>
        <strong>Snow</strong>
        <button type="button" className={styles.power} aria-pressed={on} onClick={() => set({ on: !on })}>
          {on ? "On" : "Off"}
        </button>
      </div>
      <div className={styles.rows} data-off={on ? undefined : ""}>
        <Slider label="Amount" value={settings.amount} min={SNOW_AMOUNT_MIN} max={1} readout={percent(settings.amount)} onChange={(amount) => set({ amount })} />
        <Slider label="Speed" value={settings.speed} min={0} max={1} readout={percent(settings.speed)} onChange={(speed) => set({ speed })} />
        <Slider label="Wind" value={settings.wind} min={-1} max={1} readout={windReadout(settings.wind)} onChange={(wind) => set({ wind: Math.abs(wind) < 0.03 ? 0 : wind })} />
        <Slider label="Size" value={settings.size} min={0} max={1} readout={percent(settings.size)} onChange={(size) => set({ size })} />
        <label className={styles.check}>
          <input type="checkbox" checked={settings.settle} onChange={(event) => set({ settle: event.target.checked })} />
          Piles up on panels
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.reactive} onChange={(event) => set({ reactive: event.target.checked })} />
          Reacts to your mouse and the market
        </label>
      </div>
      {still && on ? <p className={styles.note}>Calm mode is on, so it barely moves.</p> : null}
      <button type="button" className={styles.reset} onClick={reset}>
        Back to defaults
      </button>
    </div>
  );
}

/** Top bar: a snowflake next to the theme switch. Only there while snow is on offer. */
export function SnowButton() {
  const { offered, on } = useSnow();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!offered) return null;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={[shellStyles.iconButton, on ? shellStyles.iconButtonHot : ""].filter(Boolean).join(" ")}
        aria-label="Snow settings"
        title="Snow settings"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <LuSnowflake className={shellStyles.icon} />
      </button>
      {open ? (
        <div className={styles.popover}>
          <SnowPanel />
        </div>
      ) : null}
    </div>
  );
}

/** Phone menu: a button that opens the same settings in place. */
export function SnowSheetControls() {
  const { offered, on } = useSnow();
  const [open, setOpen] = useState(false);
  if (!offered) return null;
  return (
    <>
      <button type="button" className={shellStyles.textButton} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        SNOW {on ? "ON" : "OFF"}
      </button>
      {open ? (
        <div className={styles.sheet}>
          <SnowPanel />
        </div>
      ) : null}
    </>
  );
}
