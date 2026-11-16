"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { BadgeStrip, BetaTag } from "@/app/components/games/mahjong/beta/beta";
import { DiscordLink, FeedbackButton } from "@/app/components/games/mahjong/feedback/feedback-button";
import { SceneArt } from "@/app/components/common/scene-art";
import { LiveTableRow, Segmented, TournamentRow, limitsLine, stakesBlock } from "@/app/components/games/mahjong/lobby/lobby-parts";
import { ChipsArt, FriendArt, PracticeArt, QuickArt } from "@/app/components/games/mahjong/lobby/mode-art";
import { Tile } from "@/app/components/games/mahjong/tile";
import { apiErrorCode, type ApiError } from "@/app/lib/api";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import { chipsLine, fmtChips, hasPlayedHere, markPlayedHere } from "@/app/lib/games/mahjong/chips";
import { createGuestTable, createMahjongTable, fetchMahjongLobby, fetchMahjongMe, fetchTournaments, mahjongChannels, sitMahjongTable } from "@/app/lib/games/mahjong/api";
import type { BotLevel, GameLength, LobbyPush, LobbyResponse, MeResponse, SeatedResponse, Speed, TournamentSummary } from "@/app/lib/games/mahjong/types";
import { primeChannel, useGamesChannel, useGamesConnected, useSeedChannel } from "@/app/lib/games/use-games-socket";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/lobby/mahjong-lobby.module.scss";

