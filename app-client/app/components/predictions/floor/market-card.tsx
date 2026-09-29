"use client";

import Link from "next/link";
import { memo, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { useMarketTalent } from "@/app/components/predictions/floor/market-live";
import { centsDelta, cents, compactMoney, outcomeColor, percent, STATUS_LABEL, TEMPLATE_LABEL, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import type { Outcome, PredictionMarket } from "@/app/lib/predictions/types";
import { useNow } from "@/app/lib/use-now";
import styles from "@/app/components/predictions/floor/floor.module.scss";

export type Flash = { dir: "up" | "down"; n: number };

const marketHref = (market: PredictionMarket, outcome?: string) =>
  `/predictions/${encodeURIComponent(market.slug)}${outcome ? `?outcome=${encodeURIComponent(outcome)}` : ""}`;

/** Ticks every second; amber inside the last hour. */
export function Countdown({ to, prefix }: { to: string; prefix?: string }) {
  const now = useNow();
  const ms = now === null ? Infinity : new Date(to).getTime() - now;
  const soon = ms > 0 && ms < 3_600_000;
  return (
    <span className={styles.countdown} data-soon={soon || undefined} suppressHydrationWarning>
      {prefix ? <small>{prefix}</small> : null}
      {now === null ? "…" : timeLeft(to, now)}
    </span>
  );
}

function Badge({ market }: { market: PredictionMarket }) {
  const talent = useMarketTalent(market);
  if (market.kind === "auto") {
    return (
      <span className={styles.badge} data-kind="auto">
        <span>{TEMPLATE_LABEL[market.auto_template ?? ""] ?? "Auto"}</span>
        {talent ? (
          <span className={styles.badgeTalent}>
            <Oshimark icon={talent.icon} symbol={talent.symbol} size={13} />
            {talent.symbol}
          </span>
        ) : null}
      </span>
    );
  }
  return <span className={styles.badge}>{market.category?.display_name ?? "Event"}</span>;
}

function When({ market }: { market: PredictionMarket }) {
  const now = useNow();
  if (market.status === "open") {
    if (market.trading_status === "halted") return <span className={styles.statusTag} data-tone="warn">Halted</span>;
    if (now !== null && new Date(market.opens_at).getTime() > now) return <Countdown to={market.opens_at} prefix="opens" />;
    return <Countdown to={market.closes_at} />;
  }
  if (market.status === "resolved" || market.status === "voided") {
    const at = market.resolved_at || market.voided_at;
    return (
      <span className={styles.ago} suppressHydrationWarning>
        {at && now !== null ? `${timeAgo(at, now)} ago` : ""}
      </span>
    );
  }
  return (
    <span className={styles.statusTag} data-tone={market.status === "disputed" ? "warn" : market.status === "proposed" ? "blue" : undefined}>
      {STATUS_LABEL[market.status] ?? market.status}
    </span>
  );
}

function Stats({ market }: { market: PredictionMarket }) {
  return (
    <div className={styles.stats}>
      <span>
        <b>{compactMoney(market.volume_24h)}</b> 24h
      </span>
      <span>
        <b>{market.trades_24h}</b> {market.trades_24h === 1 ? "trade" : "trades"}
      </span>
      <span>
        <b>{compactMoney(market.total_volume_cash)}</b> vol
      </span>
    </div>
  );
}

const tone = (delta: number) => (Math.round(delta * 100) > 0 ? "up" : Math.round(delta * 100) < 0 ? "down" : "flat");
const flashClass = (flash?: Flash) => (flash ? (flash.dir === "up" ? styles.flashUp : styles.flashDown) : undefined);

function Winner({ market }: { market: PredictionMarket }) {
  if (market.status === "voided") {
    return (
      <div className={styles.result} data-void="true">
        <small>Voided</small>
        <strong>Money back</strong>
      </div>
    );
  }
  const winner = market.outcomes.find((outcome) => outcome.is_winner || String(outcome.id) === String(market.winning_outcome_id));
  if (!winner) return null;
  const color = outcomeColor(market, winner);
  return (
    <div className={styles.result} style={{ "--oc": color } as CSSProperties}>
      <small>Resolved</small>
      <strong>
        {winner.asset ? <Oshimark icon={winner.asset.icon} symbol={winner.asset.symbol} size={20} /> : null}
        {winner.label}
      </strong>
    </div>
  );
}

function BinaryBody({ market, flashes, tradeable }: { market: PredictionMarket; flashes: Record<string, Flash>; tradeable: boolean }) {
  const yes = market.outcomes.find((outcome) => outcome.outcome_code === "yes") ?? market.outcomes[0];
  const no = market.outcomes.find((outcome) => outcome.outcome_code === "no") ?? market.outcomes[1];
  if (!yes) return null;
  const flash = flashes[String(yes.id)] ?? (no ? flashes[String(no.id)] : undefined);
  const settled = market.status === "resolved" || market.status === "voided";
  const move = tone(yes.change_24h);
  const word = yes.label.toLowerCase() === "yes" ? "chance" : yes.label;
  return (
    <>
      {settled ? (
        <Winner market={market} />
      ) : (
        <div className={styles.binary}>
          <div className={styles.call}>
            <span key={flash ? `${yes.id}-${flash.n}` : yes.id} className={`${styles.big} ${flashClass(flash) ?? ""}`}>
              {percent(yes.price)}
            </span>
            <span className={styles.callMeta}>
              <span className={styles.callWord} style={{ color: outcomeColor(market, yes) }}>
                {word}
              </span>
              <span className={styles[move]}>{centsDelta(yes.change_24h)} 24h</span>
            </span>
          </div>
          <Sparkline values={yes.sparkline} tone={move === "flat" ? "blue" : move} className={styles.spark} fill dot />
        </div>
      )}
      {tradeable && no ? (
        <div className={styles.buttons}>
          {[yes, no].map((outcome) => (
            <Link
              key={outcome.id}
              href={marketHref(market, outcome.outcome_code)}
              className={styles.bet}
              style={{ "--oc": outcomeColor(market, outcome) } as CSSProperties}
              aria-label={`Bet ${outcome.label} at ${cents(outcome.price)} on ${market.title}`}
            >
              <span>{outcome.label}</span>
              <b>{cents(outcome.price)}</b>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

function OutcomeBar({ market, outcome, flash, tradeable }: { market: PredictionMarket; outcome: Outcome; flash?: Flash; tradeable: boolean }) {
  const color = outcomeColor(market, outcome);
  const settled = market.status === "resolved" || market.status === "voided";
  const content = (
    <>
      <span className={styles.barFill} style={{ width: `${Math.max(1.5, outcome.price * 100)}%` }} aria-hidden="true" />
      <span className={styles.barLabel}>
        {outcome.asset ? <Oshimark icon={outcome.asset.icon} symbol={outcome.asset.symbol} size={15} /> : <i className={styles.dot} aria-hidden="true" />}
        <span>{outcome.label}</span>
        {settled && outcome.is_winner ? <em className={styles.won}>won</em> : null}
      </span>
      <span key={flash ? `${outcome.id}-${flash.n}` : outcome.id} className={`${styles.barPrice} ${flashClass(flash) ?? ""}`}>
        {percent(outcome.price)}
      </span>
    </>
  );
  const style = { "--oc": color } as CSSProperties;
  if (!tradeable) {
    return (
      <div className={styles.bar} style={style} data-winner={settled && outcome.is_winner ? "true" : undefined}>
        {content}
      </div>
    );
  }
  return (
    <Link href={marketHref(market, outcome.outcome_code)} className={styles.bar} style={style} aria-label={`Bet ${outcome.label} at ${cents(outcome.price)}`}>
      {content}
    </Link>
  );
}

function MultiBody({ market, flashes, tradeable }: { market: PredictionMarket; flashes: Record<string, Flash>; tradeable: boolean }) {
  const ranked = [...market.outcomes].sort((a, b) => Number(b.is_winner) - Number(a.is_winner) || b.price - a.price);
  const top = ranked.slice(0, 3);
  const more = ranked.length - top.length;
  return (
    <div className={styles.bars}>
      {market.status === "voided" ? <Winner market={market} /> : null}
      {top.map((outcome) => (
        <OutcomeBar key={outcome.id} market={market} outcome={outcome} flash={flashes[String(outcome.id)]} tradeable={tradeable} />
      ))}
      {more > 0 ? (
        <Link href={marketHref(market)} className={styles.more}>
          +{more} more
        </Link>
      ) : null}
    </div>
  );
}

export const MarketCard = memo(function MarketCard({ market, flashes }: { market: PredictionMarket; flashes: Record<string, Flash> }) {
  const tradeable = market.status === "open" && market.trading_status === "open";
  return (
    <article className={styles.card} data-status={market.status}>
      <div className={styles.cardTop}>
        <Badge market={market} />
        <When market={market} />
      </div>
      <h3 className={styles.cardTitle}>
        <Link href={marketHref(market)}>{market.title}</Link>
      </h3>
      <div className={styles.cardBody}>
        {market.market_type === "multi" ? (
          <MultiBody market={market} flashes={flashes} tradeable={tradeable} />
        ) : (
          <BinaryBody market={market} flashes={flashes} tradeable={tradeable} />
        )}
      </div>
      <Stats market={market} />
    </article>
  );
});
