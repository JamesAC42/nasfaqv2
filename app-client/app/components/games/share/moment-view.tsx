"use client";

import Link from "next/link";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { ShareMoment } from "@/app/components/games/share/share-moment";
import { momentCardPath, momentSummary, type Moment, type MomentKind } from "@/app/lib/games/moments";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/share/moment-view.module.scss";

const PLAY: Record<MomentKind, { href: string; label: string; kicker: string }> = {
  blackjack: { href: "/games/blackjack", label: "Take a seat at blackjack", kicker: "Blackjack" },
  cards: { href: "/games/cards", label: "Pull some cards", kicker: "Card gacha" },
};

/** The page a shared link opens: the share card, what happened, and the way in. */
export function MomentView({ kind, id, talent, moment }: { kind: MomentKind; id: string; talent: string | null; moment: Moment | null }) {
  const { user } = useAuth();
  const play = PLAY[kind] ?? PLAY.blackjack;
  if (!moment) {
    return (
      <GamesFrame kicker="Arcade" title="Moment not found">
        <p className={styles.missing}>
          That hand or pull isn&apos;t here. It may have been refunded, or the link is cut short. <Link href="/games">Back to the arcade</Link>
        </p>
      </GamesFrame>
    );
  }
  const summary = momentSummary(moment);
  const mine = Boolean(user && user.username === moment.player.username);
  return (
    <GamesFrame kicker={play.kicker} title={moment.kind === "blackjack" ? `${moment.player.username} at the ${moment.table.name.toLowerCase()}` : `${moment.player.username}'s pull`}>
      <div className={styles.layout}>
        <figure className={styles.card}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={momentCardPath(kind, id, talent)} width={1200} height={630} alt={summary} />
          <figcaption>
            {summary}
            {moment.at ? <time dateTime={moment.at}> {new Date(moment.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time> : null}
          </figcaption>
        </figure>
        <div className={styles.actions}>
          <Link href={play.href} className={styles.play}>
            {play.label} →
          </Link>
          <ShareMoment kind={kind} id={id} talent={talent} text={`${summary} #NASFAQ`} label={mine ? "Share" : "Share this"} className={styles.share} />
          <Link href={`/profile/${encodeURIComponent(moment.player.username)}`} className={styles.secondary}>
            {moment.player.username}&apos;s profile
          </Link>
        </div>
        {!user ? (
          <p className={styles.pitch}>
            NASFAQ is a fan-made hololive stock market. Every account starts with play money for trading talent stocks and for the arcade.{" "}
            <Link href="/register">Make an account</Link> or <Link href="/how-to-play">see how it works</Link>.
          </p>
        ) : null}
      </div>
    </GamesFrame>
  );
}
