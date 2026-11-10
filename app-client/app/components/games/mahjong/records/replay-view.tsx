"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { FiChevronLeft, FiChevronRight, FiChevronsRight, FiPause, FiPlay, FiSkipBack } from "react-icons/fi";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { Tile, TileMeld } from "@/app/components/games/mahjong/tile";
import { meldRow, PlayerLink, signedPoints } from "@/app/components/games/mahjong/records/record-parts";
import { MahjongShareButton } from "@/app/components/games/mahjong/share/share-button";
import { replayCardPath, replayPath } from "@/app/components/games/mahjong/share/share-links";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchMahjongGame } from "@/app/lib/games/mahjong/api";
import { eventSeat, eventText, handLabel, handStartSticks, outcomeOf, replaySteps, stateAt, winLimit, type ReplayState } from "@/app/lib/games/mahjong/replay";
import { tileName, windLetter, type TileId } from "@/app/lib/games/mahjong/tiles";
import type { GamePlayer, GameRecord, HandResult, RecordedHand, WinEntry } from "@/app/lib/games/mahjong/types";
import { verifyGame, type WallCheck } from "@/app/lib/games/mahjong/wall-verify";
import { DRAW_REASONS, fuPartText, yakuName, scoreText } from "@/app/lib/games/mahjong/yaku";
import { talentAccent } from "@/app/lib/talent-color";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/records/records.module.scss";

const SPEEDS = [
  { key: "slow", label: "0.5×", ms: 1600 },
  { key: "normal", label: "1×", ms: 800 },
  { key: "fast", label: "2×", ms: 380 },
  { key: "faster", label: "4×", ms: 160 },
] as const;

const KIND_WORDS: Record<string, string> = { ranked: "Quick match", stakes: "Stakes table", friend: "Friend room", tournament: "Tournament", practice: "Practice", tutorial: "Tutorial" };

function subscribeNarrow(notify: () => void) {
  const query = window.matchMedia("(max-width: 720px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
/** Tile widths that fit the viewport: smaller on a phone. */
function useTileSizes() {
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 720px)").matches, () => false);
  return narrow ? { hand: 22, pond: 17, dora: 22, small: 20 } : { hand: 30, pond: 22, dora: 26, small: 24 };
}

export function ReplayView({ id, initialHand }: { id: number; initialHand: number | null }) {
  const { user, initialized } = useAuth();
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchMahjongGame(id)
        .then((response) => !cancelled && (setRecord(response), setError(null)))
        .catch((failure) => !cancelled && setError(gameErrorText(failure)));
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A game in play: look again now and then for new hands, until the record opens.
  const playing = record?.game.status === "playing";
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      fetchMahjongGame(id)
        .then((response) => !cancelled && setRecord(response))
        .catch(() => {});
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, playing]);

  const title = record?.game.tournament_name ? record.game.tournament_name : record ? (KIND_WORDS[record.game.kind] ?? "Game") : "Replay";

  return (
    <GamesFrame
      kicker={`Mahjong · replay #${id}`}
      title={title}
      blurb={
        record ? (
          <>
            {record.game.length === "south" ? "East-South" : "East-only"} · <b>{record.hands.length}</b> {record.hands.length === 1 ? "hand" : "hands"}
            {record.game.status === "completed" ? " · every hand face up" : " · in play"}
          </>
        ) : undefined
      }
      aside={
        <nav className={styles.links} aria-label="Mahjong pages">
          <Link href="/games/mahjong/ladder">Ladder</Link>
          <Link href="/games/mahjong/ladder#highlights">More replays</Link>
          {record ? <Link href={`/games/mahjong/table/${id}`}>Table</Link> : null}
        </nav>
      }
    >
      <div className={styles.page}>
        {error ? <p className={styles.error}>{error === "table not found" || error === "Something went wrong. Try again." ? "No game with that number." : error}</p> : null}
        {!record && !error ? <p className={styles.note}>Loading the replay…</p> : null}
        {record ? <ReplayBody key={id} record={record} initialHand={initialHand} /> : null}
        {record && initialized && !user ? (
          <p className={styles.nudge}>
            Watching is free. <Link href="/register">Make an account</Link> to sit at a table of your own, on play money, against bots or friends.
          </p>
        ) : null}
      </div>
    </GamesFrame>
  );
}

