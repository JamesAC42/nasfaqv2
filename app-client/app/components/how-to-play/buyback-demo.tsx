"use client";

import { useState, type CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { BuybackMark } from "@/app/components/common/buyback-badge";
import { BuybackMeter } from "@/app/components/common/buyback-meter";
import { useBusiestTalents } from "@/app/components/how-to-play/demos";
import { DAY_MS, offerOn } from "@/app/lib/buyback-plan.mjs";
import { pctLabel } from "@/app/lib/buyback";
import { talentAccent } from "@/app/lib/talent-color";
import { money } from "@/app/lib/time";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/how-to-play/buyback-demo.module.scss";

// A Saturday buyback (the weekly evaluation starts them at 00:00 New York time), for the day labels.
const DEMO_START = Date.parse("2026-11-14T05:00:00Z");
const DEMO = { started_at: new Date(DEMO_START).toISOString(), frozen_price: 10, multiplier: 1.2, daily_step: 0.1, floor: 0.5, shares_over: 400, start: 1.2 };
const DAYS = 7;
const SHARES = 10;

/**
 * How to play's buyback example (buyback-spotlight): pick a day and see what the broker pays for
 * ten shares of a stock frozen at $10, with a real talent cheering or coping.
 */
export function BuybackDemo() {
  const [talent] = useBusiestTalents(1);
  const { theme } = useTheme();
  const [day, setDay] = useState(0);
  const pct = offerOn(DEMO, day);
  const steps = Array.from({ length: DAYS }, (_, index) => ({
    day: index,
    pct: offerOn(DEMO, index),
    at: DEMO_START + index * DAY_MS,
    state: index < day ? ("past" as const) : index === day ? ("now" as const) : ("later" as const),
  }));
  const pays = SHARES * DEMO.frozen_price * pct;
  const market = SHARES * DEMO.frozen_price;
  const symbol = talent?.symbol ?? "PEK";
  const accent = talentAccent(talent?.color, theme);
  const pose = pct > 1 ? "hype" : pct < 1 ? "cope" : "idle";

  return (
    <div className={styles.demo} style={{ "--tal": accent } as CSSProperties}>
      <div className={styles.top}>
        <span className={styles.tag}>Example</span>
        <BuybackMark pct={pct} size="md" />
      </div>
      <div className={styles.body}>
        <ArtSlot kind="reaction" pose={pose} symbol={symbol} icon={talent?.icon} accent={accent} width={128} className={styles.art} />
        <div className={styles.offer}>
          <p className={styles.big}>
            Broker pays <b>{pctLabel(pct)}</b>
          </p>
          <p>
            Sell {SHARES} {symbol} on day {day + 1}: <b>{money(pays)}</b> <span className={styles.dim}>vs {money(market)} at the market price</span>
          </p>
        </div>
      </div>
      <BuybackMeter steps={steps} endLabel="forced" nowLabel={null} />
      <div className={styles.days} role="group" aria-label="Pick a day">
        {steps.map((step) => (
          <button key={step.day} type="button" aria-pressed={step.day === day} onClick={() => setDay(step.day)}>
            Day {step.day + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
