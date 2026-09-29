"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { fetchPublicCollection } from "@/app/lib/games/api";
import { RARITY_COLOR } from "@/app/lib/games/rarity";
import type { PublicCollection, Rarity } from "@/app/lib/games/types";
import styles from "@/app/components/games/locker/showcase-strip.module.scss";

const SLOTS = 5;
const cache = new Map<string, PublicCollection>();

/** A player's five showcase cards, small, with their binder count. For the profile and anywhere tight. */
export function ShowcaseStrip({ username, isSelf = false, className }: { username: string; isSelf?: boolean; className?: string }) {
  const key = username.toLowerCase();
  const [data, setData] = useState<PublicCollection | null>(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPublicCollection(username)
      .then((result) => {
        cache.set(key, result);
        if (alive) setData(result);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [key, username]);

  if (failed && !data) return null;

  const cards = data ? [...data.showcase].sort((a, b) => a.slot - b.slot).slice(0, SLOTS) : [];
  const top = (["UR", "SSR"] as Rarity[]).filter((rarity) => (data?.by_rarity[rarity] ?? 0) > 0);

  return (
    <div className={[styles.strip, className].filter(Boolean).join(" ")}>
      <div className={styles.row} aria-busy={!data} aria-label={data ? `${data.username}'s showcase` : "Loading showcase"}>
        {data
          ? Array.from({ length: SLOTS }, (_, index) => {
              const card = cards[index];
              return card ? (
                <span key={card.key} className={styles.cell}>
                  <TalentCard card={card} width={96} compact tilt={false} className={styles.card} />
                </span>
              ) : (
                <span key={`empty-${index}`} className={styles.cell}>
                  <span className={styles.empty} />
                </span>
              );
            })
          : Array.from({ length: SLOTS }, (_, index) => (
              <span key={index} className={styles.cell}>
                <span className={styles.ghost} />
              </span>
            ))}
      </div>
      {data ? (
        <p className={styles.line}>
          {cards.length === 0 ? (
            isSelf ? (
              <Link href="/games/collection#showcase">Pin your best five →</Link>
            ) : (
              <span>No cards pinned.</span>
            )
          ) : null}
          <span className={styles.count}>
            <b>{data.unique_cards}</b>/{data.total_cards} cards
          </span>
          {top.map((rarity) => (
            <span key={rarity} className={styles.rarity} style={{ "--rc": RARITY_COLOR[rarity] } as CSSProperties} data-rarity={rarity}>
              {rarity} <b>{data.by_rarity[rarity]}</b>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
