"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMahjongRules } from "@/app/components/games/mahjong/records/record-parts";
import { fetchMahjongPlayer } from "@/app/lib/games/mahjong/api";
import type { PlayerRecord } from "@/app/lib/games/mahjong/types";
import { useFeature } from "@/app/lib/features";
import profile from "@/app/components/profile/profile.module.scss";

/** A small Mahjong block for the profile page: rank, rating and games, linking to the full record. Nothing if the flag is off or they haven't played. */
export function MahjongProfileBlock({ username }: { username: string }) {
  const enabled = useFeature("mahjong");
  const { rankName } = useMahjongRules();
  const [record, setRecord] = useState<{ username: string; value: PlayerRecord | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchMahjongPlayer(username)
      .then((value) => !cancelled && setRecord({ username, value }))
      .catch(() => !cancelled && setRecord({ username, value: null }));
    return () => {
      cancelled = true;
    };
  }, [enabled, username]);

  const value = record?.username === username ? record.value : null;
  if (!enabled || !value || value.totals.games === 0) return null;
  return (
    <section className={profile.sec}>
      <div className={profile.secHead}>
        <h2>Mahjong</h2>
        <span className={profile.aside}>
          <Link href={`/games/mahjong/player/${encodeURIComponent(username)}`}>record →</Link>
        </span>
      </div>
      <p className={profile.note}>
        <b>{rankName(value.rank)}</b> · rating <b>{Math.round(value.rating)}</b> · <b>{value.totals.games}</b> {value.totals.games === 1 ? "game" : "games"}
      </p>
    </section>
  );
}
