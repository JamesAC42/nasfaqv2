"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { HighlightRow, OshiTag, PlaceBar, PlayerLink, rate, seasonLabel, useMahjongRules } from "@/app/components/games/mahjong/records/record-parts";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchMahjongLeaderboard } from "@/app/lib/games/mahjong/api";
import type { LeaderboardResponse } from "@/app/lib/games/mahjong/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/records/records.module.scss";

type Tab = "ladder" | "oshi" | "picks";
const TABS: { key: Tab; label: string }[] = [
  { key: "ladder", label: "Ladder" },
  { key: "oshi", label: "Oshi standings" },
  { key: "picks", label: "Spectators’ picks" },
];

/** The last six seasons up to and including `current` ("2026-11"). */
function seasonChoices(current: string, seen: string) {
  const [year, month] = current.split("-").map(Number);
  const out: string[] = [];
  for (let back = 0; back < 6 && Number.isFinite(year); back += 1) {
    const date = new Date(year, month - 1 - back, 1);
    out.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return out.includes(seen) ? out : [...out, seen];
}

export function LadderView() {
  const { user } = useAuth();
  const { rankName, rankedAfter } = useMahjongRules();
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ladder");

  useEffect(() => {
    let cancelled = false;
    fetchMahjongLeaderboard(season)
      .then((response) => !cancelled && (setData(response), setError(null)))
      .catch((failure) => !cancelled && setError(gameErrorText(failure)));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const shown = data?.season ?? season ?? "";
  const choices = useMemo(() => (data ? seasonChoices(data.current_season, data.season) : []), [data]);
  const isCurrent = data ? data.season === data.current_season : true;

  return (
    <GamesFrame
      kicker="Mahjong · ladder"
      title="Ladder"
      blurb={data ? <>{seasonLabel(shown)}{isCurrent ? ", this season" : ""}. Ratings start at 1,500 each month.</> : undefined}
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong">Lobby</Link>
          <Link href="/games/mahjong/tournaments">Tournaments</Link>
          <Link href="#highlights">Highlights</Link>
        </nav>
      }
    >
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="Ladder sections">
            {TABS.map((entry) => (
              <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} onClick={() => setTab(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
          {data ? (
            <label>
              <span className={styles.centerFact}>Season </span>
              <select className={styles.select} value={shown} onChange={(event) => setSeason(event.target.value)} aria-label="Season">
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {seasonLabel(choice)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
        {!data && !error ? <p className={styles.note}>Loading the ladder…</p> : null}

        {data && tab === "ladder" ? (
          <section className={styles.section} aria-label="Season ladder">
            <p className={styles.lede}>
              Play {rankedAfter} rated games in a season to be ranked. New seasons start everyone halfway back to 1,500. Bots’ ratings never move.
            </p>
            {data.ladder.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.ladder}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Rank</th>
                      <th>Rating</th>
                      <th>Games</th>
                      <th>Places 1-2-3-4</th>
                      <th>Win rate</th>
                      <th>Deal-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ladder.map((row) => (
                      <tr key={row.user_id} data-me={user?.id === row.user_id || undefined}>
                        <td>{row.place}</td>
                        <td>
                          <PlayerLink name={row.username} color={row.profile_color} /> <OshiTag symbol={row.oshi} />
                        </td>
                        <td>
                          <span className={styles.rankName}>{rankName(row.rank)}</span>
                        </td>
                        <td className={styles.rating}>{Math.round(row.rating)}</td>
                        <td>{row.games}</td>
                        <td>
                          <PlaceBar places={row.places} /> <span className={styles.dim}>{row.places.join("-")}</span>
                        </td>
                        <td>{rate(row.wins, row.hands)}</td>
                        <td>{rate(row.deal_ins, row.hands)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.empty}>Nobody has played enough rated games {isCurrent ? "yet this season" : "that season"} to be ranked. {isCurrent ? "Quick matches and tournaments are rated." : ""}</p>
            )}
          </section>
        ) : null}

        {data && tab === "oshi" ? (
          <section className={styles.section} aria-label="Oshi standings">
            <p className={styles.lede}>
              How each talent’s fans do at mahjong this season: their ranked players’ ratings, averaged. This is fans’ results at the table and has nothing to do with the stock or its price.
            </p>
            {data.oshi.length ? (
              <ol className={styles.rows}>
                {data.oshi.map((row, index) => (
                  <li key={row.symbol}>
                    <b>{index + 1}</b>
                    <OshiTag symbol={row.symbol} size={20} />
                    <span>
                      <b>{Math.round(row.rating)}</b> average rating
                    </span>
                    <span className={styles.rowEnd}>
                      {row.players} {row.players === 1 ? "player" : "players"} · {row.games} games · {row.firsts} firsts{row.yakuman ? ` · ${row.yakuman} yakuman` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.empty}>No oshi has a ranked player yet.</p>
            )}
          </section>
        ) : null}

        {data && tab === "picks" ? (
          <section className={styles.section} aria-label="Spectators’ picks">
            <p className={styles.lede}>Anyone can pick who wins a game before its second hand, for free. Nothing is paid on a pick. This is who calls them best.</p>
            {data.picks.length ? (
              <ol className={styles.rows}>
                {data.picks.map((row, index) => (
                  <li key={row.user_id}>
                    <b>{index + 1}</b>
                    <PlayerLink name={row.username} color={row.profile_color} />
                    <span className={styles.rowEnd}>
                      <b>{row.correct}</b> right of {row.total} · {rate(row.correct, row.total)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.empty}>Five settled picks to appear here.</p>
            )}
          </section>
        ) : null}

        {data ? (
          <div id="highlights">
            {data.hand_of_the_day ? (
              <section className={styles.section} aria-label="Hand of the day">
                <h2 className={styles.head}>Hand of the day</h2>
                <ul className={styles.highlights}>
                  <HighlightRow hand={data.hand_of_the_day} big />
                </ul>
              </section>
            ) : null}
            <section className={styles.section} aria-label="Biggest hands">
              <h2 className={styles.head}>
                Biggest hands <small>{seasonLabel(shown)}</small>
              </h2>
              {data.biggest.length ? (
                <ul className={styles.highlights}>
                  {data.biggest.map((hand, index) => (
                    <HighlightRow key={`${hand.game_id}-${hand.hand_index}-${hand.user_id}`} hand={hand} rank={index + 1} />
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>No big hands yet.</p>
              )}
            </section>
            <section className={styles.section} aria-label="Yakuman wall">
              <h2 className={styles.head}>The yakuman wall</h2>
              {data.yakuman.length ? (
                <ul className={styles.highlights}>
                  {data.yakuman.map((hand) => (
                    <HighlightRow key={`${hand.game_id}-${hand.hand_index}-${hand.user_id}`} hand={hand} big />
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>No yakuman yet. The first one goes up here.</p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </GamesFrame>
  );
}
