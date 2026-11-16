"use client";

import { useEffect, useId, useState } from "react";
import { Tile } from "@/app/components/games/mahjong/tile";
import {
  METER_STEPS,
  blockedText,
  discardText,
  FORM_TEXT,
  meterHeadline,
  meterIndex,
  meterShort,
  previewScore,
  sightLabel,
  suggestionText,
  type Who,
} from "@/app/lib/games/mahjong/coach-texts";
import { playCue } from "@/app/lib/games/mahjong/sound";
import { kindName, kindOf, type TileId, type TileKind } from "@/app/lib/games/mahjong/tiles";
import type { Coach, CoachRow, SeatHand, WinPreview } from "@/app/lib/games/mahjong/types";
import { yakuInfo, yakuValueText } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/coach.module.scss";

type WaitRow = { kind: TileKind; left: number; ron: WinPreview | null; tsumo: WinPreview | null };

/** The tiles in your hand that are certainly safe against every riichi at the table. */
export function safeTiles(hand: SeatHand): Set<TileId> {
  const coach = hand.help.coach;
  const out = new Set<TileId>();
  const seats = coach?.riichi_seats ?? [];
  if (!coach?.improvers || !seats.length) return out;
  const safeKinds = new Set(coach.improvers.filter((row) => seats.every((seat) => row.safe_against.includes(seat))).map((row) => row.kind));
  for (const id of hand.drawn !== null ? [...hand.hand, hand.drawn] : hand.hand) if (safeKinds.has(kindOf(id))) out.add(id);
  return out;
}

/** One line for the phone's strip: "2 from ready · throw 9p · why?". */
export function stripText(coach: Coach): string {
  const parts = [meterShort(coach.shanten)];
  const pick = coach.suggestion;
  if (pick?.action === "discard") parts.push(`throw ${kindName(pick.kind)}`);
  else if (pick?.action === "tsumo") parts.push("win now");
  return parts.join(" · ");
}

/** What a screen reader hears: only the headline and the pick, so a push that changes nothing says nothing. */
export function spokenText(coach: Coach): string {
  const pick = coach.suggestion;
  const tail = pick?.action === "discard" ? ` The coach suggests throwing ${kindName(pick.kind)}${pick.riichi ? " and calling riichi" : ""}.` : pick?.action === "tsumo" ? " The coach says to win now." : "";
  return `${meterHeadline(coach.shanten)}.${tail}`;
}

