"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { CollectionStats } from "@/app/components/games/collection/collection-stats";
import { PullTeaser } from "@/app/components/games/collection/pull-teaser";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fetchCapsuleGachaCatalog, fetchGameItemLocker, fetchGamesInventory } from "@/app/lib/games-api";
import { gameErrorText } from "@/app/lib/games/errors";
import { RARITIES } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import type { GachaCatalogReward, GameCosmetic, GameInventoryResponse } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { CosmeticTile } from "@/app/components/games/locker/cosmetic-tile";
import {
  cosmeticRank,
  displayName,
  equipCosmetic,
  unequipCosmetic,
  foldPulls,
  imageOf,
  setRewardOf,
  slotFor,
  typeIndex,
  typeLabel,
  type LockerPrize,
} from "@/app/components/games/locker/cosmetics";
import { TrophyShelf } from "@/app/components/games/locker/trophy-shelf";
import styles from "@/app/components/games/locker/locker.module.scss";

const SLOT_LABEL: Record<string, string> = { hat: "Hat", profile_frame: "Frame", profile_badge: "Badge", chat_flair: "Flair" };

export function LockerPage() {
  const { user, initialized } = useAuth();

  const aside = (
    <div className={styles.links}>
      <Link href="/games/collection" className={styles.link}>
        Collection
      </Link>
      <Link href="/games/capsule" className={styles.linkPrimary}>
        Capsule
      </Link>
    </div>
  );

  if (initialized && !user) {
    return (
      <GamesFrame kicker="Locker" title="My locker" aside={aside}>
        <PullTeaser>
          <h2>Your trophy case</h2>
          <p>Five pinned cards under the lights, every hat and frame from the capsule, and the badges you earn finishing unit sets.</p>
          <SignInToPlay what="open your locker" />
        </PullTeaser>
      </GamesFrame>
    );
  }

  if (!user) {
    return (
      <GamesFrame kicker="Locker" title="My locker" aside={aside}>
        <div className={styles.loading} aria-busy="true" />
      </GamesFrame>
    );
  }

  return <MyLocker username={user.username} pictureUrl={user.profile_picture_url} color={user.profile_color} aside={aside} />;
}

