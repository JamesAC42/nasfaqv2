"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CursorPush, CursorSample, SeatIndex } from "@/app/lib/games/mahjong/types";
import { sendGamesMessage, useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import styles from "@/app/components/games/mahjong/select/talent-select.module.scss";

// Live pointers on the talent select. Positions are fractions (0..1) of the stage, the talent grid,
// which keeps the same shape at every width (see talent-select.tsx), so a point means the same card
// on a phone and on a desktop.
//
// Sending: at most one message every SEND_EVERY_MS while the pointer moves, one more with zero speed
// once it stops (STOP_AFTER_MS without movement), one when the hovered talent changes and one when it
// leaves the stage. Speed is smoothed over the last few moves.
//
// Drawing someone else's: dead reckoning, then a spring. Each frame the target is the last sample
// carried on by its own speed for the time since it arrived (at most PREDICT_CAP_S, so a pointer that
// stopped without saying so never runs off), and the drawn point follows the target with a critically
// damped spring (SMOOTH_TIME_S): no overshoot, so no jitter or rubber-banding when a new sample corrects
// the guess. A gap bigger than SNAP_DISTANCE of the stage is jumped. A pointer with nothing new for
// IDLE_FADE_MS fades out over FADE_MS; one that left the stage fades at once.

export const SEND_EVERY_MS = 40;
const STOP_AFTER_MS = 90;
const SPEED_SMOOTHING = 0.55; // weight of the newest move in the smoothed speed
const PREDICT_CAP_S = 0.12;
const SMOOTH_TIME_S = 0.07;
const SNAP_DISTANCE = 0.25;
const IDLE_FADE_MS = 3000;
const FADE_MS = 400;
const MAX_FRAME_S = 0.05;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * One step of a critically damped spring from `current` toward `target` (the closed form game engines
 * use for smooth follow): returns the new position and speed.
 */
export function smoothDamp(current: number, target: number, velocity: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
}

// ── Sending ─────────────────────────────────────────────────────────────────
type Outgoing = { x: number; y: number; vx: number; vy: number; hover: string | null; gone: boolean };

/**
 * Pointer handlers for the stage that stream your pointer to the table, plus the talent you're over
 * (for the page's own use). Sends nothing unless `enabled`.
 */
export function useCursorSender(tableId: number, enabled: boolean, stageRef: RefObject<HTMLElement | null>) {
  const state = useRef<Outgoing>({ x: 0, y: 0, vx: 0, vy: 0, hover: null, gone: true });
  const previous = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastSent = useRef(0);
  const trailing = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const flush = useCallback(() => {
    trailing.current = null;
    lastSent.current = performance.now();
    const out = state.current;
    // "action" first: the server knows a pointer message by how it starts.
    sendGamesMessage({ action: "mj-cursor", table: tableId, x: round4(out.x), y: round4(out.y), vx: round4(out.vx), vy: round4(out.vy), t: Math.round(performance.now()), hover: out.hover, gone: out.gone });
  }, [tableId]);

  const queue = useCallback(() => {
    if (!enabled || trailing.current !== null) return;
    const wait = SEND_EVERY_MS - (performance.now() - lastSent.current);
    if (wait <= 0) flush();
    else trailing.current = window.setTimeout(flush, wait);
  }, [enabled, flush]);

  useEffect(
    () => () => {
      if (trailing.current !== null) window.clearTimeout(trailing.current);
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    },
    [],
  );

  const track = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = clamp01((event.clientX - rect.left) / rect.width);
      const y = clamp01((event.clientY - rect.top) / rect.height);
      const now = performance.now();
      const out = state.current;
      const last = previous.current;
      const dt = last ? (now - last.at) / 1000 : 0;
      if (last && dt > 0.004 && dt < 0.25) {
        out.vx = out.vx * (1 - SPEED_SMOOTHING) + ((x - last.x) / dt) * SPEED_SMOOTHING;
        out.vy = out.vy * (1 - SPEED_SMOOTHING) + ((y - last.y) / dt) * SPEED_SMOOTHING;
      } else if (!last || dt >= 0.25) {
        out.vx = 0;
        out.vy = 0;
      }
      if (!last || dt > 0.004) previous.current = { x, y, at: now };
      out.x = x;
      out.y = y;
      out.gone = false;
      const over = (event.target as Element | null)?.closest?.("[data-talent]")?.getAttribute("data-talent") ?? null;
      if (over !== out.hover) {
        out.hover = over;
        setHover(over);
      }
      queue();
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
      stopTimer.current = window.setTimeout(() => {
        stopTimer.current = null;
        previous.current = null;
        if (out.vx === 0 && out.vy === 0) return;
        out.vx = 0;
        out.vy = 0;
        queue();
      }, STOP_AFTER_MS);
    },
    [queue, stageRef],
  );

  const leave = useCallback(() => {
    const out = state.current;
    previous.current = null;
    if (out.hover !== null) setHover(null);
    if (out.gone) return;
    out.vx = 0;
    out.vy = 0;
    out.hover = null;
    out.gone = true;
    queue();
  }, [queue]);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // A finger lifted has nothing under it any more; a mouse is still there.
      if (event.pointerType !== "mouse") leave();
    },
    [leave],
  );

  return { hover, handlers: { onPointerMove: track, onPointerDown: track, onPointerUp, onPointerLeave: leave, onPointerCancel: leave } };
}

