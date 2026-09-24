"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { fetchPullFeed } from "@/app/lib/games/api";
import { RARITY_COLOR } from "@/app/lib/games/rarity";
import type { FeedPull } from "@/app/lib/games/types";
import { timeAgo } from "@/app/lib/time";
import styles from "@/app/components/games/gacha/card-gacha.module.scss";

const POLL_MS = 30_000;

/** SSR and UR pulls across the site, newest first. `bump` refetches now (after your own pull). */
export function PullFeed({ bump = 0 }: { bump?: number }) {
  const [pulls, setPulls] = useState<FeedPull[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetchPullFeed(8)
      .then((response) => {
        setPulls(response.pulls);
        setFailed(false);
        setNow(Date.now());
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!bump) return;
    const id = window.setTimeout(load, 400);
    return () => window.clearTimeout(id);
  }, [bump, load]);

  return (
    <section className={styles.feed} aria-labelledby="pull-feed-title">
      <header className={styles.railHead}>
        <h2 id="pull-feed-title">
          <i aria-hidden="true" />
          Pulled just now
        </h2>
        <span>SSR+ only</span>
      </header>
      {pulls === null ? (
        <p className={styles.feedEmpty}>{failed ? "Feed's down. Trying again soon." : "Loading…"}</p>
      ) : pulls.length === 0 ? (
        <p className={styles.feedEmpty}>Nobody&apos;s hit an SSR yet. Be first.</p>
      ) : (
        <ol className={styles.feedList}>
          {pulls.map((pull) => (
            <li key={pull.id} style={{ "--rc": RARITY_COLOR[pull.rarity] } as CSSProperties} data-rarity={pull.rarity}>
              <TalentCard card={{ symbol: pull.symbol, name: pull.name, rarity: pull.rarity, icon: pull.icon, color: pull.color, unit: pull.unit }} width={30} compact tilt={false} />
              <span className={styles.feedMain}>
                <span className={styles.feedCard}>
                  <b>{pull.rarity}</b>
                  <Oshimark icon={pull.icon} symbol={pull.symbol} size={14} />
                  <span>{pull.name}</span>
                  {pull.was_featured ? <em>RATE UP</em> : null}
                </span>
                <span className={styles.feedWho}>
                  <Link href={`/profile/${encodeURIComponent(pull.username)}`}>{pull.username}</Link>
                  <time dateTime={pull.created_at}>{timeAgo(pull.created_at, now)}</time>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