function MyLocker({ username, pictureUrl, color, aside }: { username: string; pictureUrl: string | null; color: string | null; aside: React.ReactNode }) {
  const collection = useGamesStore((state) => state.collection);
  const [inventory, setInventory] = useState<GameInventoryResponse | null>(null);
  const [prizes, setPrizes] = useState<LockerPrize[]>([]);
  const [catalog, setCatalog] = useState<GachaCatalogReward[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    void useGamesStore.getState().loadCollection({ quiet: true });
    let alive = true;
    fetchGamesInventory()
      .then((result) => alive && setInventory(result))
      .catch((error) => alive && setLoadError(gameErrorText(error)));
    fetchGameItemLocker()
      .then((result) => alive && setPrizes(foldPulls(result.items)))
      .catch(() => undefined);
    fetchCapsuleGachaCatalog()
      .then((result) => alive && setCatalog(result.rewards))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const showcase = useMemo(() => {
    if (!collection) return [];
    const byKey = new Map(collection.cards.map((card) => [card.key, card]));
    return [...collection.showcase]
      .sort((a, b) => a.slot - b.slot)
      .map((slot) => byKey.get(slot.card_key))
      .filter((card): card is NonNullable<typeof card> => Boolean(card));
  }, [collection]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<Rarity, number>;
    for (const card of collection?.cards ?? []) result[card.rarity] += 1;
    return result;
  }, [collection]);

  const equippedIds = useMemo(() => new Map((inventory?.equipped ?? []).map((entry) => [entry.cosmetic.id, entry.slot_key])), [inventory]);
  const equippedBySlot = useMemo(() => new Map((inventory?.equipped ?? []).map((entry) => [entry.slot_key, entry.cosmetic])), [inventory]);
  const pullsByKey = useMemo(() => new Map(prizes.map((prize) => [prize.key, prize.pulls])), [prizes]);

  const { capsuleGroups, setRewards } = useMemo(() => {
    const cosmetics = inventory?.cosmetics ?? [];
    const sets = cosmetics.filter((cosmetic) => setRewardOf(cosmetic));
    const capsule = cosmetics.filter((cosmetic) => !setRewardOf(cosmetic));
    const ownedKeys = new Set(capsule.map((cosmetic) => cosmetic.cosmetic_key));
    const types = [...new Set([...capsule.map((cosmetic) => cosmetic.cosmetic_type), ...catalog.map((reward) => reward.type)])].sort((a, b) => typeIndex(a) - typeIndex(b));
    const groups = types.map((type) => ({
      type,
      owned: capsule.filter((cosmetic) => cosmetic.cosmetic_type === type).sort((a, b) => cosmeticRank(b.rarity) - cosmeticRank(a.rarity) || displayName(a).localeCompare(displayName(b))),
      missing: catalog.filter((reward) => reward.type === type && !ownedKeys.has(reward.key)).sort((a, b) => cosmeticRank(a.rarity) - cosmeticRank(b.rarity)),
    }));
    const setSorted = [...sets].sort((a, b) => (setRewardOf(b)?.tier === "spotlight" ? 1 : 0) - (setRewardOf(a)?.tier === "spotlight" ? 1 : 0) || displayName(a).localeCompare(displayName(b)));
    return { capsuleGroups: groups, setRewards: setSorted };
  }, [inventory, catalog]);

  const equip = useCallback(async (cosmetic: GameCosmetic) => {
    setBusy(cosmetic.id);
    setErrors((current) => ({ ...current, [cosmetic.id]: "" }));
    try {
      setInventory(await equipCosmetic(slotFor(cosmetic), cosmetic.id));
    } catch (error) {
      setErrors((current) => ({ ...current, [cosmetic.id]: gameErrorText(error) }));
    } finally {
      setBusy(null);
    }
  }, []);

  const unequip = useCallback(async (cosmetic: GameCosmetic, slot: string) => {
    setBusy(cosmetic.id);
    setErrors((current) => ({ ...current, [cosmetic.id]: "" }));
    try {
      setInventory(await unequipCosmetic(slot));
    } catch (error) {
      setErrors((current) => ({ ...current, [cosmetic.id]: gameErrorText(error) }));
    } finally {
      setBusy(null);
    }
  }, []);

  function tile(cosmetic: GameCosmetic) {
    const slot = equippedIds.get(cosmetic.id);
    const set = setRewardOf(cosmetic);
    const pulls = pullsByKey.get(cosmetic.cosmetic_key) ?? 0;
    return (
      <CosmeticTile
        key={cosmetic.id}
        name={displayName(cosmetic)}
        type={cosmetic.cosmetic_type}
        rarity={cosmetic.rarity}
        imageUrl={imageOf(cosmetic)}
        setReward={set}
        equipped={Boolean(slot)}
        meta={set ? (set.tier === "spotlight" ? "Spotlight frame" : "Roster badge") : pulls > 1 ? `×${pulls} pulled` : pulls === 1 ? "Pulled once" : null}
        error={errors[cosmetic.id]}
        action={
          slot ? (
            <button type="button" data-on onClick={() => void unequip(cosmetic, slot)} disabled={busy !== null} aria-label={`Take off ${displayName(cosmetic)}`}>
              {busy === cosmetic.id ? "…" : "Take off"}
            </button>
          ) : (
            <button type="button" onClick={() => void equip(cosmetic)} disabled={busy !== null} aria-label={`Equip ${displayName(cosmetic)}`}>
              {busy === cosmetic.id ? "…" : `Equip ${SLOT_LABEL[slotFor(cosmetic)]?.toLowerCase() ?? ""}`.trim()}
            </button>
          )
        }
      />
    );
  }

  const hat = equippedBySlot.get("hat");
  const ownedCount = inventory?.cosmetics.length ?? 0;
  const capsuleOwned = capsuleGroups.reduce((sum, group) => sum + group.owned.length, 0);
  const capsuleTotal = capsuleOwned + capsuleGroups.reduce((sum, group) => sum + group.missing.length, 0);

  return (
    <GamesFrame
      kicker="Locker"
      title="My locker"
      blurb={
        collection ? (
          <>
            <b>{collection.cards.length}</b> cards, <b>{ownedCount}</b> cosmetics.{" "}
            <Link href={`/games/item-locker/${encodeURIComponent(username)}`} className={styles.inline}>
              See it as others do →
            </Link>
          </>
        ) : null
      }
      aside={aside}
    >
      <TrophyShelf cards={showcase} editable />
      <div className={styles.shelfFoot}>
        <span>Slot 1 takes the middle.</span>
        <Link href="/games/collection#showcase">Edit showcase →</Link>
      </div>

      {collection ? (
        <CollectionStats unique={collection.cards.length} total={collection.total_cards} counts={counts} perRarity={collection.talents.length} shards={collection.shards} />
      ) : null}

      <section className={styles.section} aria-labelledby="wearing-title">
        <h2 id="wearing-title" className={styles.heading}>
          Wearing
        </h2>
        <div className={styles.wearing}>
          <span className={styles.me}>
            <PlayerAvatar
              username={username}
              pictureUrl={pictureUrl}
              color={color}
              size={56}
              hat={hat ? { image_url: imageOf(hat), display_name: displayName(hat), cosmetic_key: hat.cosmetic_key, rarity: hat.rarity } : null}
            />
            <b>{username}</b>
          </span>
          <dl className={styles.slots}>
            {Object.entries(SLOT_LABEL).map(([slot, label]) => {
              const cosmetic = equippedBySlot.get(slot);
              return (
                <div key={slot} data-rarity={cosmetic?.rarity}>
                  <dt>{label}</dt>
                  <dd>{cosmetic ? displayName(cosmetic) : <span className={styles.none}>none</span>}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}

      {setRewards.length ? (
        <section className={styles.section} aria-labelledby="sets-title">
          <h2 id="sets-title" className={styles.heading}>
            Set rewards <small>{setRewards.length}</small>
          </h2>
          <ul className={styles.grid}>{setRewards.map(tile)}</ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="capsule-title">
        <h2 id="capsule-title" className={styles.heading}>
          Capsule prizes{" "}
          <small>
            {capsuleOwned}
            {capsuleTotal ? `/${capsuleTotal}` : ""}
          </small>
          <Link href="/games/capsule" className={styles.headLink}>
            Pull the capsule →
          </Link>
        </h2>
        {inventory === null && !loadError ? <div className={styles.loading} aria-busy="true" /> : null}
        {inventory && capsuleGroups.length === 0 ? (
          <p className={styles.empty}>
            Nothing from the capsule yet. <Link href="/games/capsule">Spin it</Link> for hats, frames and flair.
          </p>
        ) : null}
        {capsuleGroups.map((group) => (
          <div key={group.type} className={styles.group}>
            <h3 className={styles.groupHead}>
              {typeLabel(group.type)}{" "}
              <small>
                {group.owned.length}/{group.owned.length + group.missing.length}
              </small>
            </h3>
            <ul className={styles.grid}>
              {group.owned.map(tile)}
              {group.missing.map((reward) => (
                <CosmeticTile key={reward.key} name={reward.display_name} type={reward.type} rarity={reward.rarity} locked meta="Not pulled" />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </GamesFrame>
  );
}
