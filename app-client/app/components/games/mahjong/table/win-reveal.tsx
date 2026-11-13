"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useElementWidth } from "@/app/components/games/mahjong/table/board";
import { winLines } from "@/app/components/games/mahjong/table/result-panel";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { PublicMeld, Tile } from "@/app/components/games/mahjong/tile";
import { playCue } from "@/app/lib/games/mahjong/sound";
import { points, seatLabel, signed, winWord } from "@/app/lib/games/mahjong/table-model";
import type { DrawResult, MahjongTable, SeatIndex, WinEntry, WinResult } from "@/app/lib/games/mahjong/types";
import { DRAW_REASONS, scoreText } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/win-reveal.module.scss";

// The short sequence after a hand ends. A win: the winning tile lands, the hand opens, each yaku line
// appears with its han, the dora flip, the han/fu and points count up, then every seat's score moves.
// About four seconds, skippable by click, tap, Enter, Space or Escape. A draw: a plain announcement.
// Under reduced motion or calm mode the page never mounts this and goes straight to the result.

const LEAD_MS = 600; // the Ron / Tsumo callout gets the board to itself first
const BUDGET_MS = 4300;
const DRAW_MS = 1400;

type Plan = {
  win: WinEntry;
  lines: { label: string; han: string }[];
  start: number;
  gap: number;
  lineAt: number;
  doraAt: number;
  pointsAt: number;
  pointsDur: number;
  scoresAt: number | null;
  end: number;
};

const OPEN_AT = 350;
const SCORES_DUR = 650;

