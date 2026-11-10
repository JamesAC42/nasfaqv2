"use client";

import { useEffect, useRef, useState } from "react";
import { Tile } from "@/app/components/games/mahjong/tile";
import type { LessonMove } from "@/app/components/games/mahjong/table/lesson-texts";
import { kindOf, kindName, sortTiles, type TileId, type TileKind } from "@/app/lib/games/mahjong/tiles";
import type { CallOptions, MahjongAction, Options, TurnOptions } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

type Choice = { label: string; tiles: TileId[]; kinds?: TileKind[]; action: MahjongAction };
type Kind = "tsumo" | "ron" | "riichi" | "pon" | "chi" | "kan" | "kyuushu" | "pass";

// One line for each button: what it does, what it costs. Shown while Help is on.
const HINTS: Record<Kind, string> = {
  tsumo: "You drew the tile that finishes your hand. Press it to win and collect from everyone.",
  ron: "That discard finishes your hand. Press it to win and make the player who threw it pay.",
  riichi: "Declare you are one tile from winning. Costs 1,000 points and locks your hand: you only throw what you draw. Needs a closed hand.",
  pon: "Take that tile with two matching ones in your hand to make a set. Opens your hand: no riichi after this.",
  chi: "Take that tile to make a run of three in a row, from the player on your left only. Opens your hand: no riichi after this.",
  kan: "Make a set of four. You draw a bonus tile and a new dora shows. A closed kan keeps your hand closed; taking a discard opens it.",
  kyuushu: "Nine different terminals and honors on the first draw: call the hand off and deal again. Nobody pays.",
  pass: "Let it go. Nothing changes and play continues.",
};
const NAMES: Record<Kind, string> = { tsumo: "Tsumo", ron: "Ron", riichi: "Riichi", pon: "Pon", chi: "Chi", kan: "Kan", kyuushu: "Nine terminals", pass: "Pass" };
const KEYS: Record<Kind, string> = { tsumo: "t", ron: "o", riichi: "r", pon: "p", chi: "c", kan: "k", kyuushu: "9", pass: "n" };

export type ActionBarProps = {
  options: Options | null;
  /** The table is waiting on someone else, or the hand is over. */
  waiting: boolean;
  busy: boolean;
  riichiMode: boolean;
  onRiichiMode: (on: boolean) => void;
  onAct: (action: MahjongAction) => void;
  guide: LessonMove | null;
};

function plan(options: Options): { kinds: Kind[]; choices: Partial<Record<Kind, Choice[]>> } {
  const choices: Partial<Record<Kind, Choice[]>> = {};
  const kinds: Kind[] = [];
  if (options.phase === "turn") {
    const turn: TurnOptions = options;
    if (turn.tsumo) kinds.push("tsumo");
    if (turn.riichi.length) kinds.push("riichi");
    const kans: Choice[] = [
      ...turn.ankan.map((kind) => ({ label: `Closed kan of ${kindName(kind)}`, tiles: [], kinds: [kind, kind, kind, kind], action: { type: "ankan", kind } as MahjongAction })),
      ...turn.kakan.map((kind) => ({ label: `Add to your pon of ${kindName(kind)}`, tiles: [], kinds: [kind], action: { type: "kakan", kind } as MahjongAction })),
    ];
    if (kans.length) {
      kinds.push("kan");
      choices.kan = kans;
    }
    if (turn.kyuushu) kinds.push("kyuushu");
    return { kinds, choices };
  }
  const calls: CallOptions = options;
  const tile = calls.tile;
  if (calls.ron) kinds.push("ron");
  if (calls.pon?.length) {
    kinds.push("pon");
    choices.pon = calls.pon.map((pair) => ({ label: "Pon", tiles: sortTiles([tile, ...pair]), action: { type: "pon", tiles: pair } as MahjongAction }));
  }
  if (calls.chi?.length) {
    kinds.push("chi");
    choices.chi = calls.chi.map((pair) => ({ label: "Chi", tiles: sortTiles([tile, ...pair]), action: { type: "chi", tiles: pair } as MahjongAction }));
  }
  if (calls.kan) {
    kinds.push("kan");
    choices.kan = [{ label: "Kan", tiles: [tile], kinds: [kindOf(tile), kindOf(tile), kindOf(tile), kindOf(tile)], action: { type: "kan" } }];
  }
  kinds.push("pass");
  return { kinds, choices };
}

