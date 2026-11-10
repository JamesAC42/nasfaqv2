"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { Bracket } from "@/app/components/games/mahjong/tournaments/bracket";
import { countdown, formatWords, money, roundShape, startsText } from "@/app/components/games/mahjong/tournaments/tournament-parts";
import { OshiTag, ordinal } from "@/app/components/games/mahjong/records/record-parts";
import { MahjongShareButton } from "@/app/components/games/mahjong/share/share-button";
import { tournamentCardPath, tournamentPath } from "@/app/components/games/mahjong/share/share-links";
import { apiErrorCode } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { cancelTournament, fetchTournament, mahjongChannels, pickTournamentWinner, registerTournament, withdrawTournament } from "@/app/lib/games/mahjong/api";
import type { TournamentPush, TournamentResponse } from "@/app/lib/games/mahjong/types";
import { useGamesChannel, useGamesConnected, useSeedChannel } from "@/app/lib/games/use-games-socket";
import { talentAccent } from "@/app/lib/talent-color";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/tournaments/tournaments.module.scss";

const STATUS_WORDS: Record<string, string> = { registered: "In", playing: "Playing", out: "Out", finished: "Finished", withdrawn: "Withdrew" };

export function TournamentView({ id }: { id: number }) {
  const { user } = useAuth();
  const now = useNow();
  const connected = useGamesConnected();
  const [fetched, setFetched] = useState<TournamentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // `me` (am I in, what did I pick) comes from HTTP only: the live channel is the same for everyone.
  const [me, setMe] = useState<TournamentResponse["me"]>(undefined);

  const accept = useCallback((payload: TournamentResponse) => {
    setFetched(payload);
    setMe(payload.me);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTournament(id)
      .then((payload) => !cancelled && (accept(payload), setError(null)))
      .catch((failure) => !cancelled && setError(apiErrorCode(failure) === "tournament_not_found" ? "That tournament is gone." : gameErrorText(failure)));
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, accept]);

  const channel = mahjongChannels.tournament(id);
  const seedPush = useMemo(() => (fetched ? ({ type: "mahjong-tournament", ...fetched } as TournamentPush) : null), [fetched]);
  useSeedChannel(channel, seedPush);
  const live = useGamesChannel<TournamentPush>(channel);
  const data: TournamentResponse | null = live ? { ...live, me } : fetched ? { ...fetched, me } : null;

  async function act(key: string, run: () => Promise<TournamentResponse | unknown>) {
    setBusy(key);
    setProblem(null);
    try {
      const result = await run();
      if (result && typeof result === "object" && "tournament" in result && "entrants" in result) accept(result as TournamentResponse);
      else setFetched(await fetchTournament(id).then((payload) => (setMe(payload.me), payload)));
    } catch (failure) {
      setProblem(gameErrorText(failure));
    } finally {
      setBusy(null);
    }
  }

  const tournament = data?.tournament;
  const signedIn = Boolean(user);
  const verified = Boolean(user?.email_verified);
  const startsMs = tournament ? Date.parse(tournament.starts_at) : 0;
  const champion = tournament?.status === "completed" ? (tournament.result?.champion ?? tournament.result?.places?.find((place) => place.place === 1) ?? null) : null;
  const championEntrant = champion ? data?.entrants.find((entrant) => entrant.user_id === champion.user_id) : null;
  const entered = Boolean(me?.entered);
  const open = tournament?.status === "signup";
  const picks = data?.entrants.reduce((sum, entrant) => sum + entrant.picks, 0) ?? 0;
  const shape = tournament ? roundShape(tournament.seats) : [];

  const free = tournament ? tournament.entry_fee <= 0 || !tournament.paid : true;

  return (
    <GamesFrame
      kicker="Mahjong · tournament"
      title={tournament?.name ?? "Tournament"}
      live={connected && tournament?.status === "running"}
      blurb={tournament ? <>{tournament.status === "completed" ? "Finished" : tournament.status === "cancelled" ? "Cancelled" : tournament.status === "running" ? "Running now" : `Starts ${startsText(tournament.starts_at)}`}{tournament.repeat_weekly ? " · repeats weekly" : ""}</> : undefined}
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong/tournaments">All tournaments</Link>
          <Link href="/games/mahjong/ladder">Ladder</Link>
        </nav>
      }
    >
      <div className={styles.page}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!data && !error ? <p className={styles.note}>Loading…</p> : null}
        {tournament && data ? (
          <>
            {champion ? (
              <section className={styles.champion} style={{ "--tal": talentAccent(championEntrant?.profile_color) } as CSSProperties} aria-label="Champion">
                <small>Champion</small>
                <strong>{champion.name}</strong>
                {champion.payout > 0 ? <span>Won {money(champion.payout)}</span> : null}
                <MahjongShareButton
                  className={styles.secondary}
                  title="Share this tournament"
                  text={`${champion.name} won ${tournament.name} on NASFAQ mahjong`}
                  cardPath={tournamentCardPath(tournament.id)}
                  linkFor={(code) => tournamentPath(tournament.id, code)}
                />
              </section>
            ) : null}

            {tournament.status === "cancelled" ? <p className={styles.note}>This tournament was cancelled{tournament.result?.cancelled ? `: ${tournament.result.cancelled}` : ""}. Any entry fees were refunded.</p> : null}

            <section className={styles.section} aria-label="Details">
              <dl className={styles.facts}>
                <div>
                  <dt>Starts</dt>
                  <dd>
                    {startsText(tournament.starts_at)}
                    {open && now !== null && startsMs > now ? <small>in {countdown(startsMs, now)}</small> : null}
                    {open && now !== null && startsMs <= now ? <small>about to start</small> : null}
                  </dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>{free ? "Free" : money(tournament.entry_fee)}</dd>
                </div>
                <div>
                  <dt>Players</dt>
                  <dd>
                    {data.entrants.filter((entrant) => entrant.status !== "withdrawn").length}/{tournament.seats}
                  </dd>
                </div>
                <div>
                  <dt>Rounds</dt>
                  <dd>{shape.length === 1 ? "1 (the final)" : shape.length}</dd>
                </div>
              </dl>
              <p className={styles.lede}>{formatWords(tournament)}</p>
              {!free && tournament.prizes ? (
                <p className={styles.lede}>
                  Prizes, from {money(tournament.prizes.pot)} in fees less a cut that leaves circulation:{" "}
                  {tournament.prizes.prizes
                    .map((prize, index) => (prize > 0 ? `${ordinal(index + 1)} ${money(prize)}` : null))
                    .filter(Boolean)
                    .join(", ")}
                  .
                </p>
              ) : null}
              {tournament.status !== "completed" && tournament.status !== "cancelled" ? (
                <p className={styles.lede}>
                  Seats nobody takes are filled by bots. A tournament that needs a bot turns free: every entry fee is refunded and no prize is paid, so a bot can never stand between anyone and money.
                </p>
              ) : null}
              {tournament.status !== "completed" && tournament.status !== "cancelled" && !tournament.paid && tournament.entry_fee > 0 ? <p className={styles.note}>A bot sat in, so this one is free and the fees were refunded.</p> : null}

              {open ? (
                <div className={styles.actions}>
                  {!signedIn ? (
                    <p className={styles.note}>
                      <Link href="/login">Sign in</Link> to enter.
                    </p>
                  ) : entered ? (
                    <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void act("withdraw", () => withdrawTournament(id))}>
                      {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                    </button>
                  ) : (
                    <button type="button" className={styles.primary} disabled={busy !== null || !verified} onClick={() => void act("register", () => registerTournament(id))}>
                      {busy === "register" ? "Entering…" : free ? "Register" : `Register for ${money(tournament.entry_fee)}`}
                    </button>
                  )}
                  {signedIn && !verified ? <span className={styles.note}>Verify your email to enter.</span> : null}
                  {entered ? <span className={styles.note}>You’re in. {free ? "" : "Withdraw before the start for a refund."}</span> : null}
                </div>
              ) : null}
              {problem ? <p className={styles.error}>{problem}</p> : null}
              {user?.is_admin && (open || tournament.status === "running") ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm("Cancel this tournament? Entry fees are refunded.")) void act("cancel", async () => (await cancelTournament(id), fetchTournament(id)));
                    }}
                  >
                    {busy === "cancel" ? "Cancelling…" : "Cancel tournament"}
                  </button>
                </div>
              ) : null}
            </section>

            {data.bracket ? (
              <section className={styles.section} aria-label="Bracket">
                <h2 className={styles.head}>Bracket</h2>
                <Bracket bracket={data.bracket} shape={shape} now={now} />
              </section>
            ) : null}

            <section className={styles.section} aria-label="Entrants">
              <h2 className={styles.head}>
                Entrants <small>{data.entrants.filter((entrant) => entrant.status !== "withdrawn").length}</small>
              </h2>
              {open || tournament.status === "running" ? (
                <p className={styles.lede}>
                  {open
                    ? "Think you know who takes it? Pick the champion before the start. Picks are free, never pay, and count on the ladder’s picks board."
                    : "Picks closed at the start."}
                </p>
              ) : null}
              {data.entrants.length ? (
                <ul className={styles.entrants}>
                  {data.entrants
                    .filter((entrant) => entrant.status !== "withdrawn")
                    .map((entrant) => {
                      const picked = me?.pick?.user_id === entrant.user_id;
                      return (
                        <li key={entrant.user_id} style={{ "--tal": talentAccent(entrant.profile_color) } as CSSProperties} data-out={entrant.status === "out" || undefined}>
                          <Link href={`/games/mahjong/player/${encodeURIComponent(entrant.username)}`}>{entrant.username}</Link>
                          <OshiTag symbol={entrant.oshi} />
                          <span className={styles.entrantState}>
                            {entrant.place ? `${ordinal(entrant.place)}${entrant.payout > 0 ? ` · ${money(entrant.payout)}` : ""}` : (STATUS_WORDS[entrant.status] ?? entrant.status)}
                          </span>
                          <span className={styles.entrantPicks} title="Spectators who picked them">
                            {entrant.picks} {entrant.picks === 1 ? "pick" : "picks"}
                            {picks > 0 ? ` (${Math.round((entrant.picks / picks) * 100)}%)` : ""}
                          </span>
                          {open && signedIn ? (
                            <button type="button" className={styles.secondary} disabled={busy !== null || picked} onClick={() => void act("pick", () => pickTournamentWinner(id, entrant.user_id).then(() => fetchTournament(id)))}>
                              {picked ? "Your pick" : "Pick"}
                            </button>
                          ) : picked ? (
                            <span className={styles.entrantState}>Your pick{me?.pick?.correct === true ? ": right" : me?.pick?.correct === false ? ": missed" : ""}</span>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <p className={styles.empty}>Nobody has registered yet.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </GamesFrame>
  );
}