function buildPlans(wins: WinEntry[]): Plan[] {
  let start = 0;
  return wins.map((win, index) => {
    const lines = winLines(win);
    const gap = Math.min(360, 1500 / Math.max(lines.length, 1));
    const lineAt = 650;
    const doraAt = lineAt + lines.length * gap + 100;
    const pointsAt = doraAt + 450;
    const pointsDur = 650;
    const last = index === wins.length - 1;
    const scoresAt = last ? pointsAt + pointsDur + 150 : null;
    const end = start + (scoresAt !== null ? scoresAt + SCORES_DUR + 550 : pointsAt + pointsDur + 450);
    const plan: Plan = { win, lines, start, gap, lineAt, doraAt, pointsAt, pointsDur, scoresAt, end };
    start = end;
    return plan;
  });
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;

/** The winning hand: face down until it "opens", the winning tile set apart and landing on its own. */
const RevealHand = memo(function RevealHand({ win, open }: { win: WinEntry; open: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const meldTiles = win.melds.reduce((sum, meld) => sum + meld.tiles.length, 0);
  const units = win.hand.length + 1 + meldTiles + 1.5;
  const size = width ? Math.max(15, Math.min(34, Math.floor((width - 4 * (win.melds.length + 2)) / units))) : 22;
  return (
    <div ref={ref} className={styles.hand}>
      <span className={styles.tiles}>
        {win.hand.map((id, index) => (
          <span key={id} className={open ? styles.opened : undefined} style={{ "--d": `${index * 18}ms` } as CSSProperties}>
            <Tile id={id} size={size} faceDown={!open} labels={false} />
          </span>
        ))}
      </span>
      <span className={styles.land}>
        <Tile id={win.tile} size={size} highlight labels={false} />
      </span>
      {win.melds.map((meld, index) => (
        <span key={index} className={styles.meld}>
          <PublicMeld meld={meld} owner={win.seat} size={size} labels={false} />
        </span>
      ))}
    </div>
  );
});

type RevealProps = {
  result: WinResult;
  table: MahjongTable;
  seatStyles: SeatStyle[];
  label: string;
  /** The score line at the start of the hand's end (each seat before the points moved). */
  onBeat: () => void;
  onDone: () => void;
};

function WinSequence({ result, table, seatStyles, label, onBeat, onDone }: RevealProps) {
  const plans = useMemo(() => buildPlans(result.wins), [result.wins]);
  const raw = plans[plans.length - 1].end;
  const k = Math.min(1, BUDGET_MS / raw);
  const [time, setTime] = useState(0);
  const latest = useRef({ onBeat, onDone });
  useEffect(() => {
    latest.current = { onBeat, onDone };
  });

  useEffect(() => {
    const begin = performance.now();
    let frame = 0;
    const loop = () => {
      const elapsed = performance.now() - begin;
      setTime(elapsed);
      if (elapsed >= raw * k) latest.current.onDone();
      else frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [raw, k]);

  const rt = time / k;
  const found = plans.findIndex((plan) => rt < plan.end);
  const index = found < 0 ? plans.length - 1 : found;
  const plan = plans[index];
  const win = plan.win;
  const local = rt - plan.start;
  const open = local >= OPEN_AT;
  const count = local < plan.lineAt ? 0 : Math.min(plan.lines.length, Math.floor((local - plan.lineAt) / plan.gap) + 1);
  const doraOpen = local >= plan.doraAt;
  const pointsProgress = clamp01((local - plan.pointsAt) / plan.pointsDur);
  const shownPoints = Math.round(win.gain * easeOut(pointsProgress));
  const scoreProgress = plan.scoresAt === null ? 0 : clamp01((local - plan.scoresAt) / SCORES_DUR);
  const big = win.yakuman > 0 || win.limit !== null;

  // Sounds ride the same clock.
  useEffect(() => {
    if (count > 0) playCue("yaku_tick", { pitch: 1 + 0.06 * (count - 1) });
  }, [count, index]);
  useEffect(() => {
    if (open) playCue("draw");
  }, [open, index]);
  useEffect(() => {
    if (doraOpen) playCue("draw", { pitch: 1.3 });
  }, [doraOpen, index]);
  const pointTick = pointsProgress > 0 && pointsProgress < 1 ? Math.floor(pointsProgress * 9) + 1 : 0;
  useEffect(() => {
    if (pointTick > 0) playCue("points_tick", { pitch: 1 + pointTick * 0.05 });
  }, [pointTick]);
  const pointsDone = pointsProgress >= 1;
  useEffect(() => {
    if (!pointsDone) return;
    playCue(win.yakuman > 0 ? "yakuman" : win.limit !== null ? "win_big" : "win_small");
    latest.current.onBeat();
  }, [pointsDone, index, win.yakuman, win.limit]);
  const scoreTick = scoreProgress > 0 && scoreProgress < 1 ? Math.floor(scoreProgress * 4) + 1 : 0;
  useEffect(() => {
    if (scoreTick > 0) playCue("points_tick", { pitch: 0.8 + scoreTick * 0.08 });
  }, [scoreTick]);

  const name = (seat: SeatIndex | null) => (seat === null ? "" : seatLabel(table.seats[seat]));
  const indicators = [...result.dora, ...(win.riichi ? result.ura : [])];
  return (
    <div className={styles.card} key={index} style={{ "--tal": seatStyles[win.seat]?.color } as CSSProperties} data-big={big || undefined}>
      <header className={styles.head}>
        <small>{label}</small>
        <h3>
          <span>{winWord(win)}</span> {name(win.seat)}
          {win.from !== null ? <small> off {name(win.from)}</small> : null}
        </h3>
      </header>
      <RevealHand win={win} open={open} />
      <div className={styles.cols}>
        <ul className={styles.lines} data-many={plan.lines.length > 4 || undefined} aria-hidden="true">
          {plan.lines.map((line, at) => (
            <li key={at} data-on={at < count || undefined}>
              <span>{line.label}</span>
              <b>{line.han}</b>
            </li>
          ))}
        </ul>
        <div className={styles.dora} aria-hidden="true">
          {indicators.map((id, at) => (
            <span key={at} className={doraOpen ? styles.opened : undefined} style={{ "--d": `${at * 70}ms` } as CSSProperties}>
              <Tile id={id} size={20} faceDown={!doraOpen} labels={false} />
            </span>
          ))}
        </div>
      </div>
      <div className={styles.points} data-on={local >= plan.pointsAt || undefined} aria-hidden="true">
        <small>{scoreText(win)}</small>
        <b>{points(shownPoints)}</b>
      </div>
      {plan.scoresAt !== null ? (
        <ol className={styles.scores} data-on={local >= plan.scoresAt || undefined} aria-hidden="true">
          {([0, 1, 2, 3] as SeatIndex[]).map((seat) => {
            const delta = result.deltas[seat];
            const start = result.scores[seat] - delta;
            return (
              <li key={seat} style={{ "--tal": seatStyles[seat]?.color } as CSSProperties}>
                <i />
                <span>{name(seat)}</span>
                <em>{points(Math.round(start + delta * easeOut(scoreProgress)))}</em>
                <b data-dir={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>{scoreProgress > 0 ? signed(delta) : ""}</b>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function DrawNote({ result, label, onBeat, onDone }: { result: DrawResult; label: string; onBeat: () => void; onDone: () => void }) {
  const latest = useRef({ onBeat, onDone });
  useEffect(() => {
    latest.current = { onBeat, onDone };
  });
  useEffect(() => {
    latest.current.onBeat();
    const timer = window.setTimeout(() => latest.current.onDone(), DRAW_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const reason = DRAW_REASONS[result.reason];
  return (
    <div className={styles.card} data-draw>
      <header className={styles.head}>
        <small>{label}</small>
        <h3>{reason.name}</h3>
      </header>
      <p className={styles.note}>{reason.text}</p>
    </div>
  );
}

/** Over the board while a finished hand plays out. Click, tap, Enter, Space or Escape skips to the result. */
export function HandReveal(props: Omit<RevealProps, "result"> & { result: WinResult | DrawResult }) {
  const { result, onDone } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDone();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), LEAD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!ready) return null;
  return (
    <div className={styles.reveal} onClick={onDone} role="presentation">
      {result.type === "win" ? <WinSequence {...props} result={result} /> : <DrawNote result={result} label={props.label} onBeat={props.onBeat} onDone={onDone} />}
      <button type="button" className={styles.skip} onClick={onDone}>
        Skip
      </button>
    </div>
  );
}
