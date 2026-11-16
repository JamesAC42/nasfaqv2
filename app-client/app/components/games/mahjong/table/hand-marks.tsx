"use client";

// Help's marks on your tiles, shared by the flat hand and the 3D table's tile buttons: what each one
// means (one source for the glyph, the tooltip, the tile's spoken name and the legend), the glyphs
// drawn inline, the label that shows over a tile when you point at it, focus it or lift it, and a
// one-line legend the first time each kind of mark turns up (until you dismiss it).

import { useState, useSyncExternalStore } from "react";
import type { TileMark } from "@/app/components/games/mahjong/table/my-hand";
import type { TileId } from "@/app/lib/games/mahjong/tiles";
import styles from "@/app/components/games/mahjong/table/hand-marks.module.scss";

export type MarkKind = "best" | "ready" | "safe";

// Where the marks come from (mahjong-table.tsx): `best` is the coach's suggested discard (or, with no
// suggestion, the kinds the coach rates best); `ready` is a discard that leaves the hand ready
// (help.tenpai_discards), on tiles that aren't the coach's pick; `safe` is safeTiles: a kind every
// player in riichi threw themselves or let go by after declaring, so none of them can win off it.
export const MARK_INFO: Record<MarkKind, { name: string; detail: string }> = {
  best: { name: "Coach’s pick", detail: "The throw the coach suggests right now." },
  ready: { name: "Leaves you ready", detail: "Throw it and you’re one tile from winning." },
  safe: { name: "Safe against riichi", detail: "Every riichi player threw it or let it go by since, so they can’t win off it." },
};

const ORDER: MarkKind[] = ["best", "ready", "safe"];

/** The marks on one tile, in the order they're explained. */
export function marksOf(id: TileId, marks: ReadonlyMap<TileId, TileMark>, safe?: ReadonlySet<TileId>): MarkKind[] {
  const mark = marks.get(id);
  const out: MarkKind[] = [];
  if (mark === "best" || mark === "ready") out.push(mark);
  if (safe?.has(id)) out.push("safe");
  return out;
}

/** What a screen reader hears after the tile's name: "Coach’s pick, safe against riichi". */
export function marksSpoken(kinds: MarkKind[]): string {
  return kinds.map((kind, index) => (index ? MARK_INFO[kind].name.toLowerCase() : MARK_INFO[kind].name)).join(", ");
}

/** A mark's shape: a triangle for the coach's pick, a dot for ready, a shield for safe (not color alone). */
export function MarkGlyph({ kind, className }: { kind: MarkKind; className?: string }) {
  if (kind === "best") {
    return (
      <svg className={className} data-glyph="best" viewBox="0 0 10 8" aria-hidden="true" focusable="false">
        <polygon points="5,0.6 9.6,7.6 0.4,7.6" />
      </svg>
    );
  }
  if (kind === "ready") {
    return (
      <svg className={className} data-glyph="ready" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
        <circle cx="4" cy="4" r="3.4" />
      </svg>
    );
  }
  return (
    <svg className={className} data-glyph="safe" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
      <path d="M6 0.9 11 2.7v3.9c0 3.2-2 5.4-5 6.6C3 12 1 9.8 1 6.6V2.7Z" />
    </svg>
  );
}

/**
 * The marks drawn on one tile, plus the label over it. The tile (button or slot) carries
 * `data-mark-host`; the label shows while it is pointed at, focused from the keyboard, or lifted (the
 * first tap on a phone), and takes no clicks. `edge` keeps the label inside the hand at either end.
 */
export function TileMarks({ kinds, edge }: { kinds: MarkKind[]; edge?: "start" | "end" }) {
  if (!kinds.length) return null;
  return (
    <>
      {kinds.map((kind) => (
        <MarkGlyph key={kind} kind={kind} className={styles.onTile} />
      ))}
      <span className={styles.tip} data-edge={edge} data-several={kinds.length > 1 || undefined} aria-hidden="true">
        {kinds.map((kind) => (
          <span key={kind} className={styles.tipRow}>
            <MarkGlyph kind={kind} className={styles.glyph} />
            <b>{MARK_INFO[kind].name}</b>
            <small>{MARK_INFO[kind].detail}</small>
          </span>
        ))}
      </span>
    </>
  );
}

/** Which end of the hand a tile is near, so its label opens inward. */
export const edgeOf = (index: number, count: number): "start" | "end" | undefined => (index < 2 ? "start" : index >= count - 2 ? "end" : undefined);

// ── The legend ────────────────────────────────────────────────────────────────────────────────────
// Remembered per kind (a shield first seen hands later still gets explained). A blocked store only
// means the legend comes back after a reload.
const LEGEND_KEY = "nasfaq.mahjong.mark-legend";
const legendListeners = new Set<() => void>();
let legendMemory: string | null = null;

function readDismissed(): string {
  if (legendMemory !== null) return legendMemory;
  try {
    return window.localStorage.getItem(LEGEND_KEY) ?? "";
  } catch {
    return "";
  }
}

function dismiss(kinds: MarkKind[]) {
  const next = Array.from(new Set([...readDismissed().split(",").filter(Boolean), ...kinds])).join(",");
  legendMemory = next;
  try {
    window.localStorage.setItem(LEGEND_KEY, next);
  } catch {
    /* kept in memory */
  }
  legendListeners.forEach((notify) => notify());
}

const subscribeLegend = (notify: () => void) => {
  legendListeners.add(notify);
  return () => {
    legendListeners.delete(notify);
  };
};

/**
 * One line naming each mark in use, shown under your moves the first time a kind of mark appears.
 * It stays (marks come and go with your turn) until "Got it".
 */
export function MarkLegend({ marks, safe }: { marks: ReadonlyMap<TileId, TileMark>; safe?: ReadonlySet<TileId> }) {
  // Everything counts as dismissed before the page hydrates, so the server renders nothing.
  const dismissed = useSyncExternalStore(subscribeLegend, readDismissed, () => ORDER.join(","));
  // Kinds seen so far at this table (latched while rendering, so it never flashes empty).
  const [seen, setSeen] = useState<MarkKind[]>([]);
  const now = new Set<MarkKind>();
  for (const mark of marks.values()) if (mark === "best" || mark === "ready") now.add(mark);
  if (safe?.size) now.add("safe");
  if ([...now].some((kind) => !seen.includes(kind))) setSeen(ORDER.filter((kind) => seen.includes(kind) || now.has(kind)));
  const done = new Set(dismissed.split(","));
  if (!seen.some((kind) => !done.has(kind))) return null;
  return (
    <div className={styles.legend} role="note" aria-label="What the marks on your tiles mean" data-mark-legend="">
      <ul>
        {seen.map((kind) => (
          <li key={kind}>
            <MarkGlyph kind={kind} className={styles.glyph} />
            {MARK_INFO[kind].name}
          </li>
        ))}
      </ul>
      <span className={styles.legendHint}>Point at or lift a tile to see why.</span>
      <button type="button" className={styles.legendClose} onClick={() => dismiss(seen)}>
        Got it
      </button>
    </div>
  );
}
