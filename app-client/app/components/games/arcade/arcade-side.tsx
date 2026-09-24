"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { fmtAgo, fmtCash, fmtLeft } from "@/app/components/games/arcade/arcade-format";
import { fmtInteger } from "@/app/lib/format";
import { RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { CollectionResponse, FeedPull, TickerTapBoard } from "@/app/lib/games/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { talentAccent } from "@/app/lib/talent-color";
import styles from "@/app/components/games/arcade/arcade.module.scss";

// ── Your stuff ─────────────────────────────────────────────────────────────
export function YourStuff({ collection, loading }: { collection: CollectionResponse | null; loading: boolean }) {
  if (!collection) {
    return (
      <section className={styles.panel} aria-labelledby="arcade-yours" aria-busy={loading || undefined}>
        <h2 id="arcade-yours" className={styles.panelHead}>
          Your stuff
        </h2>
        <p className={styles.quiet}>{loading ? "Opening your binder…" : "Couldn't load your cards. Try again in a bit."}</p>
      </section>
    );
  }

  const owned = collection.cards.length;
  const total = collection.total_cards || 1;
  const pct = Math.floor((owned / total) * 100);
  const byKey = new Map(collection.cards.map((card) => [card.key, card]));
  const showcase = [...collection.showcase]
    .sort((a, b) => a.slot - b.slot)
    .map((slot) => byKey.get(slot.card_key))
    .filter((card): card is NonNullable<typeof card> => Boolean(card));
  const rosters = collection.sets.filter((set) => set.roster.complete).length;
  const claimable = collection.sets.filter((set) => (set.roster.complete && !set.roster.claimed) || (set.spotlight.complete && !set.spotlight.claimed)).length;

  return (
    <section className={styles.panel} aria-labelledby="arcade-yours">
      <h2 id="arcade-yours" className={styles.panelHead}>
        Your stuff
        <Link href="/games/collection" className={styles.panelLink}>
          Binder <FiArrowRight aria-hidden="true" />
        </Link>
      </h2>

      {owned === 0 && !collection.starter_claimed ? (
        <Link href="/games/collection" className={styles.starter}>
          <b>5 free cards are waiting.</b>
          <span>Claim the starter pack and you&apos;re duel-ready.</span>
        </Link>
      ) : null}

      <div className={styles.completion}>
        <div className={styles.completionTop}>
          <span className={styles.bigNum}>
            {fmtInteger(owned)}
            <small>/{fmtInteger(collection.total_cards)}</small>
          </span>
          <span className={styles.pct}>{pct}%</span>
        </div>
        <span className={styles.bar} role="progressbar" aria-label="Collection completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${Math.min(100, (owned / total) * 100)}%` }} />
        </span>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Shards</dt>
          <dd className={styles.shardNum}>
            <i aria-hidden="true" />
            {fmtInteger(collection.shards)}
          </dd>
        </div>
        <div>
          <dt>Unit rosters</dt>
          <dd>
            {rosters}/{collection.sets.length}
          </dd>
        </div>
        <div>
          <dt>Rewards</dt>
          <dd>{claimable ? <Link href="/games/collection">{claimable} to claim</Link> : "—"}</dd>
        </div>
      </dl>

      <div className={styles.showcase}>
        <span className={styles.subHead}>Showcase</span>
        {showcase.length ? (
          <div className={styles.showcaseRow}>
            {showcase.map((card) => (
              <TalentCard key={card.key} card={card} width={60} compact tilt={false} />
            ))}
          </div>
        ) : (
          <p className={styles.quiet}>
            Nothing pinned. <Link href="/games/collection">Pick up to 5 cards</Link> to flex on your profile.
          </p>
        )}
      </div>

      <div className={styles.panelLinks}>
        <Link href="/games/collection">Collection</Link>
        <Link href="/games/item-locker">Item locker</Link>
      </div>
    </section>
  );
}

export function SignedOutPanel() {
  return (
    <section className={styles.panel} aria-labelledby="arcade-join">
      <h2 id="arcade-join" className={styles.panelHead}>
        Your stuff
      </h2>
      <p className={styles.joinCopy}>
        Every account starts with cash. Spend it here: pull cards, stake a duel, sit at the high table.
      </p>
      <div className={styles.joinCtas}>
        <Link href="/login?next=/games" className={styles.primary}>
          Sign in
        </Link>
        <Link href="/register" className={styles.secondary}>
          Make an account
        </Link>
      </div>
    </section>
  );
}

// ── Pulled just now ────────────────────────────────────────────────────────
export function PullFeed({ pulls }: { pulls: FeedPull[] | null }) {
  return (
    <section className={styles.panel} aria-labelledby="arcade-feed">
      <h2 id="arcade-feed" className={styles.panelHead}>
        Pulled just now
        <Link href="/games/cards" className={styles.panelLink}>
          Pull <FiArrowRight aria-hidden="true" />
        </Link>
      </h2>
      {pulls === null ? (
        <ul className={styles.feed} aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index} className={styles.feedSkel} />
          ))}
        </ul>
      ) : pulls.length ? (
        <ul className={styles.feed}>
          {pulls.slice(0, 8).map((pull) => (
            <li key={pull.id} className={styles.feedRow} style={{ "--tal": talentAccent(pull.color), "--rc": RARITY_COLOR[pull.rarity] } as CSSProperties}>
              <span className={styles.feedMark}>
                <Oshimark icon={pull.icon} symbol={pull.symbol} size={22} />
              </span>
              <span className={styles.feedText}>
                <span className={styles.feedCard}>
                  <b className={styles.rarity} data-rarity={pull.rarity} title={RARITY_NAME[pull.rarity]}>
                    {pull.rarity}
                  </b>
                  <span className={styles.feedName}>{pull.name}</span>
                  {pull.was_featured ? <em className={styles.featured}>Rate up</em> : null}
                </span>
                <span className={styles.feedBy}>
                  {pull.username} · <span suppressHydrationWarning>{fmtAgo(pull.created_at)}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>No SSRs yet today. Somebody has to be first.</p>
      )}
    </section>
  );
}

