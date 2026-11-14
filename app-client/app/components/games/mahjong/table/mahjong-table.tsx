"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaEye } from "react-icons/fa6";
import { SiteShell } from "@/app/components/layout/site-shell";
import { usePhone } from "@/app/components/games/blackjack/bj-utils";
import { ActionBar, ActionHints } from "@/app/components/games/mahjong/table/action-bar";
import { Board, useCallouts } from "@/app/components/games/mahjong/table/board";
import { GameOver } from "@/app/components/games/mahjong/table/game-over";
import { CheatSheet, HelpPanel } from "@/app/components/games/mahjong/table/help-panel";
import { LessonCoach, LessonDone, lessonMoveOf } from "@/app/components/games/mahjong/table/lesson";
import { lessonOf } from "@/app/components/games/mahjong/table/lesson-texts";
import { MyHand, type TileMark } from "@/app/components/games/mahjong/table/my-hand";
import { ResultPanel } from "@/app/components/games/mahjong/table/result-panel";
import { useSeatStyles } from "@/app/components/games/mahjong/table/seat-portrait";
import { SpectatorStrip } from "@/app/components/games/mahjong/table/spectator-strip";
import { useHelpOn, useSingleTap } from "@/app/components/games/mahjong/table/table-prefs";
import { ReactionBar, ReactionLayer, useTableReactions } from "@/app/components/games/mahjong/table/table-reactions";
import { useMahjongTable } from "@/app/components/games/mahjong/table/use-mahjong-table";
import { WaitingRoom } from "@/app/components/games/mahjong/table/waiting-room";
import { PublicMeld, TileBack } from "@/app/components/games/mahjong/tile";
import type { ChibiPose } from "@/app/lib/art-manifest";
import { apiErrorCode } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { actMahjong, backToSeat, createGuestTable, createMahjongTable, leaveMahjongTable, readyForNext, sitMahjongTable, startMahjongTable } from "@/app/lib/games/mahjong/api";
import { forgetSeatToken } from "@/app/lib/games/mahjong/seat-token";
import { seatLabel, seatPose, standingOf } from "@/app/lib/games/mahjong/table-model";
import { kindName, kindOf, tileName, type TileId } from "@/app/lib/games/mahjong/tiles";
import { isSeatedTable, isSeatHand, type HandResult, type MahjongAction, type SeatedResponse, type SeatIndex, type SeatedTable, type StampPose } from "@/app/lib/games/mahjong/types";
import { primeChannel, useGamesConnected } from "@/app/lib/games/use-games-socket";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { useAuth } from "@/app/providers/auth-provider";
import panels from "@/app/components/games/mahjong/table/table-panels.module.scss";
import styles from "@/app/components/games/mahjong/table/table-page.module.scss";

const NO_SEATS: never[] = [];
const NO_MARKS: ReadonlyMap<TileId, TileMark> = new Map();
const NO_TILES: ReadonlySet<TileId> = new Set();
const KIND_TITLE: Record<string, string> = { practice: "Practice", tutorial: "Lesson", friend: "Friend room", ranked: "Quick match", stakes: "Stakes table", tournament: "Tournament" };

type Captured = { key: string; handIndex: number; result: HandResult; dora: number[]; label: string };

function MyClock({ deadline, bank, turnMs }: { deadline: number; bank: number; turnMs: number }) {
  const left = useRemaining(deadline, 200);
  if (left === null) return null;
  const base = Math.max(0, left - bank);
  const inBank = Math.min(left, bank);
  const total = Math.max(1, turnMs + bank);
  return (
    <div className={styles.clock} data-urgent={left <= 5000 || undefined} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <span className={styles.clockTrack}>
        <i style={{ transform: `scaleX(${Math.min(1, left / total)})` }} />
      </span>
      <b>{Math.ceil(base / 1000)}s</b>
      <small>{bank > 0 ? `bank ${Math.ceil(inBank / 1000)}s` : ""}</small>
    </div>
  );
}

