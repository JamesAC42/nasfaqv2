"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CAPSULE_COLOR,
  CAPSULE_DUP_SHARDS,
  CAPSULE_EPIC_EVERY,
  CAPSULE_HARD_PITY,
  CAPSULE_RARITIES,
  TYPE_LABEL,
  capsulePityFrom,
  capsuleRank,
  fetchCapsuleCatalog,
  fetchInventory,
  pullCapsule,
  type CapsuleCatalog,
  type CapsulePity,
  type CapsulePull,
  type CapsulePullResponse,
  type CapsuleRarity,
} from "@/app/components/games/gacha/capsule-types";
import { PityBar, PullButton, ShardGlyph } from "@/app/components/games/gacha/gacha-parts";
import { CapsuleBack, CapsuleBall, PrizeCard } from "@/app/components/games/gacha/prize-card";
import { RevealStage, type RevealItem, type RevealStat } from "@/app/components/games/gacha/reveal-stage";
import { GamesFrame, SignInToPlay, useGamesWallet } from "@/app/components/games/shell/games-frame";
import { gameErrorText } from "@/app/lib/games/errors";
import { fmtInteger } from "@/app/lib/format";
import { isCalm } from "@/app/providers/motion-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/gacha/capsule-gacha.module.scss";

// The capsule machine (GAMES_DESIGN.md §2): cosmetic prizes, $50 / $450, epic every 10th pull,
// legendary by 60, dupes pay shards. Reveals on the same stage as the card gacha.

const MOMENT: Partial<Record<CapsuleRarity, RevealItem["moment"]>> = {
  epic: { label: "EPIC!", color: CAPSULE_COLOR.epic },
  legendary: { label: "LEGENDARY!!", color: CAPSULE_COLOR.legendary, big: true },
};

const pct = (chance: number) => {
  const value = chance * 100;
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
};

function toRevealItem(pull: CapsulePull, index: number): RevealItem {
  const reward = pull.reward;
  const rarity = reward.rarity;
  const typeLabel = TYPE_LABEL[reward.type] ?? reward.type.replace(/_/g, " ");
  return {
    id: `${pull.id}-${index}`,
    rank: capsuleRank(rarity) * 10 + (pull.duplicate ? 0 : 1),
    glow: rarity === "common" ? null : CAPSULE_COLOR[rarity],
    moment: MOMENT[rarity] ?? null,
    label: `${reward.display_name}, ${rarity} ${typeLabel}${pull.duplicate ? `, duplicate, plus ${pull.shards} shards` : ", new"}`,
    name: reward.display_name,
    tier: `${rarity.toUpperCase()} · ${typeLabel}`,
    face: (width) => <PrizeCard prize={reward} width={width} isNew={!pull.duplicate} />,
    back: (width) => <CapsuleBack rarity={rarity} width={width} />,
    tags: pull.duplicate ? [{ text: `+${fmtInteger(pull.shards)}`, tone: "shards" }] : [{ text: "NEW", tone: "new" }],
  };
}

// Capsules in the globe: fixed positions so the machine looks the same every render.
const GLOBE_BALLS: { x: number; y: number; r: CapsuleRarity }[] = [
  { x: 4, y: 70, r: "common" },
  { x: 22, y: 76, r: "rare" },
  { x: 41, y: 79, r: "common" },
  { x: 60, y: 77, r: "epic" },
  { x: 78, y: 70, r: "common" },
  { x: 12, y: 55, r: "rare" },
  { x: 31, y: 60, r: "common" },
  { x: 50, y: 61, r: "legendary" },
  { x: 69, y: 56, r: "rare" },
  { x: 84, y: 50, r: "common" },
  { x: 21, y: 40, r: "common" },
  { x: 40, y: 44, r: "rare" },
  { x: 59, y: 40, r: "common" },
  { x: 6, y: 36, r: "epic" },
  { x: 75, y: 32, r: "rare" },
  { x: 46, y: 26, r: "common" },
];

