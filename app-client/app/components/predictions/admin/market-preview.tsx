"use client";

import { Oshimark } from "@/app/components/common/oshimark";
import { cents, money, percent, timeLeft } from "@/app/lib/predictions/format";
import type { TalentOption } from "@/app/components/predictions/admin/talent-picker";
import styles from "@/app/components/predictions/admin/create-market.module.scss";

export type PreviewOutcome = { key: string | number; label: string; price: number; color: string; talent: TalentOption | null };

/** How the new market will look on the floor, updated as the form changes. */
export function MarketPreview({
  shape,
  title,
  subtitle,
  category,
  closesAt,
  outcomes,
  b,
  feeBps,
  disputeHours,
  worst,
  now,
}: {
  shape: "binary" | "multi";
  title: string;
  subtitle: string;
  category: string | null;
  closesAt: string;
  outcomes: PreviewOutcome[];
  b: number;
  feeBps: number;
  disputeHours: number;
  worst: number;
  now: number;
}) {
  const closes = closesAt ? new Date(closesAt) : null;
  const valid = closes && !Number.isNaN(closes.getTime());
  const yes = outcomes[0];
  const sorted = [...outcomes].sort((a, b) => b.price - a.price);

  return (
    <div className={styles.preview} aria-label="Preview">
      <div className={styles.previewTop}>
        <span className={styles.previewNew}>New</span>
        {category ? <span>{category}</span> : null}
        <span className={styles.previewClock}>{valid ? (closes.getTime() > now ? `closes in ${timeLeft(closes, now)}` : "closes in the past") : "no close time"}</span>
      </div>
      <h3 className={styles.previewTitle} data-empty={!title.trim() || undefined}>
        {title.trim() || "Your question goes here?"}
      </h3>
      {subtitle.trim() ? <p className={styles.previewSub}>{subtitle}</p> : null}

      {shape === "binary" && yes ? (
        <>
          <div className={styles.previewBig}>
            <b style={{ color: yes.color }}>{percent(yes.price)}</b>
            <span>chance of {yes.label || "Yes"}</span>
          </div>
          <div className={styles.previewMeter} aria-hidden="true">
            <i style={{ width: `${yes.price * 100}%`, background: yes.color }} />
            <i style={{ width: `${(1 - yes.price) * 100}%`, background: outcomes[1]?.color }} />
          </div>
          <div className={styles.previewBtns}>
            {outcomes.map((outcome) => (
              <span key={outcome.key} style={{ ["--oc" as string]: outcome.color }}>
                {outcome.label || "—"} <b>{cents(outcome.price)}</b>
              </span>
            ))}
          </div>
        </>
      ) : (
        <ul className={styles.previewList}>
          {sorted.map((outcome) => (
            <li key={outcome.key} style={{ ["--oc" as string]: outcome.color }}>
              <span className={styles.previewLabel}>
                {outcome.talent ? <Oshimark icon={outcome.talent.icon} symbol={outcome.talent.symbol} size={16} /> : <i aria-hidden="true" />}
                <em>{outcome.label || "Unnamed"}</em>
              </span>
              <span className={styles.previewBar} aria-hidden="true">
                <i style={{ width: `${Math.max(2, outcome.price * 100)}%` }} />
              </span>
              <b>{percent(outcome.price)}</b>
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.previewFacts}>
        <div>
          <dt>Liquidity</dt>
          <dd>b {Math.round(b) || "—"}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{(feeBps / 100).toFixed(feeBps % 100 ? 2 : 0)}%</dd>
        </div>
        <div>
          <dt>Dispute</dt>
          <dd>{disputeHours || "—"}h</dd>
        </div>
        <div>
          <dt>House risk</dt>
          <dd>{Number.isFinite(worst) ? money(worst, 0) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