/** The buttons for what you may do now. Several ways to call: pick the shape in a row under the buttons. */
export function ActionBar({ options, waiting, busy, riichiMode, onRiichiMode, onAct, guide }: ActionBarProps) {
  const [choosing, setChoosing] = useState<Kind | null>(null);
  const { kinds, choices } = options ? plan(options) : { kinds: [] as Kind[], choices: {} as Partial<Record<Kind, Choice[]>> };
  const signature = options ? `${options.phase}:${kinds.join(",")}` : "none";
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setChoosing(null);
  }

  const press = (kind: Kind) => {
    if (busy) return;
    if (kind === "riichi") return onRiichiMode(!riichiMode);
    if (kind === "tsumo") return onAct({ type: "tsumo" });
    if (kind === "ron") return onAct({ type: "ron" });
    if (kind === "pass") return onAct({ type: "pass" });
    if (kind === "kyuushu") return onAct({ type: "kyuushu" });
    const list = choices[kind] ?? [];
    if (list.length === 1) return onAct(list[0].action);
    setChoosing((current) => (current === kind ? null : kind));
  };

  // Letter shortcuts on a keyboard. Not while typing, not with a modifier.
  const latest = useRef({ press, kinds });
  useEffect(() => {
    latest.current = { press, kinds };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const hit = (Object.keys(KEYS) as Kind[]).find((kind) => KEYS[kind] === event.key.toLowerCase());
      if (!hit || !latest.current.kinds.includes(hit)) return;
      event.preventDefault();
      latest.current.press(hit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!options || waiting) return null;

  const guided = (kind: Kind) => {
    if (!guide) return false;
    if (guide.type === "discard") return kind === "riichi" && Boolean(guide.riichi) && !riichiMode;
    return guide.type === kind;
  };

  return (
    <div className={styles.actions}>
      <div className={styles.actionRow} role="group" aria-label="Your moves">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.act}
            data-kind={kind}
            data-on={(kind === "riichi" && riichiMode) || choosing === kind || undefined}
            data-guide={guided(kind) || undefined}
            data-faded={(guide && !guided(kind)) || undefined}
            disabled={busy}
            onClick={() => press(kind)}
            aria-pressed={kind === "riichi" ? riichiMode : undefined}
          >
            {kind === "riichi" && riichiMode ? "Cancel riichi" : NAMES[kind]}
            <kbd aria-hidden="true">{KEYS[kind].toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      {choosing && choices[choosing] ? (
        <div className={styles.choices} role="group" aria-label={`Choose how to ${NAMES[choosing]}`}>
          {choices[choosing]!.map((choice, index) => (
            <button key={index} type="button" className={styles.choice} disabled={busy} onClick={() => onAct(choice.action)} title={choice.label}>
              {choice.tiles.length ? choice.tiles.map((id) => <Tile key={id} id={id} size={24} />) : choice.kinds ? choice.kinds.map((kind, at) => <Tile key={at} kind={kind} size={24} />) : null}
              {choice.tiles.length === 0 ? <span>{choice.label}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {riichiMode ? <p className={styles.say}>Now pick the tile to throw. Only the ones that leave you ready are lit.</p> : null}
    </div>
  );
}

/** One line for each button you could press now, under the bar (not part of the docked controls). */
export function ActionHints({ options }: { options: Options | null }) {
  if (!options) return null;
  const { kinds } = plan(options);
  return (
    <ul className={styles.hints}>
      {kinds.map((kind) => (
        <li key={kind}>
          <b>{NAMES[kind]}.</b> {HINTS[kind]}
        </li>
      ))}
    </ul>
  );
}
