"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { announceKeepClear, bottomInset, clamp, FLOAT_MARGIN, readOffset, saveOffset, type Offset } from "@/app/lib/floating";
import { useOpenStream, useStreamStore, type PlayingStream } from "@/app/stores/stream-store";
import styles from "@/app/components/livestreams/stream-dock.module.scss";

// The one YouTube player on the site, mounted at the app root so it outlives page changes. While
// the stream's sheet is open it sits exactly over the sheet's video slot (and is clipped to the
// sheet's scroll area); once the sheet closes it floats in a corner as a miniplayer you can drag
// around. The iframe never moves in the DOM, so switching between the two doesn't reload it.

const POSITION_KEY = "nasfaq.miniplayer";
const MARGIN = FLOAT_MARGIN;

/** Mounted once at the app root. */
export function StreamDock() {
  const playing = useStreamStore((state) => state.playing);
  // A new stream gets a new player.
  return playing ? <Dock key={playing.id} playing={playing} /> : null;
}

function Dock({ playing }: { playing: PlayingStream }) {
  const box = useRef<HTMLDivElement | null>(null);
  const offset = useRef<Offset | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = useStreamStore((state) => state.stop);
  const openStream = useOpenStream();

  /** Miniplayer: back to its saved spot, kept inside the window and above the bottom nav. */
  const placeMini = useCallback(() => {
    const el = box.current;
    if (!el) return;
    Object.assign(el.style, { width: "", height: "", clipPath: "" });
    offset.current ??= readOffset(POSITION_KEY);
    const { right, bottom } = offset.current ?? { right: MARGIN, bottom: MARGIN };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = clamp(window.innerWidth - w - right, MARGIN, window.innerWidth - w - MARGIN);
    const top = clamp(window.innerHeight - h - bottom, MARGIN, window.innerHeight - h - MARGIN - bottomInset());
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, visibility: "visible" });
    // The chat window keeps clear of the miniplayer (data-keep-clear below).
    announceKeepClear();
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (playing.mini) {
      placeMini();
      window.addEventListener("resize", placeMini);
      return () => window.removeEventListener("resize", placeMini);
    }
    // In the sheet: follow the video slot every frame (the sheet slides in, scrolls and resizes),
    // showing only the part inside the sheet's scroll area, below its sticky top bar.
    let frame = 0;
    const track = () => {
      const slot = document.querySelector<HTMLElement>(`[data-stream-slot="${CSS.escape(playing.id)}"]`);
      if (!slot) {
        el.style.visibility = "hidden";
        return;
      }
      const s = slot.getBoundingClientRect();
      const sheet = slot.closest<HTMLElement>("[data-stream-sheet]");
      const area = sheet?.getBoundingClientRect() ?? s;
      const barBottom = sheet?.querySelector<HTMLElement>("[data-stream-sheet-top]")?.getBoundingClientRect().bottom ?? area.top;
      const top = Math.max(s.top, area.top, barBottom);
      const bottom = Math.min(s.bottom, area.bottom);
      const left = Math.max(s.left, area.left);
      const right = Math.min(s.right, area.right);
      Object.assign(el.style, { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px`, height: `${s.height}px` });
      if (bottom <= top || right <= left) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.clipPath = `inset(${top - s.top}px ${s.right - right}px ${s.bottom - bottom}px ${left - s.left}px)`;
      el.style.visibility = "visible";
    };
    const loop = () => {
      track();
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [playing.mini, playing.id, placeMini]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (moved: PointerEvent) => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${clamp(moved.clientX - dx, MARGIN, window.innerWidth - w - MARGIN)}px`;
      el.style.top = `${clamp(moved.clientY - dy, MARGIN, window.innerHeight - h - MARGIN - bottomInset())}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(false);
      const placed = el.getBoundingClientRect();
      offset.current = { right: window.innerWidth - placed.right, bottom: window.innerHeight - placed.bottom };
      saveOffset(POSITION_KEY, offset.current);
      announceKeepClear();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const expand = () => {
    const known = useStreamStore.getState().previews[playing.id];
    openStream(known ?? { id: playing.id, title: playing.title, creator: "", status: playing.live ? "live" : "ended" });
  };

  return (
    <div
      ref={box}
      className={`${styles.dock} ${dragging ? styles.dragging : ""}`}
      data-mode={playing.mini ? "mini" : "sheet"}
      data-keep-clear={playing.mini ? "" : undefined}
      style={{ "--tal": playing.accent ?? undefined } as CSSProperties}
      role={playing.mini ? "region" : undefined}
      aria-label={playing.mini ? `Miniplayer: ${playing.title}` : undefined}
    >
      {/* Rendered (or not) ahead of the screen without shifting it, so the iframe stays put. */}
      {playing.mini ? (
        <div className={styles.bar} onPointerDown={startDrag} title="Drag to move">
          {playing.live ? <i className={styles.live} aria-label="Live" /> : null}
          <span className={styles.title}>{playing.title}</span>
          <button type="button" onClick={expand} aria-label="Open the stream's panel" title="Open the stream's panel">
            ⤢
          </button>
          <button type="button" onClick={stop} aria-label="Close the miniplayer" title="Close">
            ✕
          </button>
        </div>
      ) : null}
      <div className={styles.screen}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(playing.id)}?autoplay=1&rel=0`}
          title={playing.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  );
}
