"use client";

import { useMemo, useState } from "react";
import { FiCheck, FiRotateCcw, FiX } from "react-icons/fi";
import { TalentReaction } from "@/app/components/common/talent-reaction";
import { usePhone } from "@/app/components/games/arcade/use-media";
import { Tile, TileRow } from "@/app/components/games/mahjong/tile";
import { groupKinds, readShape, waitsOf } from "@/app/components/games/mahjong/learn/hand-check";
import { countKinds, kindName, kindNotation, kindsFrom, type TileKind } from "@/app/lib/games/mahjong/tiles";
import styles from "@/app/components/games/mahjong/learn/hand-lab.module.scss";

// The hand lab: a closed 13-tile hand you can poke at. Try a tile to see whether it completes the
// shape, ask for the waits, or take tiles out and put others in. Every preset was checked against
// the server's own waits (shanten.js), and so is the checker in hand-check.ts. It talks about the
// shape only: a win also needs a yaku, and the lab says so.

export const LAB_PRESETS = {
  "two-sided": { label: "Two-sided", hand: "123m456m789s11z45p", note: "4-5 of circles: a 3 or a 6 makes the run." },
  middle: { label: "Middle", hand: "123m456m789s11z46p", note: "4-6 of circles: only the 5 fills the gap." },
  edge: { label: "Edge", hand: "123m456m789s11z12p", note: "1-2 of circles can only become 1-2-3." },
  pairs: { label: "Two pairs", hand: "123m456m789s55p99p", note: "Either pair can become the triplet; the other stays the pair." },
  single: { label: "Single tile", hand: "123m456m789s111z8s", note: "Four sets are done. The lone 8 of bamboo waits for its twin." },
  seven: { label: "Seven pairs", hand: "1133m5577p2244s4z", note: "Six different pairs and a lone North wind." },
  three: { label: "Three-way", hand: "2345678p111z333z", note: "Seven circles in a row: a 2, 5 or 8 of circles completes them." },
  nine: { label: "Nine-way", hand: "1112345678999m", note: "1-1-1, 2 to 8, 9-9-9 of one suit: any tile of that suit completes it." },
} as const;

export type LabPreset = keyof typeof LAB_PRESETS;

const PALETTE: TileKind[][] = [
  Array.from({ length: 9 }, (_, index) => index),
  Array.from({ length: 9 }, (_, index) => 9 + index),
  Array.from({ length: 9 }, (_, index) => 18 + index),
  Array.from({ length: 7 }, (_, index) => 27 + index),
];

const sorted = (kinds: TileKind[]) => [...kinds].sort((a, b) => a - b);
const notationOf = (kinds: TileKind[]) => kinds.map(kindNotation).join("");
const FORM_TEXT = { standard: "four sets and a pair", pairs: "seven different pairs", orphans: "thirteen orphans" } as const;

/** The 14 tiles, laid out in the groups they make (or just sorted). */
function Grouped({ kinds, size }: { kinds: TileKind[]; size: number }) {
  const shape = readShape(countKinds(kinds));
  if (!shape || shape.form === "orphans") return <TileRow notation={notationOf(sorted(kinds))} size={size} />;
  const ordered = shape.groups.flatMap(groupKinds);
  const gaps: number[] = [];
  let at = -1;
  for (const group of shape.groups) {
    at += groupKinds(group).length;
    gaps.push(at);
  }
  return <TileRow notation={notationOf(ordered)} size={size} gapAfter={gaps.slice(0, -1)} />;
}

