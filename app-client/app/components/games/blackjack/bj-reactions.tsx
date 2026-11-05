"use client";

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa6";
import { isCalm } from "@/app/providers/motion-provider";
import { sendGamesMessage, useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import styles from "@/app/components/games/blackjack/bj-reactions.module.scss";

// Floating emoji at a table. The server owns the list and the limits
// (api/src/services/games/tables/reactions.js); this draws them.
//
// Everything here goes around React on purpose: the page holds a big tree that already re-renders on
// every table push, and a reaction shouldn't re-render anything. Each floater is one element moved
// only by a transform and opacity animation, which the browser runs off the main thread. They can't
// take a click, and they fade out before they reach the cards in front of the seats.

export const REACTIONS = [
  { id: "fire", glyph: "🔥", label: "Fire" },
  { id: "party", glyph: "🎉", label: "Party" },
  { id: "clap", glyph: "👏", label: "Applause" },
  { id: "lol", glyph: "😂", label: "Laughing" },
  { id: "cry", glyph: "😭", label: "Crying" },
  { id: "dead", glyph: "💀", label: "Dead" },
  { id: "money", glyph: "💸", label: "Money gone" },
  { id: "pray", glyph: "🙏", label: "Praying" },
] as const;

const GLYPHS: Map<string, string> = new Map(REACTIONS.map((reaction) => [reaction.id, reaction.glyph]));

// A little under the server's limits (10 and 4 a second), so what you see yourself is what got sent.
const BURST = 8;
const PER_SECOND = 3;
// The socket closes at 30 messages in 10 seconds, so taps go out in lumps, at most twice a second.
const SEND_EVERY_MS = 500;
// Your own taps come back from the server. They're drawn the moment you tap, so skip them when they do.
const FORGET_OWED_MS = 3000;
const SEATS = 5;
const WATCHING = -1;

// What's on screen at once, how much of that one seat can take up, and how much everyone watching can
// (a crowd, drawn as one source, so it gets more room than one player).
const LIMITS = { desktop: { live: 36, seat: 10, crowd: 20 }, phone: { live: 16, seat: 6, crowd: 10 } };
// However big a count arrives, so many of it get drawn.
const MAX_PER_ITEM = 5;

const TALLY_MS = 6000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function createStage() {
  let layer: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let height = 0;
  let live = 0;
  const liveBySource = new Map<number, number>();
  // Bumped when the layer goes away, so floaters still finishing off-screen don't touch the new counts.
  let generation = 0;

  let tableKey = "";
  let seat = WATCHING;
  let limits = LIMITS.desktop;

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
    sendGamesMessage({ action: "react", table: tableKey, counts });
  }

  function spawn(id: string, source: number, big: boolean, delay: number) {
    const glyph = GLYPHS.get(id);
    const inSource = liveBySource.get(source) ?? 0;
    if (!glyph || !layer || live >= limits.live || inSource >= (source >= 0 ? limits.seat : limits.crowd)) return;
    live += 1;
    liveBySource.set(source, inSource + 1);

    // Over the sender's seat; anywhere for someone watching.
    const x = source >= 0 ? ((source + 0.5) / SEATS) * 100 + (Math.random() - 0.5) * 12 : 6 + Math.random() * 88;
    const size = (1.3 + Math.random() * 0.6) * (limits === LIMITS.phone ? 0.85 : 1) * (big ? 1.3 : 1);
    const fall = (height || 400) * (0.5 + Math.random() * 0.12);
    const sway = (Math.random() - 0.5) * 44;
    const spin = (Math.random() - 0.5) * 36;

    const element = document.createElement("span");
    element.className = styles.floater;
    element.textContent = glyph;
    element.style.left = `${x}%`;
    element.style.fontSize = `${size.toFixed(2)}rem`;
    layer.appendChild(element);

    const animation = element.animate(
      [
        { transform: `translate3d(0, 0, 0) rotate(${-spin}deg)`, opacity: 0 },
        { transform: `translate3d(${sway * 0.5}px, ${fall * 0.14}px, 0) rotate(${-spin * 0.4}deg)`, opacity: 1, offset: 0.14 },
        { transform: `translate3d(${sway}px, ${fall * 0.7}px, 0) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate3d(${sway * 0.6}px, ${fall}px, 0) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1800 + Math.random() * 800, delay, easing: "cubic-bezier(0.3, 0.1, 0.7, 0.9)", fill: "both" },
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

  /** Calm mode's stand-in for floaters: a small count on the button that clears itself. */
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
    if (isCalm() || reducedMotion()) return bumpTally(id, count);
    const drawn = Math.min(count, MAX_PER_ITEM);
    for (let index = 0; index < drawn; index += 1) spawn(id, source, count >= 3, index * 110 + Math.random() * 80);
  }

  return {
    configure(next: { tableKey: string; seat: number; phone: boolean }) {
      if (tableKey !== next.tableKey) flush();
      tableKey = next.tableKey;
      seat = next.seat >= 0 ? next.seat : WATCHING;
      limits = next.phone ? LIMITS.phone : LIMITS.desktop;
    },

    /** Ref for the layer the floaters live in. */
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

    /** One tap. False if you're out of taps for the moment, or offline. */
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

    /** A push from the table: [[id, seat, count], …]. */
    receive(payload: GamesPayload) {
      if (payload.type !== "reactions" || !Array.isArray(payload.items)) return;
      for (const item of payload.items as Array<[string, number, number]>) {
        const [id, source] = item;
        let count = Number(item[2]) || 0;
        if (!GLYPHS.has(id) || count <= 0) continue;
        if (source === seat) {
          const skip = Math.min(owed.get(id) ?? 0, count);
          if (skip) owed.set(id, (owed.get(id) ?? 0) - skip);
          count -= skip;
        }
        if (count > 0) show(id, source, count);
      }
    },

    flush,

    clear() {
      for (const tally of tallies.values()) window.clearTimeout(tally.timer);
      tallies.clear();
      flush();
    },
  };
}

export type ReactionStage = ReturnType<typeof createStage>;

// Hiding them is per browser: it's about your own screen.
const HIDE_KEY = "nasfaq.blackjack.reactions";
const hideListeners = new Set<() => void>();

function readHidden() {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "off";
  } catch {
    return false;
  }
}

function setHidden(hidden: boolean) {
  try {
    window.localStorage.setItem(HIDE_KEY, hidden ? "off" : "on");
  } catch {
    /* storage blocked: stays as it was */
  }
  hideListeners.forEach((notify) => notify());
}

function useReactionsHidden() {
  return useSyncExternalStore(
    (notify) => {
      hideListeners.add(notify);
      window.addEventListener("storage", notify);
      return () => {
        hideListeners.delete(notify);
        window.removeEventListener("storage", notify);
      };
    },
    readHidden,
    () => false,
  );
}

/** The table's reactions: subscribes unless you've hidden them. `seat` is yours, or below zero if you're watching. */
export function useTableReactions(tableKey: string, seat: number, phone: boolean) {
  const [stage] = useState(createStage);
  const hidden = useReactionsHidden();
  useEffect(() => stage.configure({ tableKey, seat, phone }), [phone, seat, stage, tableKey]);
  useEffect(() => () => stage.clear(), [stage]);
  const onPush = useCallback((payload: GamesPayload) => stage.receive(payload), [stage]);
  useGamesEvents(hidden ? null : `reactions:blackjack:${tableKey}`, onPush);
  return { stage, hidden };
}

/** Where the floaters fall: over the whole felt, under the bar. */
export const ReactionLayer = memo(function ReactionLayer({ stage }: { stage: ReactionStage }) {
  const attach = useCallback((element: HTMLDivElement | null) => stage.attachLayer(element), [stage]);
  return <div ref={attach} className={styles.layer} aria-hidden="true" />;
});

function ReactionButton({ id, glyph, label, stage, disabled }: { id: string; glyph: string; label: string; stage: ReactionStage; disabled: boolean }) {
  // Holding a button keeps them coming. The server's limit decides how fast that really is.
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
      hold.current = window.setTimeout(again, 220);
    };
    hold.current = window.setTimeout(again, 380);
    // On the window: the button may be disabled by the time they let go, and then it hears nothing.
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  return (
    <button
      type="button"
      className={styles.button}
      data-reaction={id}
      aria-label={`Send ${label}`}
      title={label}
      disabled={disabled}
      onClick={() => stage.tap(id)}
      onPointerDown={start}
      onPointerLeave={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span aria-hidden="true">{glyph}</span>
      <small aria-hidden="true" />
    </button>
  );
}

/**
 * The row of emoji along the top of the felt. It sits up there on purpose: the bet and HIT / STAND
 * controls stick to the bottom of the screen and change height, and a thumb that's spamming emoji
 * mustn't end up on a button that spends money.
 */
export const ReactionBar = memo(function ReactionBar({ stage, hidden, canSend, connected }: { stage: ReactionStage; hidden: boolean; canSend: boolean; connected: boolean }) {
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      stage.attachBar(element);
    },
    [stage],
  );
  return (
    <div ref={attach} className={styles.bar} role="group" aria-label="Reactions">
      {!hidden && canSend ? REACTIONS.map((reaction) => <ReactionButton key={reaction.id} id={reaction.id} glyph={reaction.glyph} label={reaction.label} stage={stage} disabled={!connected} />) : null}
      <button type="button" className={styles.toggle} aria-label={hidden ? "Show reactions" : "Hide reactions"} title={hidden ? "Show reactions" : "Hide reactions"} onClick={() => setHidden(!hidden)}>
        {hidden ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
      </button>
    </div>
  );
});