function Toggle({ on, onChange, children, title }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles.toggle} data-on={on || undefined} onClick={() => onChange(!on)} title={title}>
      <i aria-hidden="true" />
      {children}
    </button>
  );
}

export function MahjongTablePage({ tableId }: { tableId: number }) {
  const router = useRouter();
  const { user, initialized } = useAuth();
  const connected = useGamesConnected();
  const phone = usePhone();
  const signedIn = Boolean(user);
  const verified = Boolean(user?.email_verified);
  const viewer = initialized ? (user ? String(user.id) : "anon") : null;
  const { table, load, apply, take, myPick, setMyPick } = useMahjongTable(tableId, viewer);

  const seated = isSeatedTable(table);
  const mySeat: SeatIndex | null = seated ? table.me.seat : null;
  const game = table?.game ?? null;
  const hand = game?.hand ?? null;
  const seatHand = hand && isSeatHand(hand) ? hand : null;
  const bottom: SeatIndex = mySeat ?? 0;
  const seatStyles = useSeatStyles(table?.seats ?? NO_SEATS);

  const [helpOn, setHelpOn] = useHelpOn();
  const [singleTap, setSingleTap] = useSingleTap();
  const [selected, setSelected] = useState<TileId | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [autoWin, setAutoWin] = useState(false);
  const [noCalls, setNoCalls] = useState(false);
  const [autoDiscard, setAutoDiscard] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [callouts, pushCallout] = useCallouts();
  const busyRef = useRef(false);

  // Each hand starts clean: nothing lifted, the three toggles off, the result open. Settings stay.
  const handKey = game ? `${table?.id}:${game.hand_index}` : "none";
  const [seenHand, setSeenHand] = useState(handKey);
  if (seenHand !== handKey) {
    setSeenHand(handKey);
    setSelected(null);
    setRiichiMode(false);
    setAutoWin(false);
    setNoCalls(false);
    setAutoDiscard(false);
    setCollapsed(false);
    setError(null);
  }

  // The last full result, kept: the table drops it from view once the game is over.
  const [captured, setCaptured] = useState<Captured | null>(null);
  if (game && hand && hand.phase === "over" && hand.result && captured?.key !== `${table?.id}:${game.hand_index}`) {
    setCaptured({ key: `${table?.id}:${game.hand_index}`, handIndex: game.hand_index, result: hand.result, dora: hand.dora, label: game.label });
  }

  // ── Stamps ──────────────────────────────────────────────────────────
  const [stamps, setStamps] = useState<Record<number, StampPose>>({});
  const stampTimers = useRef(new Map<number, number>());
  useEffect(() => {
    const timers = stampTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const onStamp = useCallback((seat: number, pose: StampPose) => {
    setStamps((current) => ({ ...current, [seat]: pose }));
    const timers = stampTimers.current;
    const previous = timers.get(seat);
    if (previous) window.clearTimeout(previous);
    timers.set(
      seat,
      window.setTimeout(() => {
        timers.delete(seat);
        setStamps((current) => {
          const next = { ...current };
          delete next[seat];
          return next;
        });
      }, 2600),
    );
  }, []);
  const reactions = useTableReactions(tableId, mySeat ?? -1, bottom, phone, onStamp);

  // ── Moves ───────────────────────────────────────────────────────────
  const act = useCallback(
    async (action: MahjongAction) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await actMahjong(tableId, action);
        apply(response.table);
        setSelected(null);
        setRiichiMode(false);
      } catch (caught) {
        setSelected(null);
        if (apiErrorCode(caught) === "tutorial_step") setError("Not that one. Follow the highlighted move: the lesson only takes that.");
        else setError(gameErrorText(caught));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [apply, tableId],
  );

  const options = seatHand?.options ?? null;
  const myTurn = Boolean(seatHand && options?.phase === "turn" && hand?.turn === mySeat);
  const allowed = useMemo<ReadonlySet<TileId>>(() => {
    if (!options || options.phase !== "turn" || !myTurn) return NO_TILES;
    return new Set(riichiMode ? options.riichi : options.discards);
  }, [myTurn, options, riichiMode]);

  const discardTile = useCallback((id: TileId) => void act({ type: "discard", tile: id, ...(riichiMode ? { riichi: true } : {}) }), [act, riichiMode]);

  // Escape puts it back; D throws what you drew.
  const latest = useRef({ seatHand, allowed, discardTile, sheet });
  useEffect(() => {
    latest.current = { seatHand, allowed, discardTile, sheet };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.key === "Escape") {
        setSelected(null);
        setRiichiMode(false);
      } else if (event.key.toLowerCase() === "d") {
        const { seatHand: view, allowed: set, discardTile: discard } = latest.current;
        if (view?.drawn !== null && view?.drawn !== undefined && set.has(view.drawn)) {
          event.preventDefault();
          discard(view.drawn);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── The three toggles ───────────────────────────────────────────────
  const lesson = Boolean(table?.lesson);
  const autoKey = hand && game && options ? `${game.hand_index}:${hand.seq}:${options.phase}` : null;
  const autoLatest = useRef({ options, seatHand, act, autoWin, noCalls, autoDiscard, busy });
  useEffect(() => {
    autoLatest.current = { options, seatHand, act, autoWin, noCalls, autoDiscard, busy };
  });
  useEffect(() => {
    if (!autoKey || lesson) return;
    const { options: current, seatHand: view } = autoLatest.current;
    if (!current || !view) return;
    let action: MahjongAction | null = null;
    if (current.phase === "turn") {
      if (autoWin && current.tsumo) action = { type: "tsumo" };
      else if (autoDiscard && !current.tsumo && !current.riichi.length && !current.ankan.length && !current.kakan.length && !current.kyuushu && view.drawn !== null && current.discards.includes(view.drawn))
        action = { type: "discard", tile: view.drawn };
    } else if (autoWin && current.ron) action = { type: "ron" };
    else if (noCalls && !current.ron) action = { type: "pass" };
    if (!action) return;
    const chosen = action;
    const timer = window.setTimeout(() => void autoLatest.current.act(chosen), 400);
    return () => window.clearTimeout(timer);
  }, [autoKey, autoWin, noCalls, autoDiscard, lesson]);

  // ── Callouts, from what changed since the last push (a reload shows none) ──
  const previous = useRef<{ key: string; riichi: number[]; melds: string[][]; over: boolean } | null>(null);
  useEffect(() => {
    if (!hand || !game) {
      previous.current = null;
      return;
    }
    const key = `${table?.id}:${game.hand_index}`;
    const now = { key, riichi: hand.seats.map((seat) => seat.riichi), melds: hand.seats.map((seat) => seat.melds.map((meld) => meld.type)), over: hand.phase === "over" };
    const before = previous.current;
    previous.current = now;
    if (!before || before.key !== key) return;
    hand.seats.forEach((_, index) => {
      const seat = index as SeatIndex;
      if (now.riichi[index] > before.riichi[index]) pushCallout(seat, now.riichi[index] === 2 ? "Double riichi" : "Riichi", "riichi");
      const was = before.melds[index];
      const is = now.melds[index];
      if (is.length > was.length) {
        const type = is[is.length - 1];
        pushCallout(seat, type === "chi" ? "Chi" : type === "pon" ? "Pon" : "Kan", "call");
      } else if (is.some((type, at) => type !== was[at])) pushCallout(seat, "Kan", "call");
    });
    if (now.over && !before.over && hand.result?.type === "win") {
      for (const win of hand.result.wins) pushCallout(win.seat, win.tsumo ? "Tsumo" : "Ron", "win");
    }
  }, [game, hand, pushCallout, table?.id]);

  // A short note under the table when the server refuses something goes away on the next move.
  const moveKey = hand ? `${hand.seq}:${hand.phase}` : "";
  const [seenMove, setSeenMove] = useState(moveKey);
  if (seenMove !== moveKey) {
    setSeenMove(moveKey);
    setError(null);
    setSelected(null);
  }

  // ── Poses ───────────────────────────────────────────────────────────
  const standing = table?.status === "done" ? table.result : null;
  const poses = useMemo(() => {
    const out: Record<number, ChibiPose> = {};
    ([0, 1, 2, 3] as SeatIndex[]).forEach((seat) => {
      const line = standingOf(standing, seat);
      out[seat] = stamps[seat] ?? seatPose(seat, hand, line ? { place: line.place } : null);
    });
    return out;
  }, [hand, stamps, standing]);

  // ── Tile marks (help and lesson) ────────────────────────────────────
  const lessonMove = table && seatHand && options && hand?.phase !== "over" ? lessonMoveOf(table) : null;
  const marks = useMemo(() => {
    if (!seatHand || !myTurn) return NO_MARKS;
    const map = new Map<TileId, TileMark>();
    const all = seatHand.drawn !== null ? [...seatHand.hand, seatHand.drawn] : seatHand.hand;
    if (lessonMove) {
      if (lessonMove.type === "discard" && (!lessonMove.riichi || riichiMode)) for (const id of all) if (kindOf(id) === lessonMove.kind) map.set(id, "lesson");
      return map;
    }
    if (!helpOn) return map;
    const best = seatHand.help.coach?.best ?? [];
    for (const id of all) {
      const kind = kindOf(id);
      if (best.includes(kind)) map.set(id, "best");
      else if (seatHand.help.tenpai_discards[String(kind)]) map.set(id, "ready");
    }
    return map;
  }, [helpOn, lessonMove, myTurn, riichiMode, seatHand]);
  const fade = useMemo(() => {
    if (!lessonMove) return undefined;
    return (id: TileId) => (lessonMove.type !== "discard" ? true : lessonMove.riichi && !riichiMode ? false : kindOf(id) !== lessonMove.kind);
  }, [lessonMove, riichiMode]);

  // ── Table-level actions ─────────────────────────────────────────────
  const run = useCallback(async (key: string, task: () => Promise<void>) => {
    setWorking(key);
    setNotice(null);
    try {
      await task();
    } catch (caught) {
      const code = apiErrorCode(caught);
      const tableIdHeld = (caught as { body?: { table_id?: unknown } })?.body?.table_id;
      if (code === "already_seated" && typeof tableIdHeld === "number") {
        router.push(`/games/mahjong/table/${tableIdHeld}`);
        return;
      }
      setNotice(gameErrorText(caught));
    } finally {
      setWorking(null);
    }
  }, [router]);

  const enter = useCallback(
    (response: SeatedResponse) => {
      primeChannel(response.seat.channel, { type: "mahjong", table: response.table, server_time: response.table.server_time });
      router.push(`/games/mahjong/table/${response.table.id}`);
    },
    [router],
  );

  const onSit = () =>
    void run("sit", async () => {
      const response = await sitMahjongTable(tableId);
      take(response.seat, response.table);
    });
  const onStart = () =>
    void run("start", async () => {
      const response = await startMahjongTable(tableId);
      if (isSeatedTable(response.table)) apply(response.table as SeatedTable);
    });
  const onLeave = () =>
    void run("leave", async () => {
      await leaveMahjongTable(tableId);
      forgetSeatToken(tableId);
      router.push("/games/mahjong");
    });
  const onBack = () =>
    void run("back", async () => {
      const response = await backToSeat(tableId);
      apply(response.table);
    });
  const onNext = () =>
    void run("next", async () => {
      const response = await readyForNext(tableId);
      apply(response.table);
    });

  const practiceAgain = () =>
    void run("again", async () => {
      if (!user) enter(await createGuestTable({ level: table?.level === "easy" ? "easy" : "normal" }));
      else enter(await createMahjongTable({ kind: "practice", length: table?.length ?? "east", level: table && table.level !== "auto" ? table.level : "normal", speed: "untimed" }));
    });
  const nextLesson = () =>
    void run("lesson", async () => {
      const info = table?.lesson ? lessonOf(table.lesson.key) : lessonOf("riichi");
      const next = info?.next;
      if (next && "lesson" in next) enter(user ? await createMahjongTable({ kind: "tutorial", lesson: next.lesson }) : await createGuestTable({ lesson: next.lesson }));
      else practiceAgain();
    });

  // The lesson that was playing: the table drops its `lesson` once done, so the key rides along.
  const lessonKey = table?.lesson?.key ?? null;
  const [keptLesson, setKeptLesson] = useState<string | null>(null);
  if (lessonKey && keptLesson !== lessonKey) setKeptLesson(lessonKey);

  // ── Rendering ───────────────────────────────────────────────────────
  const shell = (children: React.ReactNode, title = "Mahjong") => (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <Link href="/games/mahjong" className={styles.back}>
            <FaArrowLeft aria-hidden="true" /> Mahjong
          </Link>
          <h1>{title}</h1>
        </header>
        {children}
      </div>
    </SiteShell>
  );

  if (load.kind === "gone") {
    return shell(
      <div className={styles.message}>
        <p>That table has finished and left the room.</p>
        <div className={panels.overLinks}>
          {load.replay ? (
            <Link href={`/games/mahjong/replay/${load.replay}`} className={panels.next}>
              Watch the replay
            </Link>
          ) : null}
          <Link href="/games/mahjong" className={panels.plain}>
            Back to the lobby
          </Link>
        </div>
        {!load.replay ? <p className={panels.fine}>No record of it was kept: practice games and lessons aren’t saved.</p> : null}
      </div>,
    );
  }
  if (load.kind === "error") {
    return shell(
      <div className={styles.message}>
        <p>{load.message}</p>
        <Link href="/games/mahjong" className={panels.plain}>
          Back to the lobby
        </Link>
      </div>,
    );
  }
  if (!table) return shell(<div className={styles.skeleton} aria-busy="true" />);

  const title = table.tournament ? `${table.tournament.name} · ${table.tournament.round_name}` : (KIND_TITLE[table.kind] ?? "Table");

  if (table.status === "waiting") {
    return shell(
      <WaitingRoom
        table={table}
        seatStyles={seatStyles}
        mySeat={mySeat}
        userId={user ? Number(user.id) : null}
        signedIn={signedIn}
        verified={verified}
        busy={working}
        error={notice}
        onSit={onSit}
        onLeave={onLeave}
        onStart={onStart}
      />,
      title,
    );
  }

  if (table.status === "cancelled" || table.status === "done") {
    const lessonInfo = keptLesson ? lessonOf(keptLesson) : null;
    const win = captured?.result.type === "win" ? captured.result : null;
    return shell(
      lessonInfo && table.status === "done" ? (
        <LessonDone lesson={lessonInfo} result={win} signedIn={signedIn} onNext={nextLesson} busy={working !== null} error={notice} />
      ) : (
        <GameOver table={table} seatStyles={seatStyles} me={mySeat} onAgain={table.kind === "practice" ? practiceAgain : null} againBusy={working === "again"} signedIn={signedIn} />
      ),
      title,
    );
  }

  if (!game || !hand) return shell(<div className={styles.skeleton} aria-busy="true" />, title);

  // ── The live table ──────────────────────────────────────────────────
  const watching = mySeat === null;
  const over = hand.phase === "over" && hand.result;
  const showResult = Boolean(over);
  const asked = seatHand && options ? true : false;
  const lastTile = hand.last_discard?.tile ?? null;
  const turnName = hand.turn !== null ? seatLabel(table.seats[hand.turn]) : null;
  const clockUntil = table.clock?.phase === "between" ? table.clock.until : null;
  const me = seated ? table.me : null;
  const myInfo = hand.seats[bottom];
  const status = (() => {
    if (over) return "Hand over.";
    if (watching) return hand.phase === "calls" ? "Players are deciding on the last discard…" : turnName ? `${turnName}’s turn.` : "";
    if (options?.phase === "calls") return lastTile !== null ? `${seatLabel(table.seats[options.from])} threw ${tileName(lastTile)}. Your move.` : "Your move.";
    if (myTurn) return selected !== null ? `Tap again to throw the ${kindName(kindOf(selected))}.` : riichiMode ? "Pick the tile to throw for riichi." : "Your turn.";
    if (hand.phase === "calls") return "Others are deciding on the last discard…";
    return turnName ? `${turnName}’s turn.` : "";
  })();
  const guide = lessonMove;

  const spectatorBacks = watching ? (
    <div className={styles.watchHand} aria-label={`${myInfo.count} tiles in hand`}>
      {Array.from({ length: myInfo.has_drawn ? myInfo.count - 1 : myInfo.count }, (_, index) => (
        <TileBack key={index} size={phone ? 20 : 30} tint={seatStyles[bottom]?.color} />
      ))}
      {myInfo.has_drawn ? <TileBack size={phone ? 20 : 30} tint={seatStyles[bottom]?.color} style={{ marginLeft: 10 }} /> : null}
    </div>
  ) : null;

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <Link href="/games/mahjong" className={styles.back}>
            <FaArrowLeft aria-hidden="true" /> Mahjong
          </Link>
          <h1>{title}</h1>
          <span className={styles.live} data-on={connected || undefined} title={connected ? "Live" : "Reconnecting…"}>
            <i aria-hidden="true" />
            {table.length === "south" ? "East-South" : "East-only"}
          </span>
          {table.spectators > 0 ? (
            <span className={styles.eye} title="Watching">
              <FaEye aria-hidden="true" /> {table.spectators}
            </span>
          ) : null}
          <span className={styles.headSpace} />
          {seated ? <Toggle on={helpOn} onChange={setHelpOn} title="Hints for beginners">Help</Toggle> : null}
          <button type="button" className={styles.round} onClick={() => setSheet(true)} aria-label="Cheat sheet" title="Cheat sheet">
            ?
          </button>
          {seated && !leaving ? (
            <button type="button" className={styles.leave} onClick={() => setLeaving(true)}>
              Leave
            </button>
          ) : null}
          {seated && leaving ? (
            <span className={styles.confirm}>
              {table.kind === "practice" || table.kind === "tutorial" ? "Close this table?" : table.tournament ? "Leave? Your seat goes on autopilot and the tournament carries on." : "Leave? Autopilot takes over."}
              <button type="button" className={styles.leave} onClick={onLeave} disabled={working === "leave"}>
                Yes
              </button>
              <button type="button" className={styles.leave} onClick={() => setLeaving(false)}>
                No
              </button>
            </span>
          ) : null}
        </header>

        {seated && me?.away ? (
          <p className={styles.banner}>
            <span>You’re on autopilot. Any move puts you back in control.</span>
            <button type="button" className={styles.bannerButton} onClick={onBack} disabled={working === "back"}>
              I’m back
            </button>
          </p>
        ) : null}
        {!connected ? <p className={styles.banner}>Reconnecting… the table is safe; moves wait for the connection.</p> : null}

        <div className={styles.layout}>
          <div className={styles.main}>
            <div className={styles.boardWrap}>
              <Board
                table={table}
                game={game}
                hand={hand}
                bottom={bottom}
                me={mySeat}
                seatStyles={seatStyles}
                poses={poses}
                callouts={callouts}
                mineMelds={(size) => myInfo.melds.map((meld, index) => <PublicMeld key={index} meld={meld} owner={bottom} size={size} labels={false} />)}
                floaters={reactions.on ? <ReactionLayer stage={reactions.stage} /> : null}
              />
            </div>
            <p className={styles.status} aria-live="polite">
              {status}
            </p>
            {spectatorBacks}
            {seatHand ? (
              <>
                {lesson ? <div className={styles.coachInline}><LessonCoach table={table} waiting={!asked || Boolean(over)} /></div> : null}
                <div className={styles.dock}>
                {me && me.deadline && table.speed !== "untimed" && asked && !over ? <MyClock deadline={me.deadline} bank={me.bank} turnMs={me.turn_ms} /> : null}
                <MyHand
                  tiles={seatHand.hand}
                  drawn={seatHand.drawn}
                  allowed={allowed}
                  turn={myTurn}
                  selected={selected}
                  onSelect={setSelected}
                  onDiscard={discardTile}
                  singleTap={singleTap}
                  marks={marks}
                  fade={myTurn ? fade : undefined}
                  label="Your hand"
                />
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <ActionBar
                  options={over ? null : options}
                  waiting={Boolean(over)}
                  busy={busy}
                  riichiMode={riichiMode}
                  onRiichiMode={(on) => {
                    setRiichiMode(on);
                    setSelected(null);
                  }}
                  onAct={(action) => void act(action)}
                  guide={guide}
                />
                </div>
                {helpOn && !lesson && !over ? <ActionHints options={options} /> : null}
                {!lesson ? (
                  <div className={styles.toggles} role="group" aria-label="Table options">
                    <Toggle on={autoWin} onChange={setAutoWin} title="Declare tsumo or ron by itself when you can">
                      Auto-win
                    </Toggle>
                    <Toggle on={noCalls} onChange={setNoCalls} title="Pass every pon, chi and kan. A ron is never passed for you.">
                      No calls
                    </Toggle>
                    <Toggle on={autoDiscard} onChange={setAutoDiscard} title="Throw the tile you draw unless there is something to decide">
                      Auto-discard
                    </Toggle>
                    <Toggle on={singleTap} onChange={setSingleTap} title="One tap throws a tile (no lift first). Stays on.">
                      One-tap throw
                    </Toggle>
                    <small>The first three switch off after every hand.</small>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <aside className={styles.side}>
            {lesson ? (
              <div className={styles.sideCoach} data-desktop>
                <LessonCoach table={table} waiting={!asked || Boolean(over)} />
              </div>
            ) : null}
            {seatHand && helpOn && !over ? <HelpPanel hand={seatHand} selected={selected} myTurn={myTurn} inRiichi={Boolean(seatHand && hand.seats[seatHand.seat].riichi)} /> : null}
            {watching ? <SpectatorStrip table={table} seatStyles={seatStyles} bottom={bottom} signedIn={signedIn} verified={verified} myPick={myPick} onPick={setMyPick} /> : null}
            <ReactionBar
              stage={reactions.stage}
              on={reactions.on}
              setOn={reactions.setOn}
              canSend={Boolean(user?.email_verified && !user.suspension)}
              connected={connected}
              table={table}
              mySeat={mySeat}
              bottom={bottom}
              seatStyles={seatStyles}
            />
          </aside>
        </div>

        {showResult && captured && hand.result ? (
          <ResultPanel
            result={hand.result}
            table={table}
            seatStyles={seatStyles}
            label={game.label}
            dora={hand.dora}
            me={mySeat}
            until={clockUntil}
            ready={Boolean(me?.ready)}
            busy={working === "next"}
            lesson={lesson}
            onNext={onNext}
            collapsed={collapsed}
            onCollapse={setCollapsed}
          />
        ) : null}
        {sheet ? <CheatSheet onClose={() => setSheet(false)} /> : null}
      </div>
    </SiteShell>
  );
}

