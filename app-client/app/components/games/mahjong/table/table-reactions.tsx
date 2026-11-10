"use client";

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa6";
import { ReactionFace } from "@/app/components/common/reaction-face";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { useReactionsOn } from "@/app/components/games/mahjong/table/table-prefs";
import type { ChibiPose } from "@/app/lib/art-manifest";
import { seatLabel, seatsBySide, SIDES, type Side } from "@/app/lib/games/mahjong/table-model";
import { STAMP_POSES, type MahjongTable, type SeatIndex, type StampPose } from "@/app/lib/games/mahjong/types";
import { sendGamesMessage, useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { isCalm } from "@/app/providers/motion-provider";
import styles from "@/app/components/games/mahjong/table/table-reactions.module.scss";

// Floating emoji, talent stamps and cheers at a table. The server owns the list and the limits
// (api/src/services/games/tables/reactions.js, MAHJONG_REACTIONS). Like the blackjack version, the
// floaters are built by hand and moved by the browser, so a reaction never re-renders the table.
// Stamps and cheers change nothing on the table: a stamp swaps a seat's portrait pose for a moment.

export const EMOJI = [
  { id: "fire", glyph: "🔥", label: "Fire" },
  { id: "party", glyph: "🎉", label: "Party" },
  { id: "clap", glyph: "👏", label: "Applause" },
  { id: "lol", glyph: "😂", label: "Laughing" },
  { id: "cry", glyph: "😭", label: "Crying" },
  { id: "dead", glyph: "💀", label: "Dead" },
  { id: "money", glyph: "💸", label: "Money gone" },
  { id: "pray", glyph: "🙏", label: "Praying" },
] as const;
const GLYPHS: Map<string, string> = new Map(EMOJI.map((entry) => [entry.id as string, entry.glyph as string]));
const CHEER_GLYPH = "📣";

const POSE_LABEL: Record<StampPose, string> = { hype: "Hype", smug: "Smug", cope: "Cope", shock: "Shock", moon: "To the moon", idle: "Chill" };

const BURST = 8;
const PER_SECOND = 3;
const SEND_EVERY_MS = 500;
const FORGET_OWED_MS = 3000;
const LIMIT = { desktop: { live: 32, seat: 8, crowd: 16 }, phone: { live: 14, seat: 5, crowd: 8 } };
const MAX_PER_ITEM = 4;
const TALLY_MS = 6000;
const WATCHING = -1;
const ANCHOR: Record<Side, [number, number]> = { bottom: [50, 86], right: [84, 46], top: [50, 14], left: [16, 46] };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function createStage() {
  let layer: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let height = 0;
  let live = 0;
  const liveBySource = new Map<number, number>();
  let generation = 0;
  let tableKey = "";
  let seat = WATCHING;
  let bottom = 0;
  let limits = LIMIT.desktop;
  let onStamp: ((seat: number, pose: StampPose) => void) | null = null;

  let tokens = BURST;
  let tokensAt = 0;
  let lastSent = 0;
  let lastTap = 0;
  let timer: number | null = null;
  const pending = new Map<string, number>();
  const owed = new Map<string, number>();
  const tallies = new Map<string, { count: number; timer: number }>();

  function flush() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (!pending.size) return;
    const counts = Object.fromEntries(pending);
    pending.clear();
    lastSent = Date.now();
    sendGamesMessage({ action: "mj-react", table: tableKey, counts });
  }

  function place(source: number, target: number): [number, number] {
    const seats = seatsBySide(bottom);
    const at = target >= 0 ? target : source;
    const side = SIDES.find((entry) => seats[entry] === at);
    if (!side) return [8 + Math.random() * 84, 70];
    const [x, y] = ANCHOR[side];
    return [x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 6];
  }

  function spawn(glyph: string, source: number, target: number, big: boolean, delay: number) {
    const inSource = liveBySource.get(source) ?? 0;
    if (!layer || live >= limits.live || inSource >= (source >= 0 ? limits.seat : limits.crowd)) return;
    live += 1;
    liveBySource.set(source, inSource + 1);
    const [x, y] = place(source, target);
    const size = (1.3 + Math.random() * 0.5) * (limits === LIMIT.phone ? 0.85 : 1) * (big ? 1.25 : 1);
    const rise = (height || 360) * (0.26 + Math.random() * 0.1);
    const sway = (Math.random() - 0.5) * 40;
    const element = document.createElement("span");
    element.className = styles.floater;
    element.textContent = glyph;
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    element.style.fontSize = `${size.toFixed(2)}rem`;
    layer.appendChild(element);
    const animation = element.animate(
      [
        { transform: "translate3d(0, 0, 0) scale(0.6)", opacity: 0 },
        { transform: `translate3d(${sway * 0.3}px, ${-rise * 0.15}px, 0) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: `translate3d(${sway}px, ${-rise * 0.75}px, 0) scale(1)`, opacity: 1, offset: 0.7 },
        { transform: `translate3d(${sway * 0.7}px, ${-rise}px, 0) scale(0.95)`, opacity: 0 },
      ],
      { duration: 1700 + Math.random() * 700, delay, easing: "cubic-bezier(0.3, 0.1, 0.7, 0.9)", fill: "both" },
    );
    const born = generation;
    const done = () => {
      element.remove();
      if (born !== generation) return;
      live -= 1;
      liveBySource.set(source, (liveBySource.get(source) ?? 1) - 1);
    };
    animation.onfinish = done;
    animation.oncancel = done;
  }

  function bumpTally(id: string, count: number) {
    const badge = bar?.querySelector(`[data-reaction="${id}"] small`);
    if (!badge) return;
    const tally = tallies.get(id);
    if (tally) window.clearTimeout(tally.timer);
    const next = (tally?.count ?? 0) + count;
    badge.textContent = next > 99 ? "99+" : String(next);
    tallies.set(id, {
      count: next,
      timer: window.setTimeout(() => {
        badge.textContent = "";
        tallies.delete(id);
      }, TALLY_MS),
    });
  }

  function show(id: string, source: number, count: number) {
    if (document.hidden) return;
    if (id.startsWith("stamp-")) {
      const pose = id.slice(6) as StampPose;
      if ((STAMP_POSES as readonly string[]).includes(pose) && source >= 0) onStamp?.(source, pose);
      return;
    }
    const cheer = /^cheer-([0-3])$/.exec(id);
    const glyph = cheer ? CHEER_GLYPH : GLYPHS.get(id);
    if (!glyph) return;
    if (isCalm() || reducedMotion()) return bumpTally(id, count);
    const drawn = Math.min(count, MAX_PER_ITEM);
    for (let index = 0; index < drawn; index += 1) spawn(glyph, source, cheer ? Number(cheer[1]) : -2, count >= 3, index * 110 + Math.random() * 80);
  }

  return {
    configure(next: { tableKey: string; seat: number; bottom: number; phone: boolean; onStamp: ((seat: number, pose: StampPose) => void) | null }) {
      if (tableKey !== next.tableKey) flush();
      tableKey = next.tableKey;
      seat = next.seat >= 0 ? next.seat : WATCHING;
      bottom = next.bottom;
      limits = next.phone ? LIMIT.phone : LIMIT.desktop;
      onStamp = next.onStamp;
    },
    attachLayer(element: HTMLElement | null) {
      layer = element;
      if (!element) return;
      const observer = new ResizeObserver(() => {
        height = element.clientHeight;
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        layer = null;
        generation += 1;
        live = 0;
        liveBySource.clear();
      };
    },
    attachBar(element: HTMLElement | null) {
      bar = element;
    },
    tap(id: string) {
      const now = Date.now();
      tokens = Math.min(BURST, tokens + ((now - tokensAt) / 1000) * PER_SECOND);
      tokensAt = now;
      if (tokens < 1) return false;
      tokens -= 1;
      pending.set(id, (pending.get(id) ?? 0) + 1);
      if (now - lastTap > FORGET_OWED_MS) owed.clear();
      lastTap = now;
      owed.set(id, (owed.get(id) ?? 0) + 1);
      show(id, seat, 1);
      const wait = lastSent + SEND_EVERY_MS - now;
      if (wait <= 0) flush();
      else if (timer === null) timer = window.setTimeout(flush, wait);
      return true;
    },
    receive(payload: GamesPayload) {
      if (payload.type !== "reactions" || !Array.isArray(payload.items)) return;
      for (const item of payload.items as Array<[string, number, number]>) {
        const [id, source] = item;
        let count = Number(item[2]) || 0;
        if (typeof id !== "string" || count <= 0) continue;
        // What you tapped yourself was already drawn.
        if (source === seat || (seat === WATCHING && source === WATCHING)) {
          const skip = Math.min(owed.get(id) ?? 0, count);
          if (skip) owed.set(id, (owed.get(id) ?? 0) - skip);
          count -= skip;
        }
        if (count > 0) show(id, source, count);
      }
    },
    clear() {
      for (const tally of tallies.values()) window.clearTimeout(tally.timer);
      tallies.clear();
      flush();
    },
  };
}

export type ReactionStage = ReturnType<typeof createStage>;

/** Subscribes to the table's reactions (unless hidden) and gives the stage to draw them. */
export function useTableReactions(tableId: number, seat: number, bottom: number, phone: boolean, onStamp: (seat: number, pose: StampPose) => void) {
  const [stage] = useState(createStage);
  const [on, setOn] = useReactionsOn();
  useEffect(() => {
    stage.configure({ tableKey: String(tableId), seat, bottom, phone, onStamp });
  }, [stage, tableId, seat, bottom, phone, onStamp]);
  useEffect(() => () => stage.clear(), [stage]);
  const onPush = useCallback((payload: GamesPayload) => stage.receive(payload), [stage]);
  useGamesEvents(on ? `reactions:mahjong:${tableId}` : null, onPush);
  return { stage, on, setOn };
}

/** Where the floaters live: over the board, under the controls, taking no clicks. */
export const ReactionLayer = memo(function ReactionLayer({ stage }: { stage: ReactionStage }) {
  const attach = useCallback((element: HTMLDivElement | null) => stage.attachLayer(element), [stage]);
  return <div ref={attach} className={styles.layer} aria-hidden="true" />;
});

function SendButton({ id, label, stage, disabled, children, className }: { id: string; label: string; stage: ReactionStage; disabled: boolean; children: React.ReactNode; className?: string }) {
  const hold = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (hold.current !== null) window.clearTimeout(hold.current);
    hold.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const start = () => {
    stop();
    const again = () => {
      stage.tap(id);
      hold.current = window.setTimeout(again, 240);
    };
    hold.current = window.setTimeout(again, 400);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  return (
    <button type="button" className={className ?? styles.button} data-reaction={id} aria-label={label} title={label} disabled={disabled} onClick={() => stage.tap(id)} onPointerDown={start} onPointerLeave={stop} onContextMenu={(event) => event.preventDefault()}>
      {children}
      <small aria-hidden="true" />
    </button>
  );
}

export type ReactionBarProps = {
  stage: ReactionStage;
  on: boolean;
  setOn: (on: boolean) => void;
  canSend: boolean;
  connected: boolean;
  table: MahjongTable;
  mySeat: number | null;
  bottom: SeatIndex;
  seatStyles: SeatStyle[];
};

/**
 * Emoji for everyone verified; your talent's stamps if you're playing; a cheer for each seat if you're
 * watching (with what the rail has sent so far).
 */
export const ReactionBar = memo(function ReactionBar({ stage, on, setOn, canSend, connected, table, mySeat, bottom, seatStyles }: ReactionBarProps) {
  const attach = useCallback((element: HTMLDivElement | null) => stage.attachBar(element), [stage]);
  const sides = seatsBySide(bottom);
  const mine = mySeat !== null ? table.seats[mySeat] : null;
  return (
    <div ref={attach} className={styles.bar} role="group" aria-label="Reactions">
      {on && canSend ? (
        <>
          {EMOJI.map((entry) => (
            <SendButton key={entry.id} id={entry.id} label={`Send ${entry.label}`} stage={stage} disabled={!connected}>
              <span aria-hidden="true">{entry.glyph}</span>
            </SendButton>
          ))}
          {mine?.talent ? (
            <span className={styles.group} aria-label="Your stamps">
              {STAMP_POSES.map((pose) => (
                <SendButton key={pose} id={`stamp-${pose}`} label={`Stamp: ${POSE_LABEL[pose]}`} stage={stage} disabled={!connected} className={styles.stamp}>
                  <ReactionFace symbol={mine.talent as string} pose={pose as ChibiPose} size={26} crop="full" />
                </SendButton>
              ))}
            </span>
          ) : null}
          {mySeat === null ? (
            <span className={styles.group} aria-label="Cheer a seat">
              {SIDES.map((side) => {
                const seat = sides[side];
                const entry = table.seats[seat];
                if (!entry) return null;
                return (
                  <SendButton key={seat} id={`cheer-${seat}`} label={`Cheer ${seatLabel(entry)}`} stage={stage} disabled={!connected} className={styles.cheer}>
                    <span className={styles.cheerFace} style={{ "--tal": seatStyles[seat]?.color } as CSSProperties}>
                      {entry.talent ? <ReactionFace symbol={entry.talent} pose="hype" size={22} crop="full" /> : null}
                    </span>
                    <span aria-hidden="true">{CHEER_GLYPH}</span>
                    <em>{table.cheers[seat] ?? 0}</em>
                  </SendButton>
                );
              })}
            </span>
          ) : null}
        </>
      ) : null}
      <button type="button" className={styles.toggle} aria-label={on ? "Hide reactions" : "Show reactions"} title={on ? "Hide reactions" : "Show reactions"} onClick={() => setOn(!on)}>
        {on ? <FaEye aria-hidden="true" /> : <FaEyeSlash aria-hidden="true" />}
      </button>
    </div>
  );
});