export function CapsuleGachaPage() {
  const wallet = useGamesWallet();
  const signedIn = wallet.signedIn;
  const storePity = useGamesStore((state) => state.collection?.pity?.capsule ?? null);

  const [catalog, setCatalog] = useState<CapsuleCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [owned, setOwned] = useState<Set<string> | null>(null);
  const [pityOverride, setPityOverride] = useState<CapsulePity | null>(null);
  const [busy, setBusy] = useState<1 | 10 | null>(null);
  const [drop, setDrop] = useState<CapsuleRarity | null>(null);
  const cranking = drop !== null;
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(CapsulePullResponse & { batch: string }) | null>(null);
  const inFlight = useRef(false);
  const batchSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchCapsuleCatalog()
      .then((data) => alive && setCatalog(data))
      .catch((reason) => alive && setCatalogError(gameErrorText(reason)));
    return () => {
      alive = false;
    };
  }, []);

  const loadOwned = useCallback(() => {
    fetchInventory()
      .then((data) => setOwned(new Set(data.cosmetics.map((item) => item.cosmetic_key))))
      .catch(() => setOwned(null));
  }, []);

  useEffect(() => {
    if (signedIn) loadOwned();
  }, [signedIn, loadOwned]);

  const pity = pityOverride ?? (storePity ? capsulePityFrom(storePity.pulls_since_sr, storePity.pulls_since_ssr) : null);
  const costOne = catalog ? catalog.game.config.pull_cost_cash ?? catalog.game.entry_fee_cash : null;
  const costTen = catalog ? catalog.game.config.ten_pull_cost_cash ?? null : null;

  const groups = useMemo(() => {
    const rewards = catalog?.rewards ?? [];
    return [...CAPSULE_RARITIES]
      .reverse()
      .map((rarity) => {
        const items = rewards.filter((reward) => reward.rarity === rarity);
        return { rarity, items, chance: items.reduce((sum, item) => sum + (item.pull_chance || 0), 0) };
      })
      .filter((group) => group.items.length);
  }, [catalog]);

  const ownedCount = owned && catalog ? catalog.rewards.filter((reward) => owned.has(reward.cosmetic_key)).length : null;

  const pull = useCallback(
    async (count: 1 | 10) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(count);
      setError(null);
      try {
        const response = await pullCapsule(count);
        setPityOverride(response.pity);
        useGamesStore.getState().setShards(response.shards);
        void useProfileStore.getState().fetchPortfolio();
        void useGamesStore.getState().loadCollection({ quiet: true });
        loadOwned();
        const open = () => {
          batchSeq.current += 1;
          setResult({ ...response, batch: `capsule-${batchSeq.current}` });
          setDrop(null);
        };
        // The crank turns and a capsule drops before the stage opens (skipped in calm mode or on a re-pull).
        if (isCalm() || result) open();
        else {
          // The capsule that drops is the colour of the best prize inside the batch.
          const best = response.pulls.reduce<CapsuleRarity>((top, item) => (capsuleRank(item.reward.rarity) > capsuleRank(top) ? item.reward.rarity : top), "common");
          setDrop(best);
          window.setTimeout(open, 1100);
        }
      } catch (reason) {
        setError(gameErrorText(reason));
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [loadOwned, result],
  );

  const items = useMemo(() => (result ? result.pulls.map(toRevealItem) : []), [result]);
  const stats = useMemo<RevealStat[]>(() => {
    if (!result) return [];
    return [
      { label: "New", value: result.pulls.filter((item) => !item.duplicate).length, tone: "new" },
      {
        label: "Shards",
        value: (
          <>
            <ShardGlyph />+{fmtInteger(result.shards_awarded)}
          </>
        ),
        tone: "shards",
      },
      { label: "Epic+", value: result.pulls.filter((item) => capsuleRank(item.reward.rarity) >= 2).length },
    ];
  }, [result]);

  const againCount = (result?.pulls.length === 1 ? 1 : 10) as 1 | 10;
  const againCost = againCount === 1 ? costOne : costTen;

  return (
    <GamesFrame
      kicker="Games · Capsule"
      title="Capsule machine"
      blurb={
        <>
          <b>${costOne ?? 50}</b> a capsule, <b>${costTen ?? 450}</b> for ten. Hats, frames and flair that show up next to your name.
        </>
      }
    >
      <div className={styles.layout}>
        <section className={styles.machineCol} aria-label="Capsule machine">
          <div className={styles.machine} data-cranking={cranking || busy !== null || undefined}>
            <div className={styles.globe} aria-hidden="true">
              <div className={styles.balls}>
                {GLOBE_BALLS.map((ball, index) => (
                  <CapsuleBall
                    key={index}
                    rarity={ball.r}
                    size={20}
                    style={{ left: `${ball.x}%`, top: `${ball.y}%`, "--d": `${(index % 5) * 90}ms` } as CSSProperties}
                  />
                ))}
              </div>
              <span className={styles.glass} />
              <span className={styles.season}>Season 1</span>
            </div>
            <div className={styles.neck} aria-hidden="true" />
            <div className={styles.body} aria-hidden="true">
              <span className={styles.price}>
                <small>1 capsule</small>
                <b>${costOne ?? 50}</b>
              </span>
              <span className={styles.crank}>
                <i />
              </span>
              <span className={styles.chute}>{drop ? <CapsuleBall rarity={drop} size={28} /> : null}</span>
            </div>
            <div className={styles.base} aria-hidden="true" />
          </div>

          <div className={styles.controls}>
            {signedIn ? (
              <>
                <div className={styles.pullButtons}>
                  <PullButton count={1} cost={costOne} busy={busy === 1} disabled={busy !== null || cranking} onClick={() => void pull(1)} />
                  <PullButton count={10} cost={costTen} busy={busy === 10} disabled={busy !== null || cranking} onClick={() => void pull(10)} primary />
                </div>
                {error && !result ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
              </>
            ) : (
              <SignInToPlay what="turn the crank" />
            )}
          </div>

          <div className={styles.pity}>
            <header className={styles.sectionHead}>
              <h2>Pity</h2>
              {pity ? <span>Epic every {CAPSULE_EPIC_EVERY} · legendary by {CAPSULE_HARD_PITY}</span> : null}
            </header>
            {signedIn ? (
              <>
                <PityBar label="Epic+ guaranteed in" left={pity?.epic_guaranteed_in ?? null} done={pity?.pulls_since_epic ?? null} total={CAPSULE_EPIC_EVERY} color={CAPSULE_COLOR.epic} />
                <PityBar
                  label="Legendary guaranteed in"
                  left={pity?.legendary_guaranteed_in ?? null}
                  done={pity?.pulls_since_legendary ?? null}
                  total={CAPSULE_HARD_PITY}
                  color={CAPSULE_COLOR.legendary}
                />
              </>
            ) : (
              <ul className={styles.rules}>
                <li>
                  Every <b>{CAPSULE_EPIC_EVERY}th</b> capsule is epic or better.
                </li>
                <li>
                  Capsule <b>{CAPSULE_HARD_PITY}</b> is a guaranteed legendary.
                </li>
                <li>Dupes pay shards instead of nothing.</li>
              </ul>
            )}
          </div>

          <Link href="/games/item-locker" className={styles.lockerLink}>
            <span>
              <small>Your locker</small>
              <b>{ownedCount === null ? "Equip what you pulled" : `${ownedCount} of ${catalog?.rewards.length ?? 0} owned · equip them`}</b>
            </span>
            <em aria-hidden="true">→</em>
          </Link>
        </section>

        <section className={styles.pool} aria-labelledby="prize-pool-title">
          <header className={styles.sectionHead}>
            <h2 id="prize-pool-title">Prize pool</h2>
            {catalog ? <span>{catalog.rewards.length} prizes</span> : null}
          </header>
          {catalogError ? <p className={styles.empty}>Couldn&apos;t load the prize pool. {catalogError}</p> : null}
          {!catalog && !catalogError ? <p className={styles.empty}>Loading prizes…</p> : null}
          <div className={styles.groups}>
          {groups.map((group) => (
            <div key={group.rarity} className={styles.group} style={{ "--rc": CAPSULE_COLOR[group.rarity] } as CSSProperties}>
              <div className={styles.groupHead}>
                <b>{group.rarity}</b>
                <span>{pct(group.chance)}</span>
                <small>
                  Dupe pays <ShardGlyph />
                  {CAPSULE_DUP_SHARDS[group.rarity]}
                </small>
              </div>
              <ul className={styles.prizes}>
                {group.items.map((reward) => {
                  const have = owned?.has(reward.cosmetic_key) ?? false;
                  return (
                    <li key={reward.key} className={styles.prize} data-owned={have || undefined}>
                      <PrizeCard prize={reward} width={148} />
                      <div className={styles.prizeMeta}>
                        <span className={styles.odds}>{pct(reward.pull_chance)}</span>
                        {owned ? have ? <span className={styles.owned}>Owned</span> : <span className={styles.missing}>Not yet</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          </div>

          <details className={styles.details}>
            <summary>
              <span>Rules</span>
            </summary>
            <ul>
              <li>Each capsule rolls against the odds above. A ten-pull is ten single pulls back to back.</li>
              <li>
                Every {CAPSULE_EPIC_EVERY}th capsule is epic or better. Capsule {CAPSULE_HARD_PITY} is legendary. Both counters reset when you hit one.
              </li>
              <li>
                Dupes pay shards: common {CAPSULE_DUP_SHARDS.common}, rare {CAPSULE_DUP_SHARDS.rare}, epic {CAPSULE_DUP_SHARDS.epic}, legendary{" "}
                {CAPSULE_DUP_SHARDS.legendary}. Spend them crafting <Link href="/games/collection">talent cards</Link>.
              </li>
              <li>
                Prizes land in your <Link href="/games/item-locker">locker</Link>. Equip them there.
              </li>
            </ul>
          </details>
        </section>
      </div>

      <RevealStage
        batchKey={result?.batch ?? null}
        items={items}
        title={result ? `${result.pulls.length === 1 ? "1 capsule" : "10 capsules"} · Season 1` : ""}
        stats={stats}
        againLabel={`PULL ×${againCount} AGAIN · $${againCost === null ? "—" : fmtInteger(againCost)}`}
        againBusy={busy !== null}
        againError={result ? error : null}
        onAgain={() => void pull(againCount)}
        onClose={() => {
          setResult(null);
          setError(null);
        }}
        extra={<Link href="/games/item-locker">Equip in locker</Link>}
      />
    </GamesFrame>
  );
}
