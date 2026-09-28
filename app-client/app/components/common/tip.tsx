"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { glossaryEntry } from "@/app/lib/glossary";
import styles from "@/app/components/common/tip.module.scss";

type TipProps = {
  /** What the bubble says. */
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Dotted underline on the trigger (default), so players can tell it explains something. */
  underline?: boolean;
  /** Preferred side; flips when there isn't room. */
  side?: "top" | "bottom";
};

const OPEN_DELAY = 120;
const CLOSE_DELAY = 140;
const GAP = 8;
const MARGIN = 8;
const HIDDEN: CSSProperties = { left: 0, top: 0, visibility: "hidden" };

/**
 * The site's one tooltip. Wraps a short inline label (a column header, a stat name, a word in a
 * sentence) and explains it in a small bubble: on hover after a beat, on keyboard focus, and on tap
 * for touch screens (tap again or anywhere else to close). The bubble is portalled to the body so
 * no overflow clips it, sits above or below the label, and stays inside the viewport. Escape and
 * scrolling close it. Use <Term> for glossary words; use Tip directly for one-off explanations.
 */
export function Tip({ content, children, className, underline = true, side = "top" }: TipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback((delay = OPEN_DELAY) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback((delay = CLOSE_DELAY) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(false), delay);
  }, []);

  useEffect(() => () => clear(), []);

  // Place the bubble once it's rendered (it needs its own size); written straight to its style so
  // the first painted frame is already in place.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const roomAbove = trigger.top - GAP - MARGIN;
    const roomBelow = window.innerHeight - trigger.bottom - GAP - MARGIN;
    const goBelow = side === "bottom" ? roomBelow >= height || roomBelow >= roomAbove : roomAbove < height && roomBelow > roomAbove;
    const left = Math.min(Math.max(MARGIN, trigger.left + trigger.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    const top = goBelow ? trigger.bottom + GAP : trigger.top - GAP - height;
    const arrow = Math.min(Math.max(12, trigger.left + trigger.width / 2 - left), width - 12);
    bubble.dataset.side = goBelow ? "bottom" : "top";
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty("--arrow", `${arrow}px`);
    bubble.style.visibility = "visible";
  }, [open, side]);

  // Escape, scrolling and taps elsewhere close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide(0);
    };
    const onScroll = () => hide(0);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !bubbleRef.current?.contains(target)) hide(0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`${styles.trigger} ${underline ? styles.underline : ""} ${className ?? ""}`}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        data-open={open || undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") show();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") hide();
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") {
            if (open) hide(0);
            else show(0);
          }
        }}
        onFocus={() => show(0)}
        onBlur={(event) => {
          if (!bubbleRef.current?.contains(event.relatedTarget as Node | null)) hide();
        }}
      >
        {children}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={bubbleRef}
              id={id}
              role="tooltip"
              className={styles.bubble}
              data-side={side}
              style={HIDDEN}
              onPointerEnter={() => clear()}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") hide();
              }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * A glossary word with its definition in a tooltip, e.g. <Term k="float">Float</Term>. The text
 * defaults to the glossary's own term. Unknown keys render the plain text (and warn in dev).
 */
export function Term({ k, children, className, side }: { k: string; children?: ReactNode; className?: string; side?: "top" | "bottom" }) {
  const entry = glossaryEntry(k);
  if (!entry) {
    if (process.env.NODE_ENV !== "production") console.warn(`Term: no glossary entry "${k}"`);
    return <>{children ?? k}</>;
  }
  return (
    <Tip
      className={className}
      side={side}
      content={
        <>
          <b className={styles.term}>{entry.term}</b>
          <span>{entry.def}</span>
          <Link className={styles.more} href={`/how-to-play#term-${entry.key}`}>
            Glossary →
          </Link>
        </>
      }
    >
      {children ?? entry.term}
    </Tip>
  );
}
