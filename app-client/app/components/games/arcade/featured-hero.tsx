"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { CardBack, TalentCard } from "@/app/components/games/cards/talent-card";
import { fmtCash, fmtLeft } from "@/app/components/games/arcade/arcade-format";
import { usePhone } from "@/app/components/games/arcade/use-media";
import { cardKey } from "@/app/lib/games/rarity";
import type { BannersResponse, Pity, Rarity, Talent, TalentCard as OwnedCard } from "@/app/lib/games/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import styles from "@/app/components/games/arcade/hero.module.scss";

const POWER: Record<Rarity, number> = { C: 10, R: 14, SR: 19, SSR: 25, UR: 32 };

/** Family-name-first talents go by the last word: "Ayunda Risu" is Risu. */
export const callName = (name: string) => name.trim().split(/\s+/).pop() ?? name;

export function FeaturedHero({
  banners,
  signedIn,
  pity,
  owned,
}: {
  banners: BannersResponse | null;
  signedIn: boolean;
  pity: Pity | null;
  owned: OwnedCard[] | null;
}) {
  const phone = usePhone();
  const featured = banners?.banners.find((banner) => banner.kind === "featured" && banner.featured) ?? null;
  const talent = featured?.featured ?? null;
  const endsAt = featured?.ends_at ? new Date(featured.ends_at).getTime() : null;
  const left = useRemaining(endsAt, 1000);
  const single = banners?.pull_cost_cash ?? 100;
  const ten = banners?.ten_pull_cost_cash ?? 900;
  const href = signedIn ? "/games/cards" : "/login?next=/games/cards";

  const front = phone ? 176 : 248;
  const side = phone ? 128 : 184;

  if (!banners) {
    return (
      <section className={styles.hero} aria-busy="true" aria-label="Featured banner">
        <div className={styles.copy}>
          <span className={styles.kicker}>Featured banner</span>
          <span className={styles.skelName} />
          <span className={styles.skelLine} />
        </div>
        <div className={styles.fan} style={{ "--front": `${front}px`, "--side": `${side}px` } as CSSProperties}>
          <CardBack width={front} className={styles.front} />
        </div>
      </section>
    );
  }

  if (!talent) {
    return (
      <section className={styles.hero} aria-label="Card gacha">
        <div className={styles.copy}>
          <span className={styles.kicker}>Standard banner</span>
          <h2 className={styles.name}>Every talent. Every rarity.</h2>
          <p className={styles.hook}>No rate-up this week, so the whole roster is in the pot. Chase a UR and show it off.</p>
          <div className={styles.ctas}>
            <Link href={href} className={styles.primary}>
              {signedIn ? `Pull · ${fmtCash(single)}` : "Sign in to pull"}
            </Link>
          </div>
        </div>
        <div className={styles.fan} style={{ "--front": `${front}px`, "--side": `${side}px` } as CSSProperties}>
          <CardBack width={side} glow="SR" className={styles.left} />
          <CardBack width={side} glow="SSR" className={styles.right} />
          <CardBack width={front} glow="UR" className={styles.front} />
        </div>
      </section>
    );
  }

  const first = callName(talent.name);
  const face = (rarity: Rarity) => ({ ...(talent as Talent), rarity, power: POWER[rarity], stars: 1 });
  const ownedUr = owned?.find((card) => card.key === cardKey(talent.symbol, "UR")) ?? null;
  const ownedSsr = owned?.find((card) => card.key === cardKey(talent.symbol, "SSR")) ?? null;
  const accent = talentAccent(talent.color);

  let pityLine: string | null = null;
  if (signedIn && pity) {
    if (pity.featured_guaranteed) pityLine = `Your next SSR+ is ${first}. Guaranteed.`;
    else if (pity.soft_pity_active) pityLine = `Soft pity's on. SSR+ odds are climbing every pull.`;
    else pityLine = `SSR+ guaranteed in ${pity.ssr_guaranteed_in} pulls.`;
  }

  return (
    <section className={styles.hero} style={{ "--tal": accent } as CSSProperties} aria-labelledby="arcade-featured">
      <div className={styles.backdrop} aria-hidden="true">
        <ArtSlot kind="keyart" symbol={talent.symbol} icon={talent.icon} accent={accent} width={720} className={styles.keyart} priority />
        <span className={styles.ghost}>{talent.symbol}</span>
      </div>

      <div className={styles.copy}>
        <span className={styles.kicker}>
          <span className={styles.rateUp}>Rate up</span>
          Featured banner · this week
        </span>
        <h2 id="arcade-featured" className={styles.name}>
          <Oshimark icon={talent.icon} symbol={talent.symbol} size={phone ? 26 : 36} className={styles.mark} />
          {talent.name}
        </h2>
        <p className={styles.unit}>
          <b>{talent.symbol}</b>
          {talent.unit ? <span>{unitLabel(talent.unit)}</span> : null}
        </p>
        <p className={styles.hook}>
          Every SSR and UR is a coin flip for {first}. Lose the flip and the next one&apos;s a lock.
        </p>

        <dl className={styles.stats}>
          <div>
            <dt>Ends in</dt>
            <dd suppressHydrationWarning>{endsAt ? fmtLeft(left) : "—"}</dd>
          </div>
          <div>
            <dt>UR odds</dt>
            <dd>0.5%</dd>
          </div>
          <div>
            <dt>{talent.symbol} UR</dt>
            <dd className={styles.ur}>{ownedUr ? `Owned ★${ownedUr.stars}` : ownedSsr ? "SSR only" : signedIn && owned ? "Not yet" : "32 PWR"}</dd>
          </div>
        </dl>

        <div className={styles.ctas}>
          <Link href={href} className={styles.primary}>
            {signedIn ? `Pull ×1 · ${fmtCash(single)}` : "Sign in to pull"}
          </Link>
          <Link href={href} className={styles.secondary}>
            {signedIn ? `Pull ×10 · ${fmtCash(ten)}` : `×10 · ${fmtCash(ten)}`}
          </Link>
        </div>
        {pityLine ? <p className={styles.pity}>{pityLine}</p> : null}
      </div>

      <Link href={href} className={styles.fan} style={{ "--front": `${front}px`, "--side": `${side}px` } as CSSProperties} aria-label={`${talent.name} banner: go pull`}>
        <TalentCard card={face("SR")} width={side} className={styles.left} tilt={false} />
        <TalentCard card={face("SSR")} width={side} className={styles.right} tilt={false} />
        <TalentCard card={face("UR")} width={front} className={styles.front} ribbon="RATE UP" />
      </Link>
    </section>
  );
}
