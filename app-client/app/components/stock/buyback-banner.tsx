"use client";

import Link from "next/link";
import { FaSnowflake } from "react-icons/fa6";
import { ArtSlot } from "@/app/components/common/art-slot";
import { BuybackMeter } from "@/app/components/common/buyback-meter";
import { Term } from "@/app/components/common/tip";
import { untilText } from "@/app/components/market/dividends-tab";
import { n2 } from "@/app/components/trade/trade-ticket";
import { pctLabel, planOf, useBuybackSpotlight, type BuybackPlan } from "@/app/lib/buyback";
import { yourOfferShares } from "@/app/lib/buyback-plan.mjs";
import type { MarketAsset } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/stock/buyback-banner.module.scss";

const shares = (value: number) => Math.ceil(value).toLocaleString("en-US");

/**
 * The one line that says what to do, for a holder and for everyone else. `yours`: how many of the
 * holder's shares can get the offer (shares bought after the last tick before the buyback can't).
 */
export function buybackAdvice(symbol: string, plan: BuybackPlan, held: number, yours: number = held) {
  const premium = Math.round((plan.pct - 1) * 100);
  if (held > 0) {
    if (plan.backUnder) return `You hold ${shares(held)}. The extra shares are all sold back, so a sell now gets the frozen ${n2(plan.frozen)}. Hold on and trading reopens at the Open.`;
    if (yours <= 0) return `You hold ${shares(held)}, all bought after the last tick before the buyback, so a sell gets the frozen ${n2(plan.frozen)}.`;
    const count = yours < held ? `You hold ${shares(held)}; ${shares(yours)} get the offer.` : `You hold ${shares(held)}.`;
    if (premium > 0) return `${count} Sell now and the broker pays ${n2(plan.offer)} a share, ${premium}% more than the market price, while shares are left at the offer.`;
    return `${count} The offer is down to ${pctLabel(plan.pct)} of the market price. Whatever is still over on Saturday gets bought from every holder at the base rate.`;
  }
  return plan.backUnder
    ? `You can’t buy ${symbol} until trading reopens at the Open.`
    : `You can’t buy ${symbol} while it’s frozen. Buys open again once holders sell back under the max, or after Saturday’s evaluation.`;
}

/**
 * The stock page's buyback banner (the buyback-spotlight flag): the broker's offer as a big number
 * against the market price, the daily step-down with today lit, the countdowns to the next drop and
 * the end, how many shares are still bought at the offer, and what it means for you.
 */
export function BuybackBanner({ asset, held, eligible = null }: { asset: MarketAsset; held: number; eligible?: number | null }) {
  const shown = useBuybackSpotlight();
  const now = useNow();
  const openTrade = useTradeStore((state) => state.openTrade);
  if (!shown || now === null) return null;
  const plan = planOf(asset, now);
  if (!plan) return null;
  const yours = yourOfferShares({ held, eligible });
  const bought = asset.buyback?.shares_bought ?? 0;
  const total = bought + plan.over;
  const premium = plan.backUnder ? 0 : plan.pct - 1;
  const pose = held > 0 ? (premium > 0 && !plan.backUnder && yours > 0 ? "hype" : "cope") : "shock";

  return (
    <section className={styles.banner} aria-labelledby="buyback-title" data-tone={premium > 0 ? "over" : "under"}>
      <div className={styles.frost} aria-hidden />
      <ArtSlot kind="reaction" pose={pose} symbol={asset.symbol} icon={asset.icon} width={160} className={styles.art} />

      <div className={styles.offer}>
        <span className={styles.kicker}>
          <FaSnowflake aria-hidden /> <Term k="buyback">Buyback</Term> · frozen
        </span>
        {plan.backUnder ? (
          <h2 id="buyback-title" className={styles.big} data-done="">
            All sold back: <b>reopens at the Open</b>
          </h2>
        ) : (
          <>
            <h2 id="buyback-title" className={styles.big}>
              Broker pays <b>{pctLabel(plan.pct)}</b>
            </h2>
            <p className={styles.versus}>
              <span>
                <b>{n2(plan.offer)}</b> a share
              </span>
              <span className={styles.vs}>vs</span>
              <span>
                <b>{n2(plan.frozen)}</b> market price
              </span>
            </p>
          </>
        )}
        <p className={styles.advice}>{buybackAdvice(asset.symbol, plan, held, yours)}</p>
        <div className={styles.actions}>
          {held > 0 && !plan.backUnder ? (
            <button type="button" className={styles.sell} onClick={() => openTrade(asset.symbol, "sell")}>
              Sell to the broker · {n2(yours > 0 ? plan.offer : plan.frozen)}
            </button>
          ) : (
            <span className={styles.noBuy}>No buys while frozen</span>
          )}
          <Link href="/how-to-play#buybacks" className={styles.how}>
            How buybacks work →
          </Link>
        </div>
      </div>

      <div className={styles.schedule}>
        {plan.backUnder ? null : <BuybackMeter steps={plan.steps} endLabel="forced" />}
        <dl className={styles.clocks}>
          {plan.backUnder ? (
            <div data-tone="good">
              <dt>Back under the max</dt>
              <dd>
                Reopens at the Open in <b>{untilText(plan.endsAt - now)}</b>
              </dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Next drop</dt>
                <dd>{plan.nextStepAt !== null && plan.nextPct !== null ? <><b>{pctLabel(plan.nextPct)}</b> in <b>{untilText(plan.nextStepAt - now)}</b></> : "none: last day"}</dd>
              </div>
              <div>
                <dt>
                  <Term k="evaluation">Forced at the evaluation</Term>
                </dt>
                <dd>
                  in <b>{untilText(plan.forcedAt - now)}</b>
                </dd>
              </div>
            </>
          )}
        </dl>
        <div className={styles.left}>
          <div className={styles.leftHead}>
            <span>
              <b>{shares(plan.over)}</b> {plan.over === 1 ? "share" : "shares"} left at {pctLabel(plan.pct)}
            </span>
            <span className={styles.dim}>{shares(bought)} sold back</span>
          </div>
          <div className={styles.track} role="img" aria-label={`${shares(bought)} of ${shares(total)} extra shares sold back to the broker`}>
            <i style={{ width: `${total > 0 ? Math.min(100, (bought / total) * 100) : 100}%` }} />
          </div>
          <p className={styles.dim}>After those, sells get the frozen {n2(plan.frozen)}.</p>
        </div>
      </div>
    </section>
  );
}
