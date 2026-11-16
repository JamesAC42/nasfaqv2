"use client";

import type { CSSProperties } from "react";
import { useId, useState } from "react";
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

/** Every snow setting but on/off. They apply as you move them, so you can watch the page while you tune it. */
function SnowPanel({ id }: { id: string }) {
  const { on, still, settings, update, reset } = useSnow();
  const set = (change: Partial<SnowSettings>) => update(change);

  return (
    <div id={id} className={styles.panel} role="group" aria-label="Snow settings">
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

/**
 * The Display menus (account menu, the signed-out Display button, the phone's More sheet): Snow's
 * on/off switch, and a caret that opens its other settings in place. Only there while snow is on offer.
 */
export function SnowDisplayRow() {
  const { offered, on, update } = useSnow();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!offered) return null;
  return (
    <>
      <div className={shellStyles.displayRow}>
        <span id={`${id}-name`} className={shellStyles.displayName}>
          Snow
        </span>
        <span className={shellStyles.displayPair}>
          <button
            type="button"
            className={shellStyles.displayMore}
            aria-label="More snow settings"
            title="Amount, speed, wind and size"
            aria-expanded={open}
            aria-controls={open ? `${id}-panel` : undefined}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={shellStyles.caret} aria-hidden="true" />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby={`${id}-name`}
            className={shellStyles.displayToggle}
            onClick={() => update({ on: !on })}
          >
            {on ? "On" : "Off"}
          </button>
        </span>
      </div>
      {open ? (
        <div className={styles.inline}>
          <SnowPanel id={`${id}-panel`} />
        </div>
      ) : null}
    </>
  );
}