// ── Ticker Tap board ───────────────────────────────────────────────────────
export function TapBoard({ board, me }: { board: TickerTapBoard | null; me: string | null }) {
  const endsAt = board ? new Date(board.week.ends_at).getTime() : null;
  const left = useRemaining(endsAt, 30_000);
  const top = board?.leaderboard.slice(0, 3) ?? [];
  const mine = board?.me && board.me.rank > 3 ? board.me : null;
  const champ = board?.last_week.find((row) => row.rank === 1) ?? null;

  return (
    <section className={styles.panel} aria-labelledby="arcade-tap">
      <h2 id="arcade-tap" className={styles.panelHead}>
        Ticker Tap · this week
        <Link href="/games/ticker-tap" className={styles.panelLink}>
          Play <FiArrowRight aria-hidden="true" />
        </Link>
      </h2>
      <div className={styles.pool}>
        <span className={styles.poolNum}>{board ? fmtCash(board.week.pool) : "—"}</span>
        <span className={styles.poolMeta}>
          <span>pool · top 10 split it</span>
          <span suppressHydrationWarning>
            {board ? `${fmtInteger(board.week.runs)} ${board.week.runs === 1 ? "run" : "runs"} · pays out in ${fmtLeft(left)}` : "…"}
          </span>
        </span>
      </div>
      {board && top.length ? (
        <ol className={styles.podium}>
          {top.map((row) => (
            <li key={row.session_id} data-me={me !== null && String(row.user_id) === me ? true : undefined}>
              <span className={styles.rank}>{row.rank}</span>
              <PlayerAvatar username={row.username} color={row.profile_color} size={20} />
              <span className={styles.podiumName}>{row.username}</span>
              <span className={styles.podiumScore}>{fmtInteger(row.score)}</span>
              <span className={styles.podiumPay}>{row.projected_payout ? fmtCash(row.projected_payout) : ""}</span>
            </li>
          ))}
          {mine ? (
            <li data-me="true">
              <span className={styles.rank}>{mine.rank}</span>
              <PlayerAvatar username={mine.username} color={mine.profile_color} size={20} />
              <span className={styles.podiumName}>you</span>
              <span className={styles.podiumScore}>{fmtInteger(mine.score)}</span>
              <span className={styles.podiumPay}>{mine.projected_payout ? fmtCash(mine.projected_payout) : ""}</span>
            </li>
          ) : null}
        </ol>
      ) : board ? (
        <p className={styles.quiet}>
          No scores on the board yet. Post any score and you&apos;re #1.
          {champ ? (
            <>
              {" "}
              Last week {champ.username} took {fmtCash(champ.payout)}.
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