export function HandLab({ presets = Object.keys(LAB_PRESETS) as LabPreset[], start, editable = true, title = "Hand lab" }: { presets?: LabPreset[]; start?: LabPreset; editable?: boolean; title?: string }) {
  const phone = usePhone();
  const first = start ?? presets[0];
  const [preset, setPreset] = useState<LabPreset | null>(first);
  const [hand, setHand] = useState<TileKind[]>(() => sorted(kindsFrom(LAB_PRESETS[first].hand)));
  const [tried, setTried] = useState<TileKind | null>(null);
  const [shown, setShown] = useState(false);
  const [solved, setSolved] = useState(0);

  const counts = useMemo(() => countKinds(hand), [hand]);
  const full = hand.length === 13;
  const waits = useMemo(() => (full ? waitsOf(counts) : []), [counts, full]);
  const copies = waits.reduce((sum, kind) => sum + (4 - counts[kind]), 0);
  const result = tried === null ? null : readShape(countKinds([...hand, tried]));
  const handSize = phone ? 21 : 32;
  const paletteSize = phone ? 27 : 30;

  const choose = (key: LabPreset) => {
    setPreset(key);
    setHand(sorted(kindsFrom(LAB_PRESETS[key].hand)));
    setTried(null);
    setShown(false);
  };

  const takeOut = (index: number) => {
    setHand((current) => current.filter((_, at) => at !== index));
    setPreset(null);
    setTried(null);
    setShown(false);
  };

  const tap = (kind: TileKind) => {
    if (!full) {
      setHand((current) => sorted([...current, kind]));
      setPreset(null);
      setTried(null);
      setShown(false);
      return;
    }
    setTried(kind);
    if (readShape(countKinds([...hand, kind]))) setSolved((value) => value + 1);
  };

  return (
    <section className={styles.lab} aria-label={title}>
      <header className={styles.head}>
        <span className={styles.badge}>{title}</span>
        <div className={styles.presets} role="group" aria-label="Example hands">
          {presets.map((key) => (
            <button key={key} type="button" aria-pressed={preset === key} onClick={() => choose(key)}>
              {LAB_PRESETS[key].label}
            </button>
          ))}
        </div>
      </header>

      <p className={styles.note}>{preset ? LAB_PRESETS[preset].note : editable ? "Your own hand. Tap a tile in it to take it out." : null}</p>

      <div className={styles.hand} role="group" aria-label={editable ? "Your hand: tap a tile to take it out" : "Your hand"}>
        {hand.map((kind, index) =>
          editable ? (
            <Tile key={`${index}-${kind}`} kind={kind} size={handSize} onClick={() => takeOut(index)} title={`Take out the ${kindName(kind)}`} />
          ) : (
            <Tile key={`${index}-${kind}`} kind={kind} size={handSize} highlight={shown && waits.includes(kind)} />
          ),
        )}
        {Array.from({ length: Math.max(0, 13 - hand.length) }, (_, index) => (
          <span key={`gap-${index}`} className={styles.slot} style={{ width: handSize, height: (handSize * 4) / 3 }} aria-hidden="true" />
        ))}
      </div>

      <div className={styles.readout} aria-live="polite">
        {!full ? (
          <p>
            <b>{hand.length} of 13.</b> Tap a tile below to put it in your hand.
          </p>
        ) : waits.length ? (
          <>
            <p>
              <span className={styles.ready}>Ready</span> One tile from a complete shape.{" "}
              {shown ? (
                <>
                  It waits on{" "}
                  <b>
                    {waits.length} {waits.length === 1 ? "kind" : "kinds"}, up to {copies} tiles
                  </b>
                  .
                </>
              ) : (
                <>Tap a tile below to try it, or:</>
              )}
            </p>
            {shown ? (
              <span className={styles.waits}>
                {waits.map((kind) => (
                  <Tile key={kind} kind={kind} size={phone ? 24 : 28} highlight />
                ))}
              </span>
            ) : (
              <button type="button" className={styles.show} onClick={() => setShown(true)}>
                Show the waits
              </button>
            )}
          </>
        ) : (
          <p>
            <span className={styles.notReady}>Not ready</span> No single tile completes this hand yet.{editable ? " Swap a tile and see." : ""}
          </p>
        )}
      </div>

      {editable || full ? (
        <div className={styles.palette} role="group" aria-label={full ? "Try a tile" : "Put a tile in"}>
          <span className={styles.paletteLabel}>{full ? "Try a tile as the fourteenth" : "Put a tile in"}</span>
          {PALETTE.map((row, index) => (
            <span key={index} className={styles.paletteRow}>
              {row.map((kind) => (
                <Tile
                  key={kind}
                  kind={kind}
                  size={paletteSize}
                  onClick={() => tap(kind)}
                  disabled={counts[kind] >= 4}
                  dim={counts[kind] >= 4}
                  selected={tried === kind}
                  highlight={shown && waits.includes(kind)}
                  title={full ? `Try the ${kindName(kind)}` : `Put in the ${kindName(kind)}`}
                />
              ))}
            </span>
          ))}
        </div>
      ) : null}

      {tried !== null ? (
        <div className={styles.result} data-ok={result ? "true" : "false"} key={`${tried}-${solved}`}>
          <div className={styles.resultText}>
            <p>
              {result ? <FiCheck aria-hidden="true" /> : <FiX aria-hidden="true" />}
              {result ? (
                <span>
                  <b>The {kindName(tried)} completes it:</b> {FORM_TEXT[result.form]}.
                </span>
              ) : (
                <span>
                  <b>The {kindName(tried)} doesn’t complete it.</b> {waits.length ? "Try another, or show the waits." : ""}
                </span>
              )}
            </p>
            <Grouped kinds={[...hand, tried]} size={phone ? 20 : 26} />
            {result ? <small>A complete shape still needs a yaku to win.</small> : null}
          </div>
          {result ? <TalentReaction pose="hype" size={phone ? 52 : 64} fresh className={styles.face} /> : null}
        </div>
      ) : null}

      {preset === null ? (
        <button type="button" className={styles.reset} onClick={() => choose(first)}>
          <FiRotateCcw aria-hidden="true" /> Back to the examples
        </button>
      ) : null}
    </section>
  );
}
