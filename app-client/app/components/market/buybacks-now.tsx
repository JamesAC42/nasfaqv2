"use client";

import Link from "next/link";
import { FaSnowflake } from "react-icons/fa6";
import { ArtSlot } from "@/app/components/common/art-slot";
import { BuybackPill } from "@/app/components/common/buyback-badge";
import { BuybackMeter } from "@/app/components/common/buyback-meter";
import { Term } from "@/app/components/common/tip";
import { untilText } from "@/app/components/market/dividends-tab";
import { n2 } from "@/app/components/trade/trade-ticket";
import { pctLabel, planOf, useBuybackAssets } from "@/app/lib/buyback";
import { talentAccent } from "@/app/lib/talent-color";
import { useNow } from "@/app/lib/use-now";
import { useTheme } from "@/app/providers/theme-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/market/buybacks-now.module.scss";

/**
 * Buybacks now (the buyback-spotlight flag), on Home and the market floor: every stock frozen for a
 * buyback, with today's offer, the step-down, the shares left at the offer and, for a holder, a
 * sell button. Nothing shows while none are on.
 */
export function BuybacksNow({ className }: { className?: string }) {
  const assets = useBuybackAssets();
  const now = useNow();
  const { theme } = useTheme();
  const holdings = useProfileStore((state) => state.portfolio?.holdings ?? null);
  const openTrade = useTradeStore((state) => state.openTrade);
  if (!assets.length || now === null) return null;

  return (
    <section className={[styles.strip, className].filter(Boolean).join(" ")} aria-labelledby="buybacks-now-title">
      <header className={styles.head}>
        <h2 id="buybacks-now-title">
          <FaSnowflake aria-hidden className={styles.flake} /> Buybacks now <span className={styles.count}>{assets.length}</span>
        </h2>
        <p>
          Frozen: nobody can buy. The broker pays <b>more than the market price</b> for the extra shares, a little less every day. Holders: selling early pays best.{" "}
          <Link href="/how-to-play#buybacks">How it works →</Link>
        </p>
      </header>
      <div className={styles.cards}>
        {assets.map((asset) => {
          const plan = planOf(asset, now);
          if (!plan) return null;
          const held = holdings?.find((holding) => holding.symbol.toUpperCase() === asset.symbol)?.quantity ?? 0;
          const accent = talentAccent(asset.color, theme);
          return (
            <article key={asset.symbol} className={styles.card} style={{ "--tal": accent } as React.CSSProperties} data-held={held > 0 ? "" : undefined}>
              <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.who} data-peek-stock={asset.symbol} prefetch={false}>
                <ArtSlot kind="reaction" pose={held > 0 ? "hype" : "shock"} symbol={asset.symbol} icon={asset.icon} accent={accent} width={96} className={styles.art} />
                <span className={styles.name}>
                  <b>{asset.symbol}</b>
                  <small>{asset.display_name}</small>
                </span>
                <BuybackPill asset={asset} now={now} size="sm" />
              </Link>
              {plan.backUnder ? (
                <p className={styles.offer}>
                  <span>
                    <b className={styles.done}>All sold back</b>
                  </span>
                  <span className={styles.dim}>frozen at {n2(plan.frozen)}</span>
                </p>
              ) : (
                <p className={styles.offer}>
                  <span>
                    Broker pays <b>{pctLabel(plan.pct)}</b>
                  </span>
                  <span className={styles.dim}>
                    {n2(plan.offer)} vs {n2(plan.frozen)}
                  </span>
                </p>
              )}
              {plan.backUnder ? null : <BuybackMeter steps={plan.steps} endLabel={null} size="sm" />}
              <p className={styles.facts}>
                {plan.backUnder ? (
                  <>Back under the max: reopens at the Open in {untilText(plan.endsAt - now)}.</>
                ) : (
                  <>
                    <b>{Math.ceil(plan.over).toLocaleString("en-US")}</b> shares left at the offer
                    {plan.nextStepAt !== null && plan.nextPct !== null ? <> · {pctLabel(plan.nextPct)} in {untilText(plan.nextStepAt - now)}</> : <> · last day</>}
                  </>
                )}
              </p>
              {held > 0 && !plan.backUnder ? (
                <button type="button" className={styles.sell} onClick={() => openTrade(asset.symbol, "sell")}>
                  You hold {Math.round(held).toLocaleString("en-US")} · Sell
                </button>
              ) : (
                <span className={styles.note}>
                  {held > 0 ? `You hold ${Math.round(held).toLocaleString("en-US")} · ` : ""}
                  <Term k="buyback">No buys</Term> until it ends
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