function Meter({ shanten }: { shanten: number }) {
  const now = meterIndex(shanten);
  return (
    <div className={styles.meter}>
      <ol className={styles.steps} aria-hidden="true">
        {METER_STEPS.map((label, index) => (
          <li key={label} data-now={index === now || undefined} data-done={index < now || undefined}>
            <i />
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <p className={styles.headline}>{meterHeadline(shanten)}</p>
    </div>
  );
}

const HELPER_MAX = 8;

function Helpers({ improve }: { improve: { kind: TileKind; left: number }[] }) {
  if (!improve.length) return <p className={styles.fine}>No tile you can still draw would help right now.</p>;
  // A hand that is far from ready has lots of helpful tiles: show the ones with the most copies left.
  const shown = [...improve].sort((a, b) => b.left - a.left || a.kind - b.kind).slice(0, HELPER_MAX);
  const more = improve.length - shown.length;
  return (
    <ul className={styles.helpers}>
      {shown.map((entry) => (
        <li key={entry.kind} title={`${kindName(entry.kind)}: ${entry.left} left`}>
          <Tile kind={entry.kind} size={24} />
          <small>×{entry.left}</small>
        </li>
      ))}
      {more > 0 ? (
        <li>
          <small>and {more} more kinds</small>
        </li>
      ) : null}
    </ul>
  );
}

function WinRows({ rows, closed, inRiichi, tsumoOnly }: { rows: WaitRow[]; closed: boolean; inRiichi: boolean; tsumoOnly?: boolean }) {
  const line = (label: string, preview: WinPreview | null, how: "ron" | "tsumo") => {
    if (!preview) return `${label}: not a winning tile`;
    if (preview.ok) return `${label}: ${previewScore(preview)}`;
    return `${label}: no yaku${how === "ron" && closed && !inRiichi ? " yet (declaring riichi adds one)" : ""}`;
  };
  return (
    <ul className={styles.waits}>
      {rows.map((wait) => (
        <li key={wait.kind} data-dead={wait.left === 0 || undefined}>
          <Tile kind={wait.kind} size={28} />
          <span>
            <b>
              {kindName(wait.kind)} <em>{wait.left === 0 ? "none left" : `${wait.left} left`}</em>
            </b>
            {tsumoOnly ? null : <small>{line("Ron (off a discard)", wait.ron, "ron")}</small>}
            <small>{line("Tsumo (you draw it)", wait.tsumo, "tsumo")}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Sight({ coach }: { coach: Coach }) {
  const [open, setOpen] = useState<string | null>(null);
  const id = useId();
  const entries = (coach.win_path?.yaku_in_sight ?? []).filter((entry) => sightLabel(entry, coach.shanten));
  if (!entries.length) return null;
  const shown = entries.find((entry) => entry.key === open);
  const info = shown ? yakuInfo(shown.key) : null;
  return (
    <div className={styles.sight}>
      <p className={styles.label}>Scoring you’re building</p>
      <ul className={styles.chips}>
        {entries.map((entry) => {
          const text = sightLabel(entry, coach.shanten)!;
          return (
            <li key={`${entry.key}${entry.kind ?? ""}`}>
              <button
                type="button"
                className={styles.chip}
                data-status={entry.status}
                aria-expanded={open === entry.key}
                aria-controls={`${id}-more`}
                onClick={() => {
                  playCue("ui_click");
                  setOpen(open === entry.key ? null : entry.key);
                }}
              >
                <b>{text.name}</b>
                <small>{text.note}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <div id={`${id}-more`}>
        {info ? (
          <p className={styles.more}>
            {info.explain} <small>({yakuValueText(info)})</small>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type CoachContentProps = {
  hand: SeatHand;
  coach: Coach;
  selected: TileId | null;
  closed: boolean;
  inRiichi: boolean;
  who: Who;
  myTurn: boolean;
};

/** The coach's full read of your hand. */
export function CoachContent({ hand, coach, selected, closed, inRiichi, who, myTurn }: CoachContentProps) {
  const pick = coach.suggestion ?? null;
  const rows = coach.improvers ?? [];
  const selectedKind = selected === null ? null : kindOf(selected);
  const explored: CoachRow | null = selectedKind !== null && selectedKind !== pick?.kind ? (rows.find((row) => row.kind === selectedKind) ?? null) : null;
  const path = coach.win_path;
  const wait = (kind: TileKind): WaitRow[] | null => hand.help.tenpai_discards[String(kind)] ?? null;

  // The tiles the win section talks about: the explored discard's waits if you tapped another tile, else the path.
  const exploredWaits = explored ? wait(explored.kind) : null;
  const pathRows: WaitRow[] | null = path?.can_win_now ?? null;
  const winRows = exploredWaits ?? pathRows;
  const thrown = explored ? explored.kind : path?.discard_kind ?? null;
  const readyNow = explored ? Boolean(exploredWaits) : Boolean(path?.ready);
  const complete = !explored && path?.subject === "complete";
  const riichiSeats = coach.riichi_seats ?? [];
  const blocked = explored ? [] : (path?.blocked ?? []);
  const shape = coach.shape && coach.shape.form !== "standard" ? FORM_TEXT[coach.shape.form] : null;
  const safeCount = safeTiles(hand).size;

  return (
    <div className={styles.content}>
      <Meter shanten={coach.shanten} />
      {shape ? <p className={styles.fine}>{shape}</p> : null}

      {pick && myTurn ? (
        <section className={styles.block} aria-label="What to throw">
          <p className={styles.label}>{pick.action === "tsumo" ? "Win now" : "Throw this"}</p>
          <div className={styles.pick}>
            <Tile id={pick.tile} size={34} />
            <p>
              {pick.action === "discard" ? (
                <>
                  <b>{kindName(pick.kind)}</b>
                  {pick.riichi ? <> and call riichi</> : null}.{" "}
                </>
              ) : (
                <b>Press Tsumo. </b>
              )}
              {suggestionText(pick, who)}
            </p>
          </div>
        </section>
      ) : null}

      {myTurn && rows.length && !explored ? <p className={styles.fine}>Tap any tile in your hand to see what throwing it would do.</p> : null}
      {explored ? (
        <section className={styles.block} aria-label="If you throw the tile you picked">
          <p className={styles.label}>If you throw this instead</p>
          <p className={styles.explore}>{discardText(explored.kind, explored.shanten, explored.left)}</p>
          {explored.shanten === 0 ? <p className={styles.fine}>Waiting on:</p> : explored.improve.length ? <p className={styles.fine}>Tiles that would help:</p> : null}
          <Helpers improve={explored.improve} />
          {explored.ready?.furiten ? <p className={styles.warn}>That wait would be furiten, so only a self-draw could win.</p> : null}
        </section>
      ) : null}

      {riichiSeats.length ? (
        <section className={styles.danger} aria-label="Danger">
          <p>
            <b>{riichiSeats.map(who).join(" and ")}</b> declared riichi: {riichiSeats.length > 1 ? "they’re each" : "they’re"} one tile from winning.{" "}
            {myTurn ? (safeCount ? "Tiles marked with a shield in your hand are certainly safe to throw." : "None of your tiles is certainly safe.") : null}
          </p>
        </section>
      ) : null}

      {path ? (
        <section className={styles.block} aria-label="Can I win?">
          <p className={styles.label}>Can I win?</p>
          {blocked.length ? (
            <div className={styles.blocked}>
              {blocked.map((block) => {
                const text = blockedText(block);
                return text ? <p key={block.code}>{text}</p> : null;
              })}
            </div>
          ) : null}
          {complete ? (
            <p className={styles.say}>
              <b>Yes.</b> Your hand is complete: press Tsumo.
            </p>
          ) : readyNow ? (
            <p className={styles.say}>
              {thrown !== null && myTurn ? (
                <>
                  <b>Not yet, but</b> after throwing {kindName(thrown)} you’re ready (tenpai). You’d win on:
                </>
              ) : (
                <>
                  <b>Almost.</b> You’re ready (tenpai). You win on:
                </>
              )}
            </p>
          ) : (
            <p className={styles.say}>
              <b>Not yet.</b> You’re not ready (tenpai) yet, so no tile can win. Keep building sets.
            </p>
          )}
          {winRows && winRows.length ? <WinRows rows={winRows} closed={closed} inRiichi={inRiichi} tsumoOnly={complete} /> : null}
          <Sight coach={coach} />
        </section>
      ) : null}
    </div>
  );
}

export type CoachPanelProps = CoachContentProps & {
  /** The coach data is from your last turn. */
  stale?: boolean;
};

/** Desktop: beside the board. */
export function CoachPanel({ stale, ...props }: CoachPanelProps) {
  return (
    <aside className={styles.panel} aria-label="Coach" data-stale={stale || undefined}>
      <header>
        <b>The coach</b>
        {stale ? <small>updates on your turn</small> : null}
      </header>
      <Speaker coach={props.coach} />
      <CoachContent {...props} />
    </aside>
  );
}

/** Polite, and only when the sentence changes. */
function Speaker({ coach }: { coach: Coach }) {
  const text = spokenText(coach);
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSpoken(text), 600);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <p className={styles.sr} role="status" aria-live="polite" aria-atomic="true">
      {spoken}
    </p>
  );
}

/** Phone: one line that opens the full read above the hand. */
export function CoachStrip({ stale, ...props }: CoachPanelProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // The sheet folds away when a call is offered, so the buttons get the room.
  const phase = props.hand.options?.phase ?? "none";
  const [seenPhase, setSeenPhase] = useState(phase);
  if (seenPhase !== phase) {
    setSeenPhase(phase);
    if (phase === "calls") setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className={styles.stripWrap} data-stale={stale || undefined}>
      <Speaker coach={props.coach} />
      {open ? (
        <div id={id} className={styles.sheet} role="region" aria-label="Coach">
          <CoachContent {...props} />
        </div>
      ) : null}
      <button
        type="button"
        className={styles.strip}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          playCue("ui_click");
          setOpen(!open);
        }}
      >
        <span>{stripText(props.coach)}</span>
        <b>{open ? "close" : "why?"}</b>
      </button>
    </div>
  );
}
