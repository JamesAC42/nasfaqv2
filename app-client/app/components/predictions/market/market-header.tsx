"use client";

import type { CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { SceneArt } from "@/app/components/common/scene-art";
import { centsFine, inkOn, statusOf, useNow } from "@/app/components/predictions/market/shared";
import { cents, centsDelta, compactMoney, outcomeColor, percent, TEMPLATE_LABEL, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import type { Outcome, PredictionMarketDetail } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/market/market.module.scss";

export type Talent = { symbol: string; icon: string | null; color: string | null; name: string | null } | null;
export type Flash = Record<string, { dir: "up" | "down"; n: number }>;

/** "Closes in 2h 05m", "Window ends in 4h 12m", "Resolved 3h ago". */
function clockLine(market: PredictionMarketDetail, now: number): { text: string; soon: boolean } {
  const proposal = market.proposals.find((entry) => entry.status === "proposed" || entry.status === "disputed");
  if (market.status === "draft") return { text: "Draft · not published", soon: false };
  if (market.status === "pending_approval") return { text: `Awaiting approval · would close in ${timeLeft(market.closes_at, now)}`, soon: false };
  if (market.status === "rejected") return { text: "Rejected", soon: false };
  if (market.status === "open" && market.trading_status === "pending_open") return { text: `Opens in ${timeLeft(market.opens_at, now)}`, soon: false };
  if (market.status === "open") {
    const ms = new Date(market.closes_at).getTime() - now;
    return { text: ms > 0 ? `Closes in ${timeLeft(market.closes_at, now)}` : "Closing…", soon: ms < 3_600_000 };
  }
  if (proposal) {
    const ms = new Date(proposal.window_ends_at).getTime() - now;
    return { text: ms > 0 ? `Dispute window ${timeLeft(proposal.window_ends_at, now)}` : "Window closed", soon: ms > 0 && ms < 3_600_000 };
  }
  if (market.status === "resolved" && market.resolved_at) return { text: `Resolved ${timeAgo(market.resolved_at, now)} ago`, soon: false };
  if (market.status === "voided" && market.voided_at) return { text: `Voided ${timeAgo(market.voided_at, now)} ago`, soon: false };
  return { text: `Closed ${timeAgo(market.closes_at, now)} ago`, soon: false };
}

export function MarketHeader({ market, talent }: { market: PredictionMarketDetail; talent: Talent }) {
  const now = useNow(1000);
  const status = statusOf(market);
  const clock = clockLine(market, now);
  const template = market.auto_template ? TEMPLATE_LABEL[market.auto_template] : null;
  return (
    <header className={styles.head}>
      {talent ? (
        <span className={styles.headMark} style={{ "--tal": talent.color ?? "var(--blue)" } as CSSProperties}>
          <Oshimark icon={talent.icon} symbol={talent.symbol} size={44} title={talent.name ?? talent.symbol} />
        </span>
      ) : market.kind === "event" ? (
        <span className={`${styles.headMark} ${styles.eventMark}`}>
          {market.featured_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={market.featured_image_url} alt="" className={styles.eventImg} loading="eager" decoding="async" />
          ) : (
            <SceneArt slot="predictions-event-mark" width={44} className={styles.eventArt} />
          )}
        </span>
      ) : null}
      <div className={styles.headText}>
        <div className={styles.badges}>
          <span className={styles.status} data-tone={status.tone}>
            {status.tone === "live" ? <i aria-hidden="true" /> : null}
            {status.label}
          </span>
          {market.kind === "auto" ? <span className={styles.badge}>Auto{template ? ` · ${template}` : ""}</span> : <span className={styles.badge}>Event</span>}
          {talent ? <span className={styles.badge}>{talent.symbol}</span> : null}
          {market.category ? <span className={styles.badge}>{market.category.display_name}</span> : null}
          {market.market_type === "multi" ? <span className={styles.badge}>{market.outcomes.length} outcomes</span> : null}
        </div>
        <h1>{market.title}</h1>
        {market.subtitle ? <p className={styles.subtitle}>{market.subtitle}</p> : null}
        <div className={styles.meta}>
          <span className={styles.clock} data-soon={clock.soon || undefined} data-live={market.status === "open" || undefined}>
            {clock.text}
          </span>
          <span>
            <b>{compactMoney(market.total_volume_cash)}</b> vol
          </span>
          <span>
            <b>{compactMoney(market.volume_24h)}</b> 24h
          </span>
          <span>
            <b>{market.traders_24h}</b> {market.traders_24h === 1 ? "trader" : "traders"} today
          </span>
        </div>
      </div>
    </header>
  );
}

function Move({ value }: { value: number }) {
  const c = Math.round(value * 100);
  const t = c > 0 ? "up" : c < 0 ? "down" : "flat";
  return (
    <span className={styles.move} data-tone={t}>
      {t === "up" ? "▲" : t === "down" ? "▼" : "•"} {centsDelta(value)}
    </span>
  );
}

function FlashNum({ flash, children, className }: { flash?: { dir: "up" | "down"; n: number }; children: React.ReactNode; className?: string }) {
  return (
    <span key={flash?.n ?? 0} className={`${className ?? ""} ${flash ? (flash.dir === "up" ? styles.flashUp : styles.flashDown) : ""}`}>
      {children}
    </span>
  );
}

/** The market's call: the YES price huge (binary) or every outcome with a bar and one-tap buy (multi). */
export function MarketCall({ market, order, flash, onBuy }: { market: PredictionMarketDetail; order: string[]; flash: Flash; onBuy: (code: string) => void }) {
  const winner = market.outcomes.find((outcome) => outcome.is_winner) ?? null;
  const settled = market.status === "resolved" || market.status === "voided";

  if (market.market_type === "binary") {
    const yes = market.outcomes.find((outcome) => outcome.outcome_code === "yes") ?? market.outcomes[0];
    const no = market.outcomes.find((outcome) => outcome.outcome_code === "no") ?? market.outcomes[1];
    const yesColor = outcomeColor(market, yes);
    if (settled) {
      const color = winner ? outcomeColor(market, winner) : "var(--dim)";
      return (
        <section className={styles.verdict} style={{ "--oc": color } as CSSProperties} aria-label="Result">
          {market.status === "voided" ? null : <SceneArt slot="predictions-verdict" width={96} className={styles.verdictArt} />}
          <small>{market.status === "voided" ? "No contest" : "The call"}</small>
          <strong>{market.status === "voided" ? "VOID" : upperLabel(winner)}</strong>
          <p>{market.status === "voided" ? "Voided. Everyone got their net cost back." : `${winner?.label ?? "?"} shares paid $1.00. Last traded at ${percent(yes.price)} ${yes.label}.`}</p>
        </section>
      );
    }
    return (
      <section className={styles.call} style={{ "--oc": yesColor } as CSSProperties} aria-label="Market price">
        <div className={styles.callMain}>
          <span className={styles.callLabel}>{yes.label}</span>
          <FlashNum flash={flash[yes.outcome_code]} className={styles.callPct}>
            {percent(yes.price)}
          </FlashNum>
          <span className={styles.callSub}>
            chance <Move value={yes.change_24h} /> <em>24h</em>
          </span>
        </div>
        {market.status === "open" ? (
        <div className={styles.callSide}>
          {[yes, no].map((outcome) => {
            const color = outcomeColor(market, outcome);
            return (
              <button key={outcome.outcome_code} type="button" className={styles.callBuy} style={{ "--oc": color, "--oc-ink": inkOn(color) } as CSSProperties} onClick={() => onBuy(outcome.outcome_code)} disabled={market.status !== "open"}>
                <span>Buy {outcome.label}</span>
                <FlashNum flash={flash[outcome.outcome_code]}>{cents(outcome.price)}</FlashNum>
              </button>
            );
          })}
        </div>
        ) : null}
      </section>
    );
  }

  const byCode = new Map(market.outcomes.map((outcome) => [outcome.outcome_code, outcome]));
  const rows = [...order.map((code) => byCode.get(code)).filter((outcome): outcome is Outcome => Boolean(outcome)), ...market.outcomes.filter((outcome) => !order.includes(outcome.outcome_code))];
  return (
    <section className={styles.board} aria-label="Outcomes">
      {settled ? (
        <div className={styles.verdictSmall} style={{ "--oc": winner ? outcomeColor(market, winner) : "var(--dim)" } as CSSProperties}>
          <small>{market.status === "voided" ? "No contest" : "The call"}</small>
          <strong>{market.status === "voided" ? "VOID" : winner?.label ?? "?"}</strong>
        </div>
      ) : null}
      <ol className={styles.rows}>
        {rows.map((outcome) => {
          const color = outcomeColor(market, outcome);
          return (
            <li key={outcome.outcome_code} className={styles.outcomeRow} data-winner={outcome.is_winner || undefined} data-loser={(market.status === "resolved" && !outcome.is_winner) || undefined} style={{ "--oc": color, "--oc-ink": inkOn(color), "--w": `${Math.max(0.5, outcome.price * 100)}%` } as CSSProperties}>
              <span className={styles.outcomeMark}>{outcome.asset ? <Oshimark icon={outcome.asset.icon} symbol={outcome.asset.symbol} size={24} /> : <i aria-hidden="true" />}</span>
              <span className={styles.outcomeName}>
                <b>{outcome.label}</b>
                {outcome.asset ? <small>{outcome.asset.symbol}</small> : null}
                {outcome.is_winner ? <em>WON</em> : null}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <i />
              </span>
              <FlashNum flash={flash[outcome.outcome_code]} className={styles.outcomePct}>
                {percent(outcome.price)}
              </FlashNum>
              <Move value={outcome.change_24h} />
              {market.status === "open" ? (
                <button type="button" className={styles.rowBuy} onClick={() => onBuy(outcome.outcome_code)} aria-label={`Buy ${outcome.label} at ${cents(outcome.price)}`}>
                  Buy {cents(outcome.price)}
                </button>
              ) : (
                <span className={styles.rowFinal}>{market.status === "voided" ? "refunded" : settled ? (outcome.is_winner ? "$1.00" : "$0") : centsFine(outcome.price)}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const upperLabel = (outcome: Outcome | null) => (outcome ? outcome.label.toUpperCase() : "?");
