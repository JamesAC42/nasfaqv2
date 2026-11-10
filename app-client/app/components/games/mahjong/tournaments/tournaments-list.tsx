"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { TournamentForm } from "@/app/components/games/mahjong/tournaments/tournament-form";
import { money, startsText } from "@/app/components/games/mahjong/tournaments/tournament-parts";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchTournaments } from "@/app/lib/games/mahjong/api";
import type { TournamentSummary } from "@/app/lib/games/mahjong/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/tournaments/tournaments.module.scss";

function Row({ tournament }: { tournament: TournamentSummary }) {
  const running = tournament.status === "running";
  const champion = tournament.result?.champion;
  return (
    <li className={styles.row}>
      <Link href={`/games/mahjong/tournaments/${tournament.id}`} className={styles.rowLink}>
        <span className={styles.rowName}>{tournament.name}</span>
        <span className={styles.rowMeta}>
          {running ? (
            <span className={styles.runningTag}>
              <i aria-hidden="true" /> Running
            </span>
          ) : tournament.status === "completed" ? (
            <>{champion ? <>Won by <b>{champion.name}</b></> : "Finished"}</>
          ) : (
            <>Starts {startsText(tournament.starts_at)}</>
          )}
          {" · "}
          <b>{tournament.entrants ?? 0}</b>/{tournament.seats} {tournament.status === "completed" ? "played" : "in"}
          {" · "}
          {tournament.entry_fee > 0 && tournament.paid ? `${money(tournament.entry_fee)} entry` : "Free"}
          {tournament.repeat_weekly ? " · weekly" : null}
        </span>
      </Link>
    </li>
  );
}

export function TournamentsList() {
  const { user } = useAuth();
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchTournaments()
        .then((response) => !cancelled && (setList(response.tournaments), setError(null)))
        .catch((failure) => !cancelled && setError(gameErrorText(failure)));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const open = (list ?? []).filter((entry) => entry.status === "signup");
  const running = (list ?? []).filter((entry) => entry.status === "running");
  const finished = (list ?? []).filter((entry) => entry.status === "completed");

  return (
    <GamesFrame
      kicker="Mahjong · tournaments"
      title="Tournaments"
      blurb="Knockouts of four to a table. The top two go through, down to one final table."
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong">Lobby</Link>
          <Link href="/games/mahjong/ladder">Ladder</Link>
        </nav>
      }
    >
      <div className={styles.page}>
        {user?.is_admin ? (
          <section className={styles.section}>
            <TournamentForm />
          </section>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {!list && !error ? <p className={styles.note}>Loading…</p> : null}
        {list ? (
          <>
            <section className={styles.section} aria-label="Open for sign-up">
              <h2 className={styles.head}>
                Open for sign-up <small>{open.length}</small>
              </h2>
              {open.length ? (
                <ul className={styles.rows}>
                  {open.map((entry) => (
                    <Row key={entry.id} tournament={entry} />
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Nothing open right now. Staff add them here.</p>
              )}
            </section>
            {running.length ? (
              <section className={styles.section} aria-label="Running">
                <h2 className={styles.head}>
                  Running <small>{running.length}</small>
                </h2>
                <ul className={styles.rows}>
                  {running.map((entry) => (
                    <Row key={entry.id} tournament={entry} />
                  ))}
                </ul>
              </section>
            ) : null}
            <section className={styles.section} aria-label="Finished">
              <h2 className={styles.head}>Finished</h2>
              {finished.length ? (
                <ul className={styles.rows}>
                  {finished.map((entry) => (
                    <Row key={entry.id} tournament={entry} />
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>None finished yet.</p>
              )}
            </section>
            <p className={styles.note} style={{ marginTop: "1rem" }}>
              A tournament that needs a bot to fill a seat turns free: every entry fee is refunded and no prize is paid.
            </p>
          </>
        ) : null}
      </div>
    </GamesFrame>
  );
}
