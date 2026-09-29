"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { evidenceText, useNow } from "@/app/components/predictions/market/shared";
import { cents, money, outcomeColor, shares as fmtShares, timeAgo } from "@/app/lib/predictions/format";
import type { PredictionMarketDetail, TimelineEvent, Trade } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/market/market.module.scss";

type Tab = "trades" | "holders" | "history";

/** Live trades, top holders per outcome, and the market's event history. */
export function Activity({ market, trades }: { market: PredictionMarketDetail; trades: Trade[] | null }) {
  const [tab, setTab] = useState<Tab>("trades");
  const now = useNow(5000);
  const colorOf = (code: string) => {
    const outcome = market.outcomes.find((entry) => entry.outcome_code === code);
    return outcome ? outcomeColor(market, outcome) : "var(--dim)";
  };
  const holderCount = Object.values(market.holders).reduce((sum, list) => sum + list.length, 0);

  return (
    <section className={styles.section} aria-labelledby="act-h">
      <div className={styles.sectionHead}>
        <h2 id="act-h">Activity</h2>
        <div className={styles.segs} role="tablist" aria-label="Activity">
          {(
            [
              ["trades", "Trades"],
              ["holders", `Holders${holderCount ? ` ${holderCount}` : ""}`],
              ["history", "History"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "trades" ? (
        trades === null ? (
          <p className={styles.fine}>Loading trades…</p>
        ) : trades.length ? (
          <ol className={styles.tape} aria-live="polite" aria-relevant="additions">
            {trades.map((entry) => (
              <li key={entry.id} data-live={entry.id < 0 || undefined} style={{ "--oc": colorOf(entry.outcome_code) } as CSSProperties}>
                <span className={styles.tapeWho}>
                  {entry.username ? <PlayerAvatar username={entry.username} color={entry.profile_color} size={20} /> : null}
                  {entry.username ? <Link href={`/profile/${encodeURIComponent(entry.username)}`}>{entry.username}</Link> : <span>{entry.via_limit ? "limit order" : "someone"}</span>}
                </span>
                <span className={styles.tapeWhat}>
                  <span className={styles.tapeSide}>{entry.side === "buy" ? "bought" : "sold"}</span> <b>{entry.outcome_label}</b>
                  {entry.via_limit ? <em className={styles.limitTag}>LIMIT</em> : null}
                </span>
                <span className={styles.tapeCash}>{money(entry.cash)}</span>
                <span className={styles.tapePrice}>
                  {fmtShares(entry.shares)} @ {cents(entry.avg_price)}
                  {entry.price_after !== null ? <> → {cents(entry.price_after)}</> : null}
                </span>
                <time className={styles.tapeTime} dateTime={entry.at}>
                  {timeAgo(entry.at, now)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.fine}>No trades yet. First one sets the tone.</p>
        )
      ) : null}

      {tab === "holders" ? (
        holderCount ? (
          <div className={styles.holders}>
            {market.outcomes
              .filter((outcome) => market.holders[outcome.id]?.length)
              .map((outcome) => (
                <div key={outcome.id} className={styles.holderCol} style={{ "--oc": outcomeColor(market, outcome) } as CSSProperties}>
                  <h3>{outcome.label}</h3>
                  <ol>
                    {market.holders[outcome.id].map((holder, index) => (
                      <li key={holder.username}>
                        <span className={styles.rank}>{index + 1}</span>
                        <PlayerAvatar username={holder.username} color={holder.profile_color} size={18} />
                        <Link href={`/profile/${encodeURIComponent(holder.username)}`}>{holder.username}</Link>
                        <b>{fmtShares(holder.shares)}</b>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        ) : (
          <p className={styles.fine}>Nobody holds a side yet.</p>
        )
      ) : null}

      {tab === "history" ? (
        <ol className={styles.history}>
          {market.timeline.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at}>{timeAgo(event.at, now)}</time>
              <span>{describe(event, market)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function describe(event: TimelineEvent, market: PredictionMarketDetail) {
  const d = event.data as Record<string, unknown>;
  const who = event.actor ?? "the system";
  const label = (code: unknown) => (code === "void" ? "VOID" : market.outcomes.find((outcome) => outcome.outcome_code === code)?.label ?? String(code ?? "?"));
  switch (event.type) {
    case "market_created":
      return `${who} made this market`;
    case "auto_created":
      return "Opened by the system";
    case "submitted_for_approval":
      return `${who} sent it for approval`;
    case "market_approved":
      return d.self_published ? `${who} published it` : `Approved by ${who}`;
    case "market_rejected":
      return `Rejected by ${who}${d.reason ? `: ${d.reason}` : ""}`;
    case "market_opened":
      return "Trading opened";
    case "market_closed":
      return d.reason === "resolution_proposed" ? "Trading closed for a call" : d.reason === "resolved_by_data" ? "Trading closed: the data is in" : event.actor ? `${who} closed trading` : "Trading closed";
    case "market_halted":
      return `${who} halted trading`;
    case "market_resumed":
      return `${who} resumed trading`;
    case "resolution_proposed":
      return `${who} ${d.overturned ? "overturned the call to" : "called it"} ${label(d.outcome)}${d.note ? `: “${d.note}”` : ""}`;
    case "resolution_disputed":
      return `${who} disputed the call`;
    case "resolution_withdrawn":
      return `${who} withdrew the call`;
    case "resolution_finalized": {
      const evidence = evidenceText(d.evidence as Record<string, unknown>);
      if (d.automatic) return `Call finalized automatically${evidence ? ` (${evidence})` : ""}`;
      return `${who} confirmed the call${d.self_confirmed ? " (self-confirmed)" : ""}`;
    }
    case "market_resolved":
      return `Resolved ${label(d.outcome)}: paid ${money(Number(d.paid_out ?? 0))} across ${d.positions ?? 0} positions`;
    case "market_voided":
      return `Voided${d.reason ? `: ${d.reason}` : ""}. Refunded ${money(Number(d.refunded ?? 0))}`;
    case "legacy_orders_released":
      return `Old order-book orders released (${d.released_orders ?? 0})`;
    default:
      return event.type.replace(/_/g, " ");
  }
}
