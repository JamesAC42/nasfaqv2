"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CollectionStats } from "@/app/components/games/collection/collection-stats";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { apiFetch } from "@/app/lib/api";
import { fetchPublicCollection } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { PublicCollection } from "@/app/lib/games/types";
import { normalizeGameInventoryResponse, normalizeGameItemLockerResponse } from "@/app/lib/normalizers";
import type { GameInventoryResponse } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { CosmeticTile } from "@/app/components/games/locker/cosmetic-tile";
import { cosmeticRank, displayName, foldPulls, imageOf, setRewardOf, typeIndex, typeLabel, type LockerPrize } from "@/app/components/games/locker/cosmetics";
import { TrophyShelf } from "@/app/components/games/locker/trophy-shelf";
import styles from "@/app/components/games/locker/locker.module.scss";

/** Anyone's locker, read-only: their showcase, binder totals and capsule haul. */
export function PublicLockerPage({ username }: { username: string }) {
  const { user } = useAuth();
  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [prizes, setPrizes] = useState<LockerPrize[] | null>(null);
  const [inventory, setInventory] = useState<GameInventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicCollection(username)
      .then((result) => alive && setCollection(result))
      .catch((err) => alive && setError(String((err as Error).message)));
    apiFetch<Record<string, unknown>>(`/api/games/${encodeURIComponent(username)}/item-locker`, { cache: "no-store" })
      .then((raw) => {
        if (!alive) return;
        setPrizes(foldPulls(normalizeGameItemLockerResponse(raw).items));
        setInventory(normalizeGameInventoryResponse(raw));
      })
      .catch(() => alive && setPrizes([]));
    return () => {
      alive = false;
    };
  }, [username]);

  const name = collection?.username ?? username;
  const isSelf = Boolean(user && user.username.toLowerCase() === name.toLowerCase());

  const groups = useMemo(() => {
    const list = prizes ?? [];
    const types = [...new Set(list.map((prize) => prize.type))].sort((a, b) => typeIndex(a) - typeIndex(b));
    return types.map((type) => ({
      type,
      prizes: list.filter((prize) => prize.type === type).sort((a, b) => cosmeticRank(b.rarity) - cosmeticRank(a.rarity) || a.name.localeCompare(b.name)),
    }));
  }, [prizes]);

  const wearing = useMemo(() => new Set((inventory?.equipped ?? []).map((entry) => entry.cosmetic.cosmetic_key)), [inventory]);
  const setRewards = useMemo(() => (inventory?.cosmetics ?? []).filter((cosmetic) => setRewardOf(cosmetic)), [inventory]);

  const showcase = useMemo(() => (collection ? [...collection.showcase].sort((a, b) => a.slot - b.slot) : []), [collection]);

  const aside = (
    <div className={styles.links}>
      <Link href={`/profile/${encodeURIComponent(name)}`} className={styles.link}>
        Profile
      </Link>
      {isSelf ? (
        <Link href="/games/item-locker" className={styles.linkPrimary}>
          Edit my locker
        </Link>
      ) : (
        <Link href="/games/collection" className={styles.linkPrimary}>
          My collection
        </Link>
      )}
    </div>
  );

  if (error) {
    const missing = error === "profile_not_found" || error === "404" || error === "not_found";
    return (
      <GamesFrame kicker="Locker" title={`${username}'s locker`} aside={aside}>
        <p className={styles.notFound}>
          {missing ? `No player called ${username}.` : gameErrorText(new Error(error))} <Link href="/games">Back to the arcade</Link>
        </p>
      </GamesFrame>
    );
  }

  const legendary = (prizes ?? []).filter((prize) => prize.rarity === "legendary").length;

  return (
    <GamesFrame
      kicker="Locker"
      title={`${name}'s locker`}
      blurb={
        collection ? (
          <>
            <b>{collection.unique_cards}</b> cards in the binder
            {prizes ? (
              <>
                , <b>{prizes.length}</b> capsule prizes{legendary ? <> (<b>{legendary}</b> legendary)</> : null}
              </>
            ) : null}
            .
          </>
        ) : null
      }
      aside={aside}
    >
      {collection ? <TrophyShelf cards={showcase} owner={name} /> : <div className={styles.loading} aria-busy="true" />}

      {collection ? (
        <CollectionStats unique={collection.unique_cards} total={collection.total_cards} counts={collection.by_rarity} perRarity={Math.round(collection.total_cards / 5) || null} />
      ) : null}

      {setRewards.length ? (
        <section className={styles.section} aria-labelledby="sets-title">
          <h2 id="sets-title" className={styles.heading}>
            Set rewards <small>{setRewards.length}</small>
          </h2>
          <ul className={styles.grid}>
            {setRewards.map((cosmetic) => {
              const set = setRewardOf(cosmetic);
              return (
                <CosmeticTile
                  key={cosmetic.id}
                  name={displayName(cosmetic)}
                  type={cosmetic.cosmetic_type}
                  rarity={cosmetic.rarity}
                  imageUrl={imageOf(cosmetic)}
                  setReward={set}
                  equipped={wearing.has(cosmetic.cosmetic_key)}
                  meta={set?.tier === "spotlight" ? "Spotlight frame" : "Roster badge"}
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="capsule-title">
        <h2 id="capsule-title" className={styles.heading}>
          Capsule prizes <small>{prizes?.length ?? "…"}</small>
        </h2>
        {prizes === null ? <div className={styles.loading} aria-busy="true" /> : null}
        {prizes && prizes.length === 0 ? <p className={styles.empty}>Nothing from the capsule yet.</p> : null}
        {groups.map((group) => (
          <div key={group.type} className={styles.group}>
            <h3 className={styles.groupHead}>
              {typeLabel(group.type)} <small>{group.prizes.length}</small>
            </h3>
            <ul className={styles.grid}>
              {group.prizes.map((prize) => (
                <CosmeticTile
                  key={prize.key}
                  name={prize.name}
                  type={prize.type}
                  rarity={prize.rarity}
                  imageUrl={prize.imageUrl}
                  equipped={wearing.has(prize.key)}
                  meta={prize.pulls > 1 ? `×${prize.pulls} pulled` : "Pulled once"}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </GamesFrame>
  );
}
