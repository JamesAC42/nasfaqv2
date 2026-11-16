"use client";

import { pctLabel } from "@/app/lib/buyback";
import styles from "@/app/components/common/buyback-meter.module.scss";

type Step = { day: number; pct: number; at: number; state: "past" | "now" | "later" };

const weekday = (at: number) => new Date(at).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }).toUpperCase();

/**
 * The buyback's staircase: one bar per day, as tall as that day's offer, with today lit up and a
 * dashed line at the market price (100%), so it's plain that the early days pay more than the market
 * and the late ones less. Ends on the weekly evaluation, which takes whatever is still over.
 */
export function BuybackMeter({ steps, endLabel = "forced", size = "md", nowLabel = "TODAY" }: { steps: Step[]; endLabel?: string | null; size?: "sm" | "md"; /** Null keeps the weekday under the lit bar. */ nowLabel?: string | null }) {
  if (!steps.length) return null;
  const top = Math.max(1.2, ...steps.map((step) => step.pct));
  const now = steps.find((step) => step.state === "now");
  const label = `The broker's offer by day: ${steps.map((step) => `${weekday(step.at)} ${pctLabel(step.pct)}`).join(", ")}${now && nowLabel ? `. Today: ${pctLabel(now.pct)}` : ""}.`;
  return (
    <div className={styles.meter} data-size={size} role="img" aria-label={label}>
      <div className={styles.plot}>
        <i className={styles.par} style={{ bottom: `${(1 / top) * 100}%` }}>
          <span>market price</span>
        </i>
        {steps.map((step) => (
          <span key={step.day} className={styles.col} data-state={step.state}>
            <span className={styles.bar} style={{ height: `${(step.pct / top) * 100}%` }}>
              <b>{pctLabel(step.pct)}</b>
            </span>
          </span>
        ))}
        {endLabel ? (
          <span className={styles.col} data-state="end">
            <span className={styles.endBar} title="The weekly evaluation: the broker takes whatever is still over from every holder, at the base rate" aria-hidden>
              ⚖
            </span>
          </span>
        ) : null}
      </div>
      <div className={styles.days}>
        {steps.map((step) => (
          <span key={step.day} data-state={step.state}>
            {step.state === "now" && nowLabel ? nowLabel : weekday(step.at)}
          </span>
        ))}
        {endLabel ? <span data-state="end">{endLabel}</span> : null}
      </div>
    </div>
  );
}
