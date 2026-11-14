"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { OshiTag, PlaceBar, ordinal, rate, seasonLabel, shortDate, useMahjongRules } from "@/app/components/games/mahjong/records/record-parts";
import { apiErrorCode } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchMahjongPlayer } from "@/app/lib/games/mahjong/api";
import type { PlayerRecord } from "@/app/lib/games/mahjong/types";
import { talentAccent } from "@/app/lib/talent-color";
import styles from "@/app/components/games/mahjong/records/records.module.scss";

const KIND_WORDS: Record<string, string> = { ranked: "Quick match", stakes: "Stakes table", friend: "Friend room", tournament: "Tournament", practice: "Practice", tutorial: "Tutorial" };

export function PlayerView({ username }: { username: string }) {
  const { rankName, rankedAfter } = useMahjongRules();
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMahjongPlayer(username)
      .then((response) => !cancelled && (setRecord(response), setError(null)))
      .catch((failure) => !cancelled && setError(apiErrorCode(failure) === "profile_not_found" ? "No player with that name." : gameErrorText(failure)));
    return () => {
      cancelled = true;
    };
  }, [username]);

  const totals = record?.totals;
  const name = record?.user.username ?? username;
  const style = { "--tal": talentAccent(record?.user.profile_color) } as CSSProperties;
  const best = record?.current?.best_game_id ? record.current : (record?.seasons.find((season) => season.best_game_id) ?? null);

  return (
    <GamesFrame
      kicker="Mahjong · record"
      title={name}
      blurb={record ? <>Riichi mahjong record on NASFAQ.</> : undefined}
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong/ladder">Ladder</Link>
          <Link href={`/profile/${encodeURIComponent(name)}`}>Profile</Link>
        </nav>
      }
    >
      <div className={styles.page} style={style}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!record && !error ? <p className={styles.note}>Loading the record…</p> : null}
        {record && totals ? (
          <>
            <div className={styles.hero}>
              <div className={styles.heroRank}>
                <small>{seasonLabel(record.season)}</small>
                <b>{rankName(record.rank)}</b>
              </div>
              <div className={styles.heroRank}>
                <small>Rating</small>
                <b>{Math.round(record.rating)}</b>
              </div>
              <OshiTag symbol={record.user.oshi} size={18} />
              {record.rank === "unranked" ? <p className={styles.note}>{rankedAfter} rated games in a season earn a rank.</p> : null}
            </div>

            {totals.games === 0 ? (
              <p className={styles.empty}>{name} hasn’t finished a rated mahjong game yet.</p>
            ) : (
              <section className={styles.section} aria-label="Totals">
                <h2 className={styles.head}>All seasons</h2>
                <dl className={styles.stats}>
                  <div>
                    <dt>Games</dt>
                    <dd>{totals.games}</dd>
                  </div>
                  <div>
                    <dt>Placements</dt>
                    <dd style={{ fontSize: "0.9rem" }}>
                      {totals.firsts}-{totals.seconds}-{totals.thirds}-{totals.fourths}
                    </dd>
                  </div>
                  <div>
                    <dt>Win rate</dt>
                    <dd>{rate(totals.wins, totals.hands)}</dd>
                  </div>
                  <div>
                    <dt>Self-draws</dt>
                    <dd>{rate(totals.tsumo, totals.wins)}</dd>
                  </div>
                  <div>
                    <dt>Deal-in rate</dt>
                    <dd>{rate(totals.deal_ins, totals.hands)}</dd>
                  </div>
                  <div>
                    <dt>Riichi rate</dt>
                    <dd>{rate(totals.riichi, totals.hands)}</dd>
                  </div>
                  <div>
                    <dt>Call rate</dt>
                    <dd>{rate(totals.calls, totals.hands)}</dd>
                  </div>
                  <div>
                    <dt>Yakuman</dt>
                    <dd>{totals.yakuman}</dd>
                  </div>
                  <div>
                    <dt>Peak rating</dt>
                    <dd>{Math.round(totals.peak)}</dd>
                  </div>
                  <div>
                    <dt>Best hand</dt>
                    <dd>
                      {totals.best_points ? totals.best_points.toLocaleString("en-US") : "none"}
                      {best?.best_game_id ? (
                        <small style={{ display: "block", fontSize: "0.75rem", fontWeight: 400 }}>
                          <Link href={`/games/mahjong/replay/${best.best_game_id}${best.best_hand_index !== null ? `?hand=${best.best_hand_index}` : ""}`}>replay</Link>
                        </small>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            {record.seasons.length ? (
              <section className={styles.section} aria-label="Seasons">
                <h2 className={styles.head}>Season by season</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.ladder}>
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th>Rank</th>
                        <th>Rating</th>
                        <th>Games</th>
                        <th>Places</th>
                        <th>Win rate</th>
                        <th>Deal-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.seasons.map((season) => (
                        <tr key={season.season}>
                          <td>{seasonLabel(season.season)}</td>
                          <td>
                            <span className={styles.rankName}>{rankName(season.rank)}</span>
                          </td>
                          <td className={styles.rating}>
                            {Math.round(season.rating)} <span className={styles.dim}>peak {Math.round(season.peak)}</span>
                          </td>
                          <td>{season.games}</td>
                          <td>
                            <PlaceBar places={season.places} />
                          </td>
                          <td>{rate(season.wins, season.hands)}</td>
                          <td>{rate(season.deal_ins, season.hands)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className={styles.section} aria-label="Tournaments and picks">
              <h2 className={styles.head}>Tournaments and picks</h2>
              {record.tournaments_won.length ? (
                <ul className={styles.rows}>
                  {record.tournaments_won.map((won) => (
                    <li key={won.id}>
                      <b>Won</b>
                      <Link href={`/games/mahjong/tournaments/${won.id}`}>{won.name}</Link>
                      <span className={styles.rowEnd}>{shortDate(won.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>No tournament wins yet.</p>
              )}
              <p className={styles.note} style={{ marginTop: "0.6rem" }}>
                Spectator picks: <b>{record.picks.correct}</b> right of {record.picks.total} ({rate(record.picks.correct, record.picks.total)}). Picks are free and never pay.
              </p>
            </section>

            <section className={styles.section} aria-label="Recent games">
              <h2 className={styles.head}>Recent games</h2>
              {record.recent.length ? (
                <div>
                  {record.recent.map((game) => {
                    const mine = game.players.find((player) => player.username.toLowerCase() === name.toLowerCase());
                    return (
                      <div key={game.id} className={styles.gameRow}>
                        <span className={styles.gamePlace}>{mine?.place ? ordinal(mine.place) : "n/a"}</span>
                        <span>
                          <Link href={`/games/mahjong/replay/${game.id}`}>{game.tournament_name ?? KIND_WORDS[game.kind] ?? game.kind}</Link>
                          <span className={styles.dim}> · {game.length === "south" ? "East-South" : "East-only"} · {shortDate(game.completed_at)}</span>
                        </span>
                        <span className={styles.gamePlayers}>
                          {[...game.players]
                            .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
                            .map((player) => (
                              <span key={player.seat} data-me={player.username.toLowerCase() === name.toLowerCase() || undefined}>
                                {player.place}. {player.username}
                              </span>
                            ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
                ) : (
                  <p className={styles.note}>No finished games.</p>
                )}
            </section>
          </>
        ) : null}
      </div>
    </GamesFrame>
  );
}
