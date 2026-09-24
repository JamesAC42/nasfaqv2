"use client";

import { useState, type CSSProperties } from "react";
import { FaCheck } from "react-icons/fa6";
import { Oshimark } from "@/app/components/common/oshimark";
import { fmtInteger } from "@/app/lib/format";
import { claimReward } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { RARITY_COLOR, rarityRank } from "@/app/lib/games/rarity";
import type { SetProgress, UnitSet } from "@/app/lib/games/types";
import { unitLabel } from "@/app/lib/market-units";
import { useGamesStore } from "@/app/stores/games-store";
import type { CollectionModel } from "@/app/components/games/collection/collection-model";
import styles from "@/app/components/games/collection/unit-sets.module.scss";

type Tier = "roster" | "spotlight";

const TIER: Record<Tier, { label: string; rule: string; prize: string }> = {
  roster: { label: "Roster", rule: "any card of every member", prize: "badge" },
  spotlight: { label: "Spotlight", rule: "every member at SR+", prize: "frame" },
};

const ready = (progress: SetProgress) => progress.complete && !progress.claimed;

/** Unit sets: collect the roster, then spotlight it. Each tier pays shards and a cosmetic. */
export function UnitSets({ sets, model }: { sets: UnitSet[]; model: CollectionModel }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);

  const claimable = sets.flatMap((set) => (["roster", "spotlight"] as Tier[]).filter((tier) => ready(set[tier]) && claimed[`set:${set.key}:${tier}`] === undefined).map((tier) => `set:${set.key}:${tier}`));
  const [expanded, setExpanded] = useState(false);
  const rank = (set: UnitSet) => {
    const open = (["roster", "spotlight"] as Tier[]).some((tier) => ready(set[tier]) && claimed[`set:${set.key}:${tier}`] === undefined);
    if (open) return 0;
    if (set.spotlight.claimed || claimed[`set:${set.key}:spotlight`] !== undefined) return 3;
    return set.roster.have > 0 ? 1 : 2;
  };
  // Ready to claim first, then in progress, then untouched, then mastered. Stable within a rank.
  const [order] = useState(() => [...sets].sort((a, b) => rank(a) - rank(b)).map((set) => set.key));
  const sorted = [...sets].sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const rosters = sets.filter((set) => set.roster.complete).length;
  const spotlights = sets.filter((set) => set.spotlight.complete).length;

  async function claimOne(rewardKey: string) {
    const result = await claimReward(rewardKey);
    useGamesStore.getState().setShards(result.shards);
    setClaimed((current) => ({ ...current, [rewardKey]: result.reward.shards }));
    return result.reward.shards;
  }

  async function claim(rewardKey: string) {
    setBusy(rewardKey);
    setErrors((current) => ({ ...current, [rewardKey]: "" }));
    setSummary(null);
    try {
      await claimOne(rewardKey);
    } catch (err) {
      if (String((err as Error).message) === "reward_already_claimed") setClaimed((current) => ({ ...current, [rewardKey]: 0 }));
      else setErrors((current) => ({ ...current, [rewardKey]: gameErrorText(err) }));
    } finally {
      setBusy(null);
      void useGamesStore.getState().loadCollection({ quiet: true });
    }
  }

  async function claimAll() {
    setBusy("all");
    setSummary(null);
    let shards = 0;
    let badges = 0;
    let frames = 0;
    try {
      for (const key of claimable) {
        try {
          shards += await claimOne(key);
          if (key.endsWith(":roster")) badges += 1;
          else frames += 1;
        } catch (err) {
          if (String((err as Error).message) !== "reward_already_claimed") throw err;
        }
      }
    } catch (err) {
      setSummary(gameErrorText(err));
    } finally {
      const parts = [`+${fmtInteger(shards)} shards`, badges ? `${badges} badge${badges === 1 ? "" : "s"}` : "", frames ? `${frames} frame${frames === 1 ? "" : "s"}` : ""].filter(Boolean);
      if (shards) setSummary((current) => current ?? parts.join(" · "));
      setBusy(null);
      void useGamesStore.getState().loadCollection({ quiet: true });
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="sets-title">
      <div className={styles.head}>
        <h2 id="sets-title" className={styles.heading}>
          Unit sets
          <small>
            {rosters}/{sets.length} rosters · {spotlights}/{sets.length} spotlights
          </small>
        </h2>
        <p className={styles.legend}>
          <b>Roster</b> a card of every member · <b>Spotlight</b> every member at SR+
        </p>
        <div className={styles.headRight}>
          <span className={styles.summary} aria-live="polite">
            {summary}
          </span>
          {claimable.length > 1 ? (
            <button type="button" className={styles.claimAll} onClick={() => void claimAll()} disabled={busy !== null}>
              {busy === "all" ? "Claiming…" : `Claim all · ${claimable.length}`}
            </button>
          ) : null}
        </div>
      </div>

      <ul className={styles.grid} data-expanded={expanded || undefined}>
        {sorted.map((set) => {
          const anyReady = (["roster", "spotlight"] as Tier[]).some((tier) => ready(set[tier]) && claimed[`set:${set.key}:${tier}`] === undefined);
          const mastered = set.spotlight.claimed || claimed[`set:${set.key}:spotlight`] !== undefined;
          return (
            <li key={set.key} className={styles.set} data-ready={anyReady || undefined} data-mastered={mastered || undefined}>
              <div className={styles.setHead}>
                <b className={styles.unit}>{unitLabel(set.label)}</b>
                <span className={styles.count}>
                  {set.roster.have}/{set.total}
                </span>
              </div>
              <div className={styles.marks}>
                {set.members.map((member) => {
                  const talent = model.bySymbol.get(member.symbol)?.talent;
                  return (
                    <span
                      key={member.symbol}
                      className={styles.member}
                      data-on={Boolean(member.best) || undefined}
                      data-rarity={member.best ?? undefined}
                      data-hi={member.best && rarityRank(member.best) >= 2 ? true : undefined}
                      style={member.best ? ({ "--rc": RARITY_COLOR[member.best] } as CSSProperties) : undefined}
                      title={`${talent?.name ?? member.symbol}: ${member.best ? `best ${member.best}` : "missing"}`}
                    >
                      <Oshimark icon={talent?.icon} symbol={member.symbol} size={24} />
                    </span>
                  );
                })}
              </div>
              {(["roster", "spotlight"] as Tier[]).map((tier) => {
                const progress = set[tier];
                const rewardKey = `set:${set.key}:${tier}`;
                const justClaimed = claimed[rewardKey];
                const isClaimed = progress.claimed || justClaimed !== undefined;
                const canClaim = progress.complete && !isClaimed;
                return (
                  <div key={tier} className={styles.tier} data-state={isClaimed ? "claimed" : canClaim ? "ready" : "open"}>
                    <span className={styles.tierName} title={TIER[tier].rule}>
                      {TIER[tier].label}
                    </span>
                    <span className={styles.bar} aria-hidden="true">
                      <i style={{ width: `${(progress.have / Math.max(1, set.total)) * 100}%` }} />
                    </span>
                    <span className={styles.have} aria-label={`${progress.have} of ${set.total}`}>
                      {progress.have}/{set.total}
                    </span>
                    {isClaimed ? (
                      <span className={styles.claimed} aria-live="polite">
                        {justClaimed ? <em className={styles.pop}>+{fmtInteger(justClaimed)}</em> : null}
                        <FaCheck aria-hidden="true" /> {TIER[tier].prize}
                      </span>
                    ) : canClaim ? (
                      <button type="button" className={styles.claim} onClick={() => void claim(rewardKey)} disabled={busy !== null} aria-label={`Claim ${unitLabel(set.label)} ${TIER[tier].label}: ${fmtInteger(progress.reward_shards)} shards and a ${TIER[tier].prize}`}>
                        {busy === rewardKey ? (
                          "…"
                        ) : (
                          <>
                            Claim <i className={styles.shard} aria-hidden="true" />
                            {fmtInteger(progress.reward_shards)}
                          </>
                        )}
                      </button>
                    ) : (
                      <span className={styles.prize} title={`${fmtInteger(progress.reward_shards)} shards and a ${TIER[tier].prize}`}>
                        <i className={styles.shard} aria-hidden="true" />
                        {fmtInteger(progress.reward_shards)} + {TIER[tier].prize}
                      </span>
                    )}
                    {errors[rewardKey] ? (
                      <p className={styles.error} role="alert">
                        {errors[rewardKey]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {sets.length > 3 ? (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} data-count={sets.length}>
          {expanded ? "Fewer sets" : `All ${sets.length} sets`}
        </button>
      ) : null}
    </section>
  );
}