// ── Receiving and drawing ───────────────────────────────────────────────────
type Remote = {
  sample: CursorSample;
  arrived: number;
  drawX: number;
  drawY: number;
  velX: number;
  velY: number;
  visible: boolean;
};

/** Everyone else's pointers from `mj-cursor:{id}`, with the talent each is over (for highlighting cards). */
export function useCursorFeed(channel: string | null, mySeat: SeatIndex | null) {
  const remotes = useRef(new Map<number, Remote>());
  const [seats, setSeats] = useState<number[]>([]);
  const [hovers, setHovers] = useState<Record<number, string | null>>({});

  const onMessage = useCallback(
    (payload: GamesPayload) => {
      if (payload.type !== "mj-cursors") return;
      const list = (payload as unknown as CursorPush).cursors;
      if (!Array.isArray(list)) return;
      const now = performance.now();
      let added = false;
      const hoverChanges: Record<number, string | null> = {};
      for (const sample of list) {
        if (!sample || sample.seat === mySeat || typeof sample.x !== "number" || typeof sample.y !== "number") continue;
        const known = remotes.current.get(sample.seat);
        if (!known) added = true;
        if ((known?.sample.hover ?? null) !== (sample.gone ? null : sample.hover)) hoverChanges[sample.seat] = sample.gone ? null : sample.hover;
        remotes.current.set(sample.seat, {
          sample: sample.gone ? { ...sample, hover: null } : sample,
          arrived: now,
          drawX: known?.drawX ?? sample.x,
          drawY: known?.drawY ?? sample.y,
          velX: known?.velX ?? 0,
          velY: known?.velY ?? 0,
          visible: known?.visible ?? false,
        });
      }
      if (added) setSeats([...remotes.current.keys()].sort());
      if (Object.keys(hoverChanges).length) setHovers((before) => ({ ...before, ...hoverChanges }));
    },
    [mySeat],
  );
  useGamesEvents(channel, onMessage);

  // Hovers go stale with the pointer: a talent stays lit no longer than its pointer is shown.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const stale: Record<number, null> = {};
      remotes.current.forEach((remote, seat) => {
        if (remote.sample.hover && now - remote.arrived > IDLE_FADE_MS) stale[seat] = null;
      });
      if (Object.keys(stale).length) {
        remotes.current.forEach((remote, seat) => {
          if (seat in stale) remote.sample = { ...remote.sample, hover: null };
        });
        setHovers((before) => ({ ...before, ...stale }));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return { remotes, seats, hovers };
}

export type CursorLabel = { seat: number; name: string };

/** Draws the other players' pointers over the stage. The positions are written straight to the DOM each frame. */
export function CursorLayer({ remotes, labels }: { remotes: RefObject<Map<number, Remote>>; labels: CursorLabel[] }) {
  const layer = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const size = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const measure = () => {
      size.current = { width: element.clientWidth, height: element.clientHeight };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000));
      last = now;
      const { width, height } = size.current;
      remotes.current?.forEach((remote, seat) => {
        const node = nodes.current.get(seat);
        if (!node) return;
        const { sample } = remote;
        const age = now - remote.arrived;
        const ahead = Math.min(PREDICT_CAP_S, age / 1000);
        const targetX = clamp01(sample.x + sample.vx * ahead);
        const targetY = clamp01(sample.y + sample.vy * ahead);
        if (!remote.visible || Math.hypot(targetX - remote.drawX, targetY - remote.drawY) > SNAP_DISTANCE) {
          remote.drawX = targetX;
          remote.drawY = targetY;
          remote.velX = 0;
          remote.velY = 0;
        } else {
          [remote.drawX, remote.velX] = smoothDamp(remote.drawX, targetX, remote.velX, SMOOTH_TIME_S, dt);
          [remote.drawY, remote.velY] = smoothDamp(remote.drawY, targetY, remote.velY, SMOOTH_TIME_S, dt);
        }
        const fade = sample.gone ? Math.max(0, 1 - age / 200) : age <= IDLE_FADE_MS ? 1 : Math.max(0, 1 - (age - IDLE_FADE_MS) / FADE_MS);
        remote.visible = fade > 0;
        node.style.opacity = String(fade);
        node.style.transform = `translate3d(${(remote.drawX * width).toFixed(1)}px, ${(remote.drawY * height).toFixed(1)}px, 0)`;
      });
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [remotes]);

  return (
    <div ref={layer} className={styles.cursorLayer} aria-hidden="true">
      {labels.map((label) => (
        <div
          key={label.seat}
          ref={(node) => {
            if (node) nodes.current.set(label.seat, node);
            else nodes.current.delete(label.seat);
          }}
          className={styles.cursor}
          data-seat={label.seat}
          style={{ opacity: 0 } as CSSProperties}
        >
          <svg viewBox="0 0 16 20" width="16" height="20">
            <path d="M1 1 L1 16 L5 12.5 L8 19 L10.6 17.8 L7.7 11.4 L13 11.2 Z" />
          </svg>
          <span>{label.name}</span>
        </div>
      ))}
    </div>
  );
}