const LENGTHS: { value: GameLength; label: string }[] = [
  { value: "east", label: "East-only" },
  { value: "south", label: "East-South" },
];
type PracticeLength = GameLength | "hand";
const PRACTICE_LENGTHS: { value: PracticeLength; label: string }[] = [{ value: "hand", label: "One quick hand" }, ...LENGTHS];
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
  const [me, setMe] = useState<MeResponse | null>(null);
  const [playedHere, setPlayedHere] = useState(true);
  const limits = me?.limits ?? null;
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
    const timer = setTimeout(() => setPlayedHere(hasPlayedHere()), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchMahjongMe()
      .then((response) => !cancelled && setMe(response))
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
  const [practiceLength, setPracticeLength] = useState<PracticeLength>("east");
  const [practiceSpeed, setPracticeSpeed] = useState<Extract<Speed, "untimed" | "standard">>("untimed");
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
      const response = await make();
      markPlayedHere();
      enter(response);
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

  const practice = () => run("practice", () => createMahjongTable({ kind: "practice", length: practiceLength, level, speed: practiceSpeed }));
  // The first hand: one hand against easy bots, no clock, coach on. The guest endpoint can't take a length, so a signed-out visitor gets the guided hand instead.
  const firstHand = () =>
    run("first", () => (signedIn ? createMahjongTable({ kind: "practice", level: "easy", length: "hand", speed: "untimed", coach: true }) : createGuestTable({ lesson: "riichi" })));
  const guestPractice = () => run("guest", () => createGuestTable({ level: level === "easy" ? "easy" : "normal" }));
  const quick = () => run("quick", () => createMahjongTable({ kind: "ranked", length }));
  const friend = () => run("friend", () => createMahjongTable({ kind: "friend", length: friendLength, speed: friendSpeed, level: friendLevel, coach }));
  const stakes = (tier: number) => run(`stakes-${tier}`, () => createMahjongTable({ kind: "stakes", tier, length: stakesLength }));
  const sit = (id: number) => run(`sit-${id}`, () => sitMahjongTable(id));

  const playing = tables?.filter((table) => table.status === "playing").length ?? 0;
  const watching = tables?.reduce((sum, table) => sum + table.spectators, 0) ?? 0;
  const lobbyTables = tables ?? [];
  const trial = rules?.trial === true;
  // A newcomer has no badges and no games. Signed in, that is known only once /me says so (an older API sends no badges: then nobody is a newcomer).
  const newcomer = trial && (signedIn ? Array.isArray(me?.badges) && me.badges.length === 0 && (me.rating?.games ?? 0) === 0 : initialized && !playedHere);
  const chips = me?.chips ?? null;
  const openTournaments = (tournaments ?? []).filter((entry) => entry.status === "signup" || entry.status === "running");
  const botFill = rules?.bot_fill_seconds ?? 45;
  const waitingQuick = lobbyTables.filter((table) => table.kind === "ranked" && table.status !== "playing").length;

  return (
    <GamesFrame
      kicker="Mahjong · riichi, four players"
      title="Mahjong"
      live={connected}
      blurb={
        <>
          <BetaTag /> Riichi mahjong on NASFAQ’s own tiles. <b>{fmtInteger(playing)}</b> tables running, <b>{fmtInteger(watching)}</b> watching.
        </>
      }
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong/ladder">Ladder</Link>
          <Link href="/games/mahjong/ladder#highlights">Replays</Link>
          <Link href="/games/mahjong/learn">Guide</Link>
          <FeedbackButton />
          <DiscordLink />
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

        {trial ? (
          <p className={styles.betaLine}>
            <b>Beta.</b> You play with chips only. No Cash or Credit is ever taken or paid, and chips are worth nothing outside the beta.
          </p>
        ) : null}

        {newcomer ? (
          <section className={styles.firstHand} aria-labelledby="mj-first">
            <span className={styles.firstTiles} aria-hidden="true">
              <Tile kind={9} size={44} labels={false} />
              <Tile kind={33} size={44} labels={false} />
              <Tile kind={22} size={44} labels={false} />
            </span>
            <div className={styles.firstText}>
              <h2 id="mj-first">Play your first hand</h2>
              <p>
                {signedIn
                  ? "One hand against three easy bots. No clock, hints on, about three minutes. Nothing to lose."
                  : "A guided hand: the table tells you each move and why. No account needed, about three minutes."}
              </p>
              <button type="button" className={styles.primary} disabled={busy === "first" || !initialized} onClick={firstHand}>
                {busy === "first" ? "Dealing…" : "Play your first hand"}
              </button>
              {errors.first ? <p className={styles.error}>{errors.first}</p> : null}
              <p className={styles.firstLinks}>
                New to the game? <Link href="/games/mahjong/learn/tutorial">Walkthrough</Link> · <Link href="/games/mahjong/learn/easy-patterns">Five easy patterns</Link> · <Link href="/games/mahjong/learn/rules">Rules</Link>
              </p>
            </div>
          </section>
        ) : null}

        {trial && signedIn && !newcomer && (chips || me?.badges?.length) ? (
          <section className={styles.mySummary} aria-label="Your beta so far">
            {chips ? (
              <p className={styles.chipLine}>
                <span>
                  <small>Chips this week</small>
                  <b data-sign={Math.sign(chips.week)}>{fmtChips(chips.week)}</b> <em>{fmtInteger(chips.week_games)} {chips.week_games === 1 ? "game" : "games"}</em>
                </span>
                <span>
                  <small>Chips all time</small>
                  <b data-sign={Math.sign(chips.all)}>{fmtChips(chips.all)}</b> <em>{fmtInteger(chips.all_games)} {chips.all_games === 1 ? "game" : "games"}</em>
                </span>
                <Link href="/games/mahjong/ladder#chips">Leaderboards <FiArrowRight aria-hidden="true" /></Link>
              </p>
            ) : null}
            <BadgeStrip badges={me?.badges} />
          </section>
        ) : null}

        {newcomer ? null : (
        <>
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
        </>
        )}

        {initialized && !signedIn ? (
          <div className={styles.guest}>
            {trial ? (
              <p className={styles.note}>
                <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to sit with other players and keep your chips. Watching is free.
              </p>
            ) : (
              <SignInToPlay what="sit with other players or play for Credit. Watching is free" />
            )}
            {newcomer ? null : (
              <button type="button" className={styles.primary} disabled={busy === "guest"} onClick={guestPractice}>
                {busy === "guest" ? "Dealing…" : "Try a practice hand"}
              </button>
            )}
            {errors.guest ? <p className={styles.error}>{errors.guest}</p> : null}
          </div>
        ) : null}
        {loadError && !tables ? <p className={styles.empty}>Couldn’t reach the tables ({loadError}).</p> : null}

        <section className={styles.section} aria-labelledby="mj-play">
          <h2 id="mj-play" className={styles.head}>
            Play
          </h2>
          <div className={styles.modes}>
            <article className={styles.mode} aria-labelledby="mj-mode-quick">
              <div className={styles.modeStage}>
                <SceneArt slot="mahjong-lobby-quick" fill width={420} fallback={<QuickArt seconds={botFill} />} />
              </div>
              <header className={styles.modeHead}>
                <span className={styles.modeTags}>
                  <span data-accent="">Rated</span>
                  <span>Free</span>
                </span>
                <h3 id="mj-mode-quick">Quick match</h3>
              </header>
              <p className={styles.modeBlurb}>Free and rated. Open seats fill with players; bots take what’s left after {botFill} seconds.</p>
              <div className={styles.modeOptions}>
                <Segmented label="Length" value={length} options={LENGTHS} onChange={setLength} />
                {tables ? (
                  <div className={styles.modeBoard}>
                    <span className={styles.fieldLabel}>On the floor</span>
                    <dl>
                      <div data-live={waitingQuick > 0 || undefined}>
                        <dt>Waiting</dt>
                        <dd>{fmtInteger(waitingQuick)}</dd>
                      </div>
                      <div>
                        <dt>In play</dt>
                        <dd>{fmtInteger(playing)}</dd>
                      </div>
                      <div>
                        <dt>Watching</dt>
                        <dd>{fmtInteger(watching)}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </div>
              <div className={styles.modeFoot}>
                {signedIn && !verified ? <p className={styles.note}>Verify your email to sit with other players.</p> : null}
                {errors.quick ? <p className={styles.error}>{errors.quick}</p> : null}
                <button type="button" className={styles.primary} disabled={!signedIn || !verified || busy === "quick"} onClick={quick}>
                  {busy === "quick" ? "Finding a seat…" : "Find a game"}
                </button>
              </div>
            </article>

            <article className={styles.mode} aria-labelledby="mj-mode-practice">
              <div className={styles.modeStage}>
                <SceneArt slot="mahjong-lobby-practice" fill width={420} fallback={<PracticeArt />} />
              </div>
              <header className={styles.modeHead}>
                <span className={styles.modeTags}>
                  <span>Not rated</span>
                  <span>Hints on</span>
                </span>
                <h3 id="mj-mode-practice">Practice vs bots</h3>
              </header>
              <p className={styles.modeBlurb}>{practiceSpeed === "untimed" ? "You and three bots. Not rated, nothing at stake, no clock. Hints are on." : "You and three bots. Not rated, nothing at stake, on the standard clock. Hints are on."}</p>
              <div className={styles.modeOptions}>
                <Segmented label="Bots" value={level} options={LEVELS} onChange={setLevel} />
                <Segmented label="Length" value={practiceLength} options={PRACTICE_LENGTHS} onChange={setPracticeLength} />
                <Segmented
                  label="Clock"
                  value={practiceSpeed}
                  options={[
                    { value: "untimed", label: "Untimed" },
                    { value: "standard", label: `Standard${rules ? ` · ${rules.speeds.standard.turn}s` : ""}` },
                  ]}
                  onChange={setPracticeSpeed}
                />
              </div>
              <div className={styles.modeFoot}>
                {!signedIn ? <p className={styles.note}>Signed out? Use “Try a practice hand” above.</p> : null}
                {errors.practice ? <p className={styles.error}>{errors.practice}</p> : null}
                <button type="button" className={styles.primary} disabled={!signedIn || busy === "practice"} onClick={practice}>
                  {busy === "practice" ? "Dealing…" : "Practice"}
                </button>
              </div>
            </article>

            <article className={styles.mode} aria-labelledby="mj-mode-friend">
              <div className={styles.modeStage}>
                <SceneArt slot="mahjong-lobby-friend" fill width={420} fallback={<FriendArt />} />
              </div>
              <header className={styles.modeHead}>
                <span className={styles.modeTags}>
                  <span>Not rated</span>
                  <span>Invite link</span>
                </span>
                <h3 id="mj-mode-friend">Friend room</h3>
              </header>
              <p className={styles.modeBlurb}>A link for your friends. You deal when everyone’s in; bots take empty seats. Not rated.</p>
              <div className={styles.modeOptions}>
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
                  <input type="checkbox" checked={coach} onChange={(event) => setCoach(event.target.checked)} />
                  <span>Coaching hints</span>
                </label>
              </div>
              <div className={styles.modeFoot}>
                {errors.friend ? <p className={styles.error}>{errors.friend}</p> : null}
                <button type="button" className={styles.primary} disabled={!signedIn || !verified || busy === "friend"} onClick={friend}>
                  {busy === "friend" ? "Opening…" : "Create room"}
                </button>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="mj-stakes">
          <h2 id="mj-stakes" className={styles.head}>
            {trial ? "Chip tables" : "Stakes tables"}
          </h2>
          <div className={styles.stakes} data-trial={trial || undefined}>
            <div className={styles.stakesIntro}>
              <div className={styles.stakesStage}>
                <SceneArt slot="mahjong-lobby-chips" fill width={240} fallback={<ChipsArt />} />
              </div>
              <div className={styles.stakesText}>
                {trial ? (
                  <p className={styles.lede}>
                    Four players. Free to sit at, with as many chips as you like to play: each game just records chips by where you finish. Bots join after {botFill} seconds if seats are open.
                  </p>
                ) : (
                  <p className={styles.lede}>
                    Four players, no bots. The fee goes in, places pay a fixed prize, and points are never worth money. Credit only.
                  </p>
                )}
                {!trial && signedIn && limits ? <p className={styles.standing} data-blocked={limits.blocked ? "" : undefined}>{limitsLine(limits)}</p> : null}
                {trial && signedIn && chips ? (
                  <p className={styles.standing}>
                    Your chips: <b>{fmtChips(chips.week)}</b> this week ({fmtInteger(chips.week_games)} {chips.week_games === 1 ? "game" : "games"}), <b>{fmtChips(chips.all)}</b> all time ({fmtInteger(chips.all_games)} {chips.all_games === 1 ? "game" : "games"}).
                  </p>
                ) : null}
                <Segmented label="Length" value={stakesLength} options={LENGTHS} onChange={setStakesLength} layout="inline" />
              </div>
            </div>
            {rules?.stakes?.length ? (
              <div className={styles.tierHead} aria-hidden="true">
                <span>{trial ? "Table" : "Fee"}</span>
                <span>1st</span>
                <span>2nd</span>
                <span>3rd</span>
                <span>4th</span>
                {trial ? null : <span>House cut</span>}
              </div>
            ) : null}
            <ul className={styles.tiers}>
              {(rules?.stakes ?? []).map((tier) => {
                if (trial) {
                  const key = `stakes-${tier.fee}`;
                  const size = tier.chips?.length ? Math.max(...tier.chips.map((value) => Math.abs(value))) : tier.fee;
                  const block = !signedIn ? "Sign in to sit at a chip table." : !verified ? "Verify your email to sit with other players." : null;
                  return (
                    <li key={tier.fee} className={styles.tier} data-blocked={block ? "" : undefined}>
                      <div className={styles.tierFee}>
                        <small>Table</small>
                        <b>{fmtInteger(size)}</b>
                      </div>
                      <dl className={styles.prizes} aria-label={`Chips by place at the ${fmtInteger(size)} table: ${tier.chips ? chipsLine(tier.chips) : ""}`}>
                        {(tier.chips ?? []).map((value, index) => (
                          <div key={index}>
                            <dt>{["1st", "2nd", "3rd", "4th"][index]}</dt>
                            <dd data-zero={value === 0 || undefined} data-sign={Math.sign(value)}>
                              {fmtChips(value)}
                            </dd>
                          </div>
                        ))}
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
                }
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
            {rules && !trial ? (
              <p className={styles.fine}>
                A week’s results, up or down, stay within what your Credit turns into Cash at the Saturday review ({Math.round(rules.weekly_rate * 100)}% of it, or {money(rules.weekly_minimum)}). Up to {rules.paid_games_per_day} paid games a day.
              </p>
            ) : null}
          </div>
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
                <TournamentRow key={entry.id} tournament={entry} trial={trial} />
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
