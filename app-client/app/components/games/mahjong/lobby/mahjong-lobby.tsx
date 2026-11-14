"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { LiveTableRow, Segmented, TournamentRow, limitsLine, stakesBlock } from "@/app/components/games/mahjong/lobby/lobby-parts";
import { Tile } from "@/app/components/games/mahjong/tile";
import { apiErrorCode, type ApiError } from "@/app/lib/api";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import { createGuestTable, createMahjongTable, fetchMahjongLobby, fetchMahjongMe, fetchTournaments, mahjongChannels, sitMahjongTable } from "@/app/lib/games/mahjong/api";
import type { BotLevel, GameLength, LobbyPush, LobbyResponse, MahjongLimits, SeatedResponse, TournamentSummary } from "@/app/lib/games/mahjong/types";
import { primeChannel, useGamesChannel, useGamesConnected, useSeedChannel } from "@/app/lib/games/use-games-socket";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/lobby/mahjong-lobby.module.scss";

const LENGTHS: { value: GameLength; label: string }[] = [
  { value: "east", label: "East-only" },
  { value: "south", label: "East-South" },
];
const LEVELS: { value: BotLevel; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

const money = (value: number) => fmtNumber(value, "$");

export function MahjongLobby() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const connected = useGamesConnected();
  const now = useNow();
  const signedIn = Boolean(user);
  const verified = Boolean(user?.email_verified);

  const [seed, setSeed] = useState<LobbyResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [limits, setLimits] = useState<MahjongLimits | null>(null);
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMahjongLobby()
      .then((response) => !cancelled && setSeed(response))
      .catch((error) => !cancelled && setLoadError(gameErrorText(error)));
    fetchTournaments()
      .then((response) => !cancelled && setTournaments(response.tournaments))
      .catch(() => !cancelled && setTournaments([]));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchMahjongMe()
      .then((response) => !cancelled && setLimits(response.limits))
      .catch(() => {
        /* the API decides again at the seat */
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, user?.id]);

  const seedPush: LobbyPush | null = seed ? { type: "lobby", game: "mahjong", tables: seed.tables, server_time: seed.server_time } : null;
  useSeedChannel(mahjongChannels.lobby, seedPush);
  const live = useGamesChannel<LobbyPush>(mahjongChannels.lobby);
  const tables = live?.tables ?? seed?.tables ?? null;
  const rules = seed?.rules ?? null;
  const myTable = seed?.my_table ?? null;

  const [length, setLength] = useState<GameLength>("east");
  const [practiceLength, setPracticeLength] = useState<GameLength>("east");
  const [level, setLevel] = useState<BotLevel>("normal");
  const [friendLength, setFriendLength] = useState<GameLength>("east");
  const [friendSpeed, setFriendSpeed] = useState<"standard" | "relaxed">("standard");
  const [friendLevel, setFriendLevel] = useState<BotLevel>("normal");
  const [coach, setCoach] = useState(false);
  const [stakesLength, setStakesLength] = useState<GameLength>("east");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seatedAt, setSeatedAt] = useState<number | null>(null);

  const enter = (response: SeatedResponse) => {
    primeChannel(response.seat.channel, { type: "mahjong", table: response.table, server_time: response.table.server_time });
    router.push(`/games/mahjong/table/${response.table.id}`);
  };

  const run = async (key: string, make: () => Promise<SeatedResponse>) => {
    setBusy(key);
    setErrors({});
    setSeatedAt(null);
    try {
      enter(await make());
    } catch (error) {
      // Already at a table: say so and offer the way back, rather than quietly opening it.
      const tableId = (error as Partial<ApiError>)?.body?.table_id;
      if (apiErrorCode(error) === "already_seated" && typeof tableId === "number" && Number.isSafeInteger(tableId) && tableId > 0) {
        setSeatedAt(tableId);
        setBusy(null);
        return;
      }
      setErrors({ [key]: gameErrorText(error) });
      setBusy(null);
    }
  };

  const practice = () => run("practice", () => createMahjongTable({ kind: "practice", length: practiceLength, level, speed: "untimed" }));
  const guestPractice = () => run("guest", () => createGuestTable({ level: level === "easy" ? "easy" : "normal" }));
  const quick = () => run("quick", () => createMahjongTable({ kind: "ranked", length }));
  const friend = () => run("friend", () => createMahjongTable({ kind: "friend", length: friendLength, speed: friendSpeed, level: friendLevel, coach }));
  const stakes = (tier: number) => run(`stakes-${tier}`, () => createMahjongTable({ kind: "stakes", tier, length: stakesLength }));
  const sit = (id: number) => run(`sit-${id}`, () => sitMahjongTable(id));

  const playing = tables?.filter((table) => table.status === "playing").length ?? 0;
  const watching = tables?.reduce((sum, table) => sum + table.spectators, 0) ?? 0;
  const lobbyTables = tables ?? [];
  const openTournaments = (tournaments ?? []).filter((entry) => entry.status === "signup" || entry.status === "running");

  return (
    <GamesFrame
      kicker="Mahjong · riichi, four players"
      title="Mahjong"
      live={connected}
      blurb={
        <>
          Riichi mahjong on NASFAQ’s own tiles. <b>{fmtInteger(playing)}</b> tables running, <b>{fmtInteger(watching)}</b> watching.
        </>
      }
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong/ladder">Ladder</Link>
          <Link href="/games/mahjong/ladder#highlights">Replays</Link>
          <Link href="/games/mahjong/learn">Guide</Link>
        </nav>
      }
    >
      <div className={styles.page}>
        {seatedAt !== null ? (
          <div className={styles.seatedNote} role="alert">
            <span>You’re still seated at another table.</span>
            <Link href={`/games/mahjong/table/${encodeURIComponent(String(seatedAt))}`}>
              Go to that table <FiArrowRight aria-hidden="true" />
            </Link>
          </div>
        ) : null}
        {myTable ? (
          <Link href={`/games/mahjong/table/${myTable.id}`} className={styles.back}>
            <i aria-hidden="true" />
            <span>You have a table going.</span>
            <b>
              Back to your table <FiArrowRight aria-hidden="true" />
            </b>
          </Link>
        ) : null}

        <Link href="/games/mahjong/learn" className={styles.newHere}>
          <span className={styles.newHereTiles} aria-hidden="true">
            <Tile kind={9} size={30} labels={false} />
            <Tile kind={33} size={30} labels={false} />
            <Tile kind={22} size={30} labels={false} />
          </span>
          <span className={styles.newHereText}>
            <strong>New here?</strong> Learn the game in a few minutes, then play the guided hand.
          </span>
          <span className={styles.newHereGo}>
            Start learning <FiArrowRight aria-hidden="true" />
          </span>
        </Link>
        <p className={styles.tutorialLine}>
          <Link href="/games/mahjong/learn/tutorial">Play the guided tutorial hand</Link>: four moves, a riichi and a win.
        </p>

        {initialized && !signedIn ? (
          <div className={styles.guest}>
            <SignInToPlay what="sit with other players or play for Credit. Watching is free" />
            <button type="button" className={styles.primary} disabled={busy === "guest"} onClick={guestPractice}>
              {busy === "guest" ? "Dealing…" : "Try a practice hand"}
            </button>
            {errors.guest ? <p className={styles.error}>{errors.guest}</p> : null}
          </div>
        ) : null}
        {loadError && !tables ? <p className={styles.empty}>Couldn’t reach the tables ({loadError}).</p> : null}

        <section className={styles.section} aria-labelledby="mj-play">
          <h2 id="mj-play" className={styles.head}>
            Play
          </h2>
          <div className={styles.modes}>
            <div className={styles.mode}>
              <h3>Quick match</h3>
              <p>Free and rated. Open seats fill with players; bots take what’s left after {rules?.bot_fill_seconds ?? 45} seconds.</p>
              <Segmented label="Length" value={length} options={LENGTHS} onChange={setLength} />
              <button type="button" className={styles.primary} disabled={!signedIn || !verified || busy === "quick"} onClick={quick}>
                {busy === "quick" ? "Finding a seat…" : "Find a game"}
              </button>
              {signedIn && !verified ? <p className={styles.note}>Verify your email to sit with other players.</p> : null}
              {errors.quick ? <p className={styles.error}>{errors.quick}</p> : null}
            </div>

            <div className={styles.mode}>
              <h3>Practice vs bots</h3>
              <p>You and three bots. Not rated, nothing at stake, no clock to speak of. Hints are on.</p>
              <Segmented label="Bots" value={level} options={LEVELS} onChange={setLevel} />
              <Segmented label="Length" value={practiceLength} options={LENGTHS} onChange={setPracticeLength} />
              <button type="button" className={styles.primary} disabled={!signedIn || busy === "practice"} onClick={practice}>
                {busy === "practice" ? "Dealing…" : "Practice"}
              </button>
              {!signedIn ? <p className={styles.note}>Signed out? Use “Try a practice hand” above.</p> : null}
              {errors.practice ? <p className={styles.error}>{errors.practice}</p> : null}
            </div>

            <div className={styles.mode}>
              <h3>Friend room</h3>
              <p>A link for your friends. You deal when everyone’s in; bots take empty seats. Not rated.</p>
              <Segmented label="Length" value={friendLength} options={LENGTHS} onChange={setFriendLength} />
              <Segmented
                label="Clock"
                value={friendSpeed}
                options={[
                  { value: "standard", label: `Standard${rules ? ` · ${rules.speeds.standard.turn}s` : ""}` },
                  { value: "relaxed", label: `Relaxed${rules ? ` · ${rules.speeds.relaxed.turn}s` : ""}` },
                ]}
                onChange={setFriendSpeed}
              />
              <Segmented label="Bots" value={friendLevel} options={LEVELS} onChange={setFriendLevel} />
              <label className={styles.check}>
                <input type="checkbox" checked={coach} onChange={(event) => setCoach(event.target.checked)} /> Coaching hints
              </label>
              <button type="button" className={styles.primary} disabled={!signedIn || !verified || busy === "friend"} onClick={friend}>
                {busy === "friend" ? "Opening…" : "Create room"}
              </button>
              {errors.friend ? <p className={styles.error}>{errors.friend}</p> : null}
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="mj-stakes">
          <div className={styles.headRow}>
            <h2 id="mj-stakes" className={styles.head}>
              Stakes tables
            </h2>
            <Segmented label="Length" value={stakesLength} options={LENGTHS} onChange={setStakesLength} />
          </div>
          <p className={styles.lede}>
            Four players, no bots. The fee goes in, places pay a fixed prize, and points are never worth money. Credit only.
          </p>
          {signedIn && limits ? <p className={styles.standing} data-blocked={limits.blocked ? "" : undefined}>{limitsLine(limits)}</p> : null}
          <ul className={styles.tiers}>
            {(rules?.stakes ?? []).map((tier) => {
              const block = stakesBlock(limits, tier, signedIn, verified);
              const key = `stakes-${tier.fee}`;
              return (
                <li key={tier.fee} className={styles.tier} data-blocked={block ? "" : undefined}>
                  <div className={styles.tierFee}>
                    <small>Fee</small>
                    <b>{money(tier.fee)}</b>
                  </div>
                  <dl className={styles.prizes} aria-label={`Prizes at the ${money(tier.fee)} table`}>
                    {tier.prizes.map((prize, index) => (
                      <div key={index}>
                        <dt>{["1st", "2nd", "3rd", "4th"][index]}</dt>
                        <dd data-zero={prize === 0 || undefined}>{prize === 0 ? "—" : money(prize)}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>House cut</dt>
                      <dd data-zero="">{money(tier.cut)}</dd>
                    </div>
                  </dl>
                  <div className={styles.tierGo}>
                    <button type="button" className={styles.primary} disabled={Boolean(block) || busy === key} onClick={() => stakes(tier.fee)}>
                      {busy === key ? "Sitting…" : "Sit down"}
                    </button>
                  </div>
                  {block ? <p className={styles.note}>{block}</p> : null}
                  {errors[key] ? <p className={styles.error}>{errors[key]}</p> : null}
                </li>
              );
            })}
          </ul>
          {rules ? (
            <p className={styles.fine}>
              A week’s results, up or down, stay within what your Credit turns into Cash at the Saturday review ({Math.round(rules.weekly_rate * 100)}% of it, or {money(rules.weekly_minimum)}). Up to {rules.paid_games_per_day} paid games a day.
            </p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="mj-live">
          <h2 id="mj-live" className={styles.head}>
            Live tables <small>{lobbyTables.length}</small>
          </h2>
          {tables === null ? null : lobbyTables.length ? (
            <ul className={styles.liveList}>
              {lobbyTables.map((table) => (
                <LiveTableRow key={table.id} table={table} now={now} canSit={signedIn && verified && !myTable} busy={busy === `sit-${table.id}`} onSit={sit} />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No one at the tables right now. Open a quick match and the seats start filling.</p>
          )}
          {Object.entries(errors).map(([key, text]) => (key.startsWith("sit-") ? <p key={key} className={styles.error}>{text}</p> : null))}
        </section>

        <section className={styles.section} aria-labelledby="mj-tournaments">
          <div className={styles.headRow}>
            <h2 id="mj-tournaments" className={styles.head}>
              Tournaments <small>{openTournaments.length}</small>
            </h2>
            <Link href="/games/mahjong/tournaments" className={styles.more}>
              All tournaments <FiArrowRight aria-hidden="true" />
            </Link>
          </div>
          {tournaments === null ? null : openTournaments.length ? (
            <ul className={styles.tournamentList}>
              {openTournaments.map((entry) => (
                <TournamentRow key={entry.id} tournament={entry} />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nothing scheduled. Knockouts show up here when staff open sign-up.</p>
          )}
        </section>
      </div>
    </GamesFrame>
  );
}
