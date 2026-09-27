"use client";

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FaChevronLeft, FaChevronRight, FaXmark } from "react-icons/fa6";
import styles from "@/app/components/games/gallery/lightbox.module.scss";

// Full-screen viewer for unlocked gallery art: ← → and Esc on a keyboard, swipe on a phone.

export type LightboxItem = {
  key: string;
  /** Primary art ID, shown in development so a missing image is easy to find. */
  artId: string;
  /** Width / height of the piece. */
  aspect: number;
  /** "Ayunda Risu" */
  title: string;
  /** "SSR · Idol" */
  tag: string;
  /** Rarity (or accent) colour for the tag. */
  color: string;
  caption?: string;
  render: (width: number) => ReactNode;
};

type Props = {
  items: LightboxItem[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
};

const noopSubscribe = () => () => {};

export function Lightbox(props: Props) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted || props.index === null || !props.items[props.index]) return null;
  return createPortal(<Viewer {...props} index={props.index} />, document.body);
}

function Viewer({ items, index, onIndex, onClose }: Props & { index: number }) {
  const item = items[index];
  const count = items.length;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  const go = (step: number) => onIndex((index + step + count) % count);
  const goRef = useRef(go);
  const closeCb = useRef(onClose);
  useEffect(() => {
    goRef.current = go;
    closeCb.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCb.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goRef.current(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goRef.current(-1);
      } else if (event.key === "Tab" && rootRef.current) {
        // Keep focus inside the viewer.
        const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse") return;
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
  }

  // Rendered width for srcset: the piece fills up to 92vw or 78vh, whichever binds first.
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.round(Math.min(vw * 0.92, vh * 0.74 * item.aspect, 1400));

  return (
    <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={`${item.title}, ${item.tag}`}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />

      <div className={styles.top}>
        <span className={styles.count}>
          <b>{index + 1}</b> / {count}
        </span>
        <button ref={closeRef} type="button" className={styles.icon} onClick={onClose} aria-label="Close viewer">
          <FaXmark aria-hidden="true" />
        </button>
      </div>

      <div className={styles.stage} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)} onClick={(event) => event.target === event.currentTarget && onClose()}>
        <figure className={styles.figure} key={item.key} style={{ "--ar": item.aspect } as CSSProperties}>
          <div className={styles.piece}>{item.render(width)}</div>
          <figcaption className={styles.caption} aria-live="polite">
            <span className={styles.tag} style={{ "--c": item.color } as CSSProperties}>
              {item.tag}
            </span>
            <b>{item.title}</b>
            {item.caption ? <span className={styles.line}>{item.caption}</span> : null}
          </figcaption>
        </figure>
      </div>

      {count > 1 ? (
        <>
          <button type="button" className={`${styles.icon} ${styles.nav}`} data-dir="prev" onClick={() => go(-1)} aria-label="Previous piece">
            <FaChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className={`${styles.icon} ${styles.nav}`} data-dir="next" onClick={() => go(1)} aria-label="Next piece">
            <FaChevronRight aria-hidden="true" />
          </button>
        </>
      ) : null}

      <p className={styles.hint} aria-hidden="true">
        <kbd>←</kbd> <kbd>→</kbd> browse · <kbd>Esc</kbd> close
      </p>
    </div>
  );
}