function ReplayBody({ record, initialHand }: { record: GameRecord; initialHand: number | null }) {
  const complete = record.game.status === "completed";
  const names = useMemo(() => [0, 1, 2, 3].map((seat) => record.players.find((player) => player.seat === seat)?.username ?? `Seat ${seat + 1}`), [record.players]);
  const startSticks = useMemo(() => handStartSticks(record.hands), [record.hands]);
  const firstIndex = Math.max(0, record.hands.findIndex((hand) => hand.index === initialHand));
  const [handPos, setHandPos] = useState(firstIndex);
  // A link to a hand opens on its result; picking another hand starts at its deal.
  const [deepLinked, setDeepLinked] = useState(initialHand !== null);
  const hand = record.hands[handPos] ?? null;

  const pickHand = useCallback(
    (pos: number) => {
      setHandPos(pos);
      setDeepLinked(false);
      const target = record.hands[pos];
      if (target) {
        const url = new URL(window.location.href);
        url.searchParams.set("hand", String(target.index));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    },
    [record.hands],
  );

  return (
    <>
      {complete && record.result ? <Standings record={record} /> : null}
      {!complete ? (
        <section className={styles.section}>
          <h2 className={styles.head}>Results so far</h2>
          <p className={styles.lede}>This game is still in play. The full replay, every move with all four hands face up, opens when it ends. These are the hands finished so far.</p>
          <HandList record={record} names={names} current={-1} onPick={() => {}} plain />
        </section>
      ) : null}
      {complete && hand ? (
        <section className={styles.replay} aria-label="Replay">
          <HandList record={record} names={names} current={handPos} onPick={pickHand} />
          <HandStage key={hand.index} record={record} hand={hand} sticks={startSticks[handPos] ?? 0} names={names} startAtEnd={deepLinked} hasNext={handPos + 1 < record.hands.length} onNext={() => pickHand(handPos + 1)} />
        </section>
      ) : null}
      {complete ? <WallCheckPanel record={record} /> : null}
    </>
  );
}

// ── Hand list ───────────────────────────────────────────────────────────────
function handSummary(hand: RecordedHand, names: string[]) {
  const outcome = outcomeOf(hand.result);
  if (hand.result.type === "draw") return `Draw · ${DRAW_REASONS[hand.result.reason]?.name ?? ""}`;
  const win = hand.result.wins[0];
  const more = hand.result.wins.length > 1 ? ` +${hand.result.wins.length - 1}` : "";
  return `${outcome.label} · ${names[win.seat]}${more} · ${winLimit(win) ?? `${win.han} han`} ${signedPoints(outcome.points)}`;
}

function HandList({ record, names, current, onPick, plain }: { record: GameRecord; names: string[]; current: number; onPick: (pos: number) => void; plain?: boolean }) {
  return (
    <ol className={styles.handList} aria-label="Hands">
      {record.hands.map((hand, pos) => (
        <li key={hand.index}>
          <button type="button" aria-current={pos === current || undefined} onClick={() => onPick(pos)} disabled={plain}>
            <b>
              {handLabel(hand)}
              {hand.honba ? ` · ${hand.honba} honba` : ""}
            </b>
            <small>{handSummary(hand, names)}</small>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ── One hand: the table, the controls and the result ────────────────────────
function HandStage({ record, hand, sticks, names, startAtEnd, hasNext, onNext }: { record: GameRecord; hand: RecordedHand; sticks: number; names: string[]; startAtEnd: boolean; hasNext: boolean; onNext: () => void }) {
  const log = useMemo(() => hand.log ?? [], [hand.log]);
  const steps = useMemo(() => replaySteps(log), [log]);
  const last = Math.max(0, steps.length - 1);
  const [step, setStep] = useState(startAtEnd ? last : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["key"]>("normal");
  const sizes = useTileSizes();

  const count = steps[Math.min(step, last)] ?? 0;
  const state = useMemo(() => stateAt(hand, log, count, sticks), [hand, log, count, sticks]);
  const atEnd = step >= last;

  useEffect(() => {
    if (!playing) return;
    if (atEnd) {
      // Reaching the end of the hand stops playback; nothing to set during render.
      const stop = window.setTimeout(() => setPlaying(false), 0);
      return () => window.clearTimeout(stop);
    }
    const ms = SPEEDS.find((entry) => entry.key === speed)?.ms ?? 800;
    const timer = window.setTimeout(() => setStep((current) => Math.min(last, current + 1)), ms);
    return () => window.clearTimeout(timer);
  }, [playing, atEnd, step, speed, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "ArrowRight") setStep((current) => Math.min(last, current + 1));
      else if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const line = state.last ? eventText(state.last, names, tileName) : "";
  const winners = state.over && state.result?.type === "win" ? state.result.wins.map((win) => win.seat) : [];

  return (
    <div className={styles.stage}>
      <div className={styles.centerBox}>
        <span className={styles.roundName}>
          {handLabel(hand)}
          {state.honba ? <small className={styles.dim}> · {state.honba} honba</small> : null}
        </span>
        <span className={styles.centerFact}>
          Tiles left <b>{state.remaining}</b>
        </span>
        <span className={styles.centerFact}>
          Riichi sticks <b>{state.sticks}</b>
        </span>
        <span className={styles.doraRow}>
          <span className={styles.centerFact}>Dora</span>
          {state.dora.map((tile, index) => (
            <Tile key={index} id={tile} size={sizes.dora} />
          ))}
        </span>
      </div>

      <div className={styles.seats}>
        {state.seats.map((seat) => (
          <SeatBlock key={seat.seat} state={state} seat={seat.seat} player={record.players.find((player) => player.seat === seat.seat)} name={names[seat.seat]} sizes={sizes} won={winners.includes(seat.seat)} />
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.buttons} role="group" aria-label="Replay controls">
          <button type="button" onClick={() => (setPlaying(false), setStep(0))} aria-label="Back to the deal" title="Back to the deal">
            <FiSkipBack aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step <= 0} aria-label="Step back" title="Step back (left arrow)">
            <FiChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            data-primary
            onClick={() => {
              if (atEnd) setStep(0);
              setPlaying((current) => !current);
            }}
            aria-label={playing ? "Pause" : atEnd ? "Play again" : "Play"}
          >
            {playing ? <FiPause aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
            {playing ? "Pause" : atEnd ? "Replay" : "Play"}
          </button>
          <button type="button" onClick={() => setStep((current) => Math.min(last, current + 1))} disabled={atEnd} aria-label="Step forward" title="Step forward (right arrow)">
            <FiChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setStep(last);
            }}
            disabled={atEnd}
            aria-label="Jump to the end of the hand"
            title="Jump to the end of the hand"
          >
            <FiChevronsRight aria-hidden="true" />
          </button>
          <div className={styles.speed} role="group" aria-label="Speed">
            {SPEEDS.map((entry) => (
              <button key={entry.key} type="button" aria-pressed={speed === entry.key} onClick={() => setSpeed(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={last}
          value={Math.min(step, last)}
          onChange={(event) => (setPlaying(false), setStep(Number(event.target.value)))}
          aria-label="Position in the hand"
        />
        <p className={styles.eventLine} aria-live="polite">
          {line}
        </p>
        <span className={styles.stepCount}>
          Move {Math.min(step, last) + 1} of {last + 1}
        </span>
      </div>

      <ResultPanel record={record} hand={hand} names={names} sizes={sizes} reached={atEnd} onNext={hasNext ? onNext : null} onShowResult={() => (setPlaying(false), setStep(last))} />
    </div>
  );
}

function SeatBlock({ state, seat, player, name, sizes, won }: { state: ReplayState; seat: number; player: GamePlayer | undefined; name: string; sizes: { hand: number; pond: number }; won: boolean }) {
  const view = state.seats[seat];
  const active = state.turn === seat || state.lastDiscard?.seat === seat || (state.last ? eventSeat(state.last) === seat : false);
  const style = { "--tal": talentAccent(player?.profile_color) } as CSSProperties;
  return (
    <section className={styles.seat} style={style} data-active={active || undefined} data-won={won || undefined} aria-label={`${name}, ${windLetter(view.wind)} seat`}>
      <div className={styles.seatHead}>
        <span className={styles.seatWind} data-dealer={seat === state.dealer || undefined} title={seat === state.dealer ? "Dealer" : undefined}>
          {windLetter(view.wind)}
        </span>
        <span className={styles.seatName}>{name}</span>
        {view.riichi ? <span className={styles.riichiTag}>{view.riichi === 2 ? "Double riichi" : "Riichi"}</span> : null}
        <span className={styles.seatScore}>{state.scores[seat].toLocaleString("en-US")}</span>
      </div>
      <div className={styles.tilesRow}>
        <span className={styles.runTiles}>
          {view.hand.map((tile, index) => (
            <Tile key={`${tile}-${index}`} id={tile} size={sizes.hand} />
          ))}
        </span>
        {view.drawn !== null ? (
          <span className={styles.drawnTile}>
            <Tile id={view.drawn} size={sizes.hand} highlight />
          </span>
        ) : null}
        {view.melds.map((meld, index) => (
          <TileMeld key={index} {...meldRow(meld)} size={Math.round(sizes.hand * 0.85)} />
        ))}
      </div>
      <div className={styles.pond} aria-label="Discards">
        {view.pond.map((entry) => (
          <Tile key={entry.n} id={entry.tile} size={sizes.pond} rotated={entry.riichi} dim={entry.called} highlight={state.lastDiscard?.n === entry.n} labels={false} />
        ))}
      </div>
    </section>
  );
}

// ── Result panel ────────────────────────────────────────────────────────────
function ResultPanel({ record, hand, names, sizes, reached, onNext, onShowResult }: { record: GameRecord; hand: RecordedHand; names: string[]; sizes: { small: number; dora: number }; reached: boolean; onNext: (() => void) | null; onShowResult: () => void }) {
  const result: HandResult = hand.result;
  const outcome = outcomeOf(result);
  return (
    <section className={styles.result} aria-label="Result of this hand">
      <div className={styles.resultTitle}>
        <h3>{result.type === "draw" ? (DRAW_REASONS[result.reason]?.name ?? "Draw") : outcome.kind === "tsumo" ? "Self-draw win" : "Win on a discard"}</h3>
        <span className={styles.dim}>
          {handLabel(hand)}
          {hand.honba ? ` · ${hand.honba} honba` : ""}
        </span>
        {!reached ? (
          <button type="button" className={styles.secondary} onClick={onShowResult}>
            Jump to the result
          </button>
        ) : null}
        {onNext ? (
          <button type="button" className={styles.secondary} onClick={onNext}>
            Next hand
          </button>
        ) : null}
      </div>

      {result.type === "win" ? (
        <>
          {result.wins.map((win) => (
            <WinBlock key={win.seat} win={win} record={record} hand={hand} names={names} size={sizes.small} />
          ))}
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
            <span className={styles.centerFact}>Dora</span>
            {result.dora.map((tile, index) => (
              <Tile key={index} id={tile} size={sizes.dora} />
            ))}
            {result.ura.length ? <span className={styles.centerFact}>Ura</span> : null}
            {result.ura.map((tile, index) => (
              <Tile key={`u${index}`} id={tile} size={sizes.dora} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className={styles.lede}>{DRAW_REASONS[result.reason]?.text}</p>
          {Object.keys(result.hands).length ? (
            <div className={styles.shownHands}>
              {Object.entries(result.hands).map(([seat, tiles]) => (
                <div key={seat}>
                  <span className={styles.centerFact}>{names[Number(seat)]} shows </span>
                  <span className={styles.runTiles}>
                    {tiles.map((tile, index) => (
                      <Tile key={index} id={tile} size={sizes.small} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      <dl className={styles.deltas}>
        {[0, 1, 2, 3].map((seat) => {
          const delta = result.deltas[seat];
          return (
            <div key={seat}>
              <dt>{names[seat]}</dt>
              <dd data-up={delta > 0 || undefined} data-down={delta < 0 || undefined}>
                {signedPoints(delta)}
                <small>{result.scores[seat].toLocaleString("en-US")} after</small>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function WinBlock({ win, record, hand, names, size }: { win: WinEntry; record: GameRecord; hand: RecordedHand; names: string[]; size: number }) {
  const player = record.players.find((entry) => entry.seat === win.seat);
  const style = { "--tal": talentAccent(player?.profile_color) } as CSSProperties;
  const limit = winLimit(win);
  return (
    <div className={styles.win} style={style}>
      <div className={styles.winHead}>
        <PlayerLink name={names[win.seat]} color={player?.profile_color} bot={Boolean(player?.bot)} />
        <span className={styles.dim}>{win.tsumo ? "self-draw" : `on ${names[win.from ?? 0]}’s discard${win.chankan ? " (robbed a kan)" : ""}`}</span>
        <strong className={styles.limit} data-yakuman={win.yakuman > 0 || undefined}>
          {win.yakuman > 0 ? scoreText(win) : (limit ?? `${win.han} han ${win.fu} fu`)}
        </strong>
        <span className={styles.gain}>+{win.gain.toLocaleString("en-US")}</span>
        <MahjongShareButton
          className={styles.secondary}
          title="Share this hand"
          text={`${names[win.seat]}: ${scoreText(win)} on NASFAQ mahjong`}
          cardPath={replayCardPath(record.game.id, hand.index)}
          linkFor={(code) => replayPath(record.game.id, hand.index, code)}
        />
      </div>
      <span className={styles.hand}>
        <span className={styles.handRun}>
          {win.hand.map((tile: TileId, index: number) => (
            <Tile key={index} id={tile} size={size} />
          ))}
        </span>
        <span className={styles.handWin}>
          <Tile id={win.tile} size={size} highlight />
        </span>
        {win.melds.map((meld, index) => (
          <TileMeld key={index} {...meldRow(meld)} size={size} />
        ))}
      </span>
      <ul className={styles.yakuList}>
        {win.yaku.map((line) => (
          <li key={line.key}>
            {yakuName(line.key)}
            <b>{line.han >= 13 ? "yakuman" : `${line.han} han`}</b>
          </li>
        ))}
        {win.dora.dora ? (
          <li>
            Dora<b>{win.dora.dora}</b>
          </li>
        ) : null}
        {win.dora.ura ? (
          <li>
            Ura dora<b>{win.dora.ura}</b>
          </li>
        ) : null}
        {win.dora.red ? (
          <li>
            Red fives<b>{win.dora.red}</b>
          </li>
        ) : null}
      </ul>
      {win.yakuman === 0 ? (
        <ul className={styles.fuList} aria-label="Fu">
          {win.fu_parts.map((part, index) => (
            <li key={index}>
              {fuPartText(part, (kind) => tileName(kind * 4))}
              <b>{part.fu}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {win.honba || win.sticks || win.pao !== null ? (
        <p className={styles.note}>
          {win.honba ? `${win.honba.toLocaleString("en-US")} from honba. ` : ""}
          {win.sticks ? `${win.sticks.toLocaleString("en-US")} from riichi sticks. ` : ""}
          {win.pao !== null ? `${names[win.pao]} is responsible for this yakuman and pays for it. ` : ""}
        </p>
      ) : null}
    </div>
  );
}

// ── Final standings ─────────────────────────────────────────────────────────
function Standings({ record }: { record: GameRecord }) {
  const lines = record.result?.lines ?? [];
  const rows = [...lines].sort((a, b) => a.place - b.place);
  const paid = record.game.entry_fee > 0 && rows.some((row) => row.payout > 0);
  return (
    <section className={styles.section}>
      <h2 className={styles.head}>Final standings</h2>
      <div className={styles.tableWrap}>
        <table className={styles.standings}>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Points</th>
              <th>Score</th>
              <th className={styles.hideSmall}>Rating</th>
              {paid ? <th>Prize</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const player = record.players.find((entry) => entry.seat === row.seat);
              const change = row.rating_before !== null && row.rating_after !== null ? Math.round(row.rating_after - row.rating_before) : null;
              return (
                <tr key={row.seat}>
                  <td>{row.place}</td>
                  <td>
                    <PlayerLink name={player?.username ?? `Seat ${row.seat + 1}`} color={player?.profile_color} bot={Boolean(player?.bot)} />
                  </td>
                  <td>{row.points.toLocaleString("en-US")}</td>
                  <td className={row.score >= 0 ? styles.up : styles.down}>{`${row.score >= 0 ? "+" : "−"}${Math.abs(row.score).toFixed(1)}`}</td>
                  <td className={styles.hideSmall}>
                    {row.rating_after !== null ? Math.round(row.rating_after) : "n/a"}
                    {change !== null && change !== 0 ? <span className={change > 0 ? styles.up : styles.down}> {change > 0 ? "+" : "−"}{Math.abs(change)}</span> : null}
                  </td>
                  {paid ? <td>{row.payout > 0 ? `$${row.payout.toLocaleString("en-US")}` : "none"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.note} style={{ marginTop: "0.6rem" }}>
        Score is (points − 30,000) ÷ 1,000 plus the placement bonus. {record.game.rated ? "This game was rated." : "This game was not rated."}
      </p>
      <div className={styles.actions} style={{ marginTop: "0.6rem" }}>
        <MahjongShareButton
          className={styles.secondary}
          title="Share this game"
          text="A finished mahjong game on NASFAQ"
          cardPath={replayCardPath(record.game.id)}
          linkFor={(code) => replayPath(record.game.id, null, code)}
        />
      </div>
    </section>
  );
}

// ── Verify the wall ─────────────────────────────────────────────────────────
function WallCheckPanel({ record }: { record: GameRecord }) {
  const [check, setCheck] = useState<WallCheck | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    verifyGame(record)
      .then((result) => !cancelled && setCheck(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [record]);
  const state = failed ? "bad" : !check ? "wait" : check.ok ? "ok" : "bad";
  const handCount = check?.hands.length ?? 0;
  return (
    <section className={styles.section} aria-label="Verify the wall">
      <h2 className={styles.head}>Verify the wall</h2>
      <div className={styles.wall}>
        <p className={styles.wallStatus} data-state={state} aria-live="polite">
          {state === "wait" ? "Checking in your browser…" : null}
          {state === "ok" ? `Passed: the seed matches its published hash, and all ${handCount} ${handCount === 1 ? "hand" : "hands"} reproduce from it.` : null}
          {state === "bad" ? (failed ? "Your browser couldn’t run the check." : !check?.seedOk ? "Failed: the seed does not match the published hash." : "Failed: a hand does not match the wall the seed gives.") : null}
        </p>
        <p className={styles.lede} style={{ margin: 0 }}>
          Before the first tile was dealt, the table published a fingerprint (a SHA-256 hash) of a secret seed. The seed is shown below now that the game is over. Your browser just hashed it and got the same fingerprint,
          so the seed wasn’t changed along the way. It then shuffled the 136 tiles for every hand with the published recipe and checked that each deal, each draw and each dora indicator in the log are the tiles that
          shuffle gives. The server couldn’t have picked a wall to suit anyone after seeing the cards.
        </p>
        {check?.hands.some((entry) => !entry.ok) ? (
          <ul className={styles.fuList}>
            {check.hands
              .filter((entry) => !entry.ok)
              .map((entry) => (
                <li key={entry.index}>
                  Hand {entry.index + 1}: {entry.problems[0]}
                </li>
              ))}
          </ul>
        ) : null}
        <dl className={styles.hashes}>
          <div>
            <dt>Published hash</dt>
            <dd>{record.game.seed_hash}</dd>
          </div>
          <div>
            <dt>Hash of the seed, worked out here</dt>
            <dd>{check?.computedHash || "…"}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{record.game.seed ?? "published when the game ends"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

