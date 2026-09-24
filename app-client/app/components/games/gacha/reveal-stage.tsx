"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";
import { isCalm } from "@/app/providers/motion-provider";
import styles from "@/app/components/games/gacha/reveal-stage.module.scss";

// The pull reveal: a full-screen stage over the page. Cards (or capsules) arrive face down with a
// rarity glow on the back, flip on tap/space, and the top rarities get a moment (flash, slam,
// burst, the card landing big) before joining the grid. Used by the card gacha and the capsule.

export type RevealTag = { text: string; tone: "new" | "stars" | "shards" | "featured" | "plain" };

export type RevealMoment = {
  /** Slam text, e.g. "SSR!" or "UR!!". */
  label: string;
  /** Flash / burst colour. */
  color: string;
  /** The top tier: a double flash and a bigger burst. */
  big?: boolean;
  /** Rainbow holo flash, burst and text (UR). */
  holo?: boolean;
};

export type RevealItem = {
  id: string;
  /** Higher is better. Picks the best pull and the stage aura. */
  rank: number;
  /** Aura / hint colour for this item (null for the lowest tier). */
  glow: string | null;
  moment: RevealMoment | null;
  /** Read out when revealed: "Ayunda Risu, SSR, new". */
  label: string;
  /** Short name for the summary. */
  name: string;
  /** Rarity chip text for the summary ("SSR", "EPIC"). */
  tier: string;
  face: (width: number) => ReactNode;
  back: (width: number) => ReactNode;
  tags: RevealTag[];
};

export type RevealStat = { label: string; value: ReactNode; tone?: "new" | "shards" | "plain" };

type RevealStageProps = {
  /** Changes for every new batch; resets the stage. */
  batchKey: string | null;
  items: RevealItem[];
  /** "10-PULL · Ayunda Risu week" */
  title: string;
  stats: RevealStat[];
  againLabel: string;
  onAgain: () => void;
  againBusy: boolean;
  againError: string | null;
  onClose: () => void;
  /** Extra summary content, e.g. a link to the locker. */
  extra?: ReactNode;
};

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function RevealStage(props: RevealStageProps) {
  const mounted = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
  if (!mounted || !props.batchKey) return null;
  return createPortal(<Stage key={props.batchKey} {...props} />, document.body);
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function useFieldSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 1024, h: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function Stage({ items, title, stats, againLabel, onAgain, againBusy, againError, onClose, extra }: RevealStageProps) {
  const [calm] = useState(isCalm);
  const count = items.length;
  const [flipped, setFlipped] = useState<boolean[]>(() => items.map(() => calm));
  const [charging, setCharging] = useState<number | null>(null);
  const [moment, setMoment] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [announce, setAnnounce] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const field = useFieldSize(fieldRef);

  const done = flipped.every(Boolean) && moment === null && charging === null;
  const revealed = flipped.filter(Boolean).length;

  const best = useMemo(() => items.reduce<RevealItem | null>((top, item) => (!top || item.rank > top.rank ? item : top), null), [items]);
  const aura = best?.glow ?? null;
  const auraBig = Boolean(best?.moment?.holo);

  // ── Sizes ──
  const single = count === 1;
  const phone = field.w < 640;
  const cols = single ? 1 : phone ? (field.w < 360 ? 2 : 3) : 5;
  const gap = phone ? 10 : 18;
  const tagRow = 30;
  let cardW: number;
  if (single) {
    cardW = Math.min(300, field.w * 0.72, ((field.h - tagRow - 24) * 5) / 7);
  } else {
    cardW = Math.min(184, (field.w - (cols - 1) * gap - 8) / cols);
    if (!phone) cardW = Math.min(cardW, (((field.h - gap - tagRow * 2 - 24) / 2) * 5) / 7);
  }
  cardW = Math.max(80, Math.floor(cardW));
  const viewW = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewH = typeof window === "undefined" ? 768 : window.innerHeight;
  const bigW = Math.floor(Math.max(150, Math.min(340, viewW * 0.72, ((viewH - 250) * 5) / 7)));

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const refocus = useCallback(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !dialogRef.current?.contains(active)) dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const flip = useCallback(
    (index: number) => {
      if (flipped[index] || charging !== null || moment !== null) return;
      const item = items[index];
      if (item.moment) {
        setCharging(index);
        later(() => {
          setFlipped((prev) => prev.map((value, i) => (i === index ? true : value)));
          setCharging(null);
          setMoment(index);
          setAnnounce(`${item.moment?.label} ${item.label}`);
        }, 520);
      } else {
        setFlipped((prev) => prev.map((value, i) => (i === index ? true : value)));
        setAnnounce(item.label);
        later(refocus, 0);
      }
    },
    [flipped, charging, moment, items, later, refocus],
  );

  const flipNext = useCallback(() => {
    const next = flipped.findIndex((value) => !value);
    if (next >= 0) flip(next);
  }, [flipped, flip]);

  const dismissMoment = useCallback(() => {
    setMoment(null);
    later(refocus, 0);
  }, [later, refocus]);

  const skip = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setAuto(false);
    setCharging(null);
    setMoment(null);
    setFlipped(items.map(() => true));
    setAnnounce("All revealed.");
  }, [items]);

  // "Reveal all": flip the rest in order; moments still stop the chain until tapped.
  useEffect(() => {
    if (!auto || charging !== null || moment !== null) return;
    const next = flipped.findIndex((value) => !value);
    if (next < 0) return;
    const id = window.setTimeout(() => flip(next), 110);
    return () => window.clearTimeout(id);
  }, [auto, charging, moment, flipped, flip]);

  const doneRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!done) return;
    doneRef.current?.focus({ preventScroll: true });
  }, [done, best]);

  // ── Focus, keys, scroll lock ──
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        event.preventDefault();
        if (done) onClose();
        else skip();
        return;
      }
      if (event.key === "Tab") {
        const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((node) => node.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        if (target && (target.tagName === "BUTTON" || target.tagName === "A")) return;
        event.preventDefault();
        if (moment !== null) dismissMoment();
        else if (!done) flipNext();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [done, moment, onClose, skip, flipNext, dismissMoment]);

  const momentItem = moment !== null ? items[moment] : null;

  return (
    <div
      ref={dialogRef}
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} reveal`}
      tabIndex={-1}
      data-aura={aura ? "on" : undefined}
      data-aura-big={auraBig || undefined}
      data-calm={calm || undefined}
      style={{ "--aura": aura ?? "#3fb8f5" } as CSSProperties}
    >
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.rays} />
        <span className={styles.floor} />
      </div>

      <header className={styles.bar}>
        <div className={styles.barTitle}>
          <b>{title}</b>
          <span>
            {revealed}/{count}
          </span>
        </div>
        <div className={styles.barActions}>
          {!done ? (
            <>
              {count > 1 ? (
                <button type="button" className={styles.ghostButton} onClick={() => setAuto(true)} disabled={auto}>
                  Reveal all
                </button>
              ) : null}
              <button type="button" className={styles.ghostButton} onClick={skip}>
                Skip <kbd>Esc</kbd>
              </button>
            </>
          ) : (
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
              <FiX aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div ref={fieldRef} className={styles.field} data-single={single || undefined}>
        <div className={styles.grid} style={{ "--cols": cols, "--gap": `${gap}px`, "--cw": `${cardW}px` } as CSSProperties}>
          {items.map((item, index) => {
            const isFlipped = flipped[index];
            return (
              <div
                key={item.id}
                className={styles.slot}
                data-flipped={isFlipped || undefined}
                data-charging={charging === index || undefined}
                data-high={item.moment ? (item.moment.big ? "big" : "yes") : undefined}
                data-glow={item.glow ? "on" : undefined}
                style={{ "--i": index, "--glow": item.glow ?? "transparent", "--w": `${cardW}px` } as CSSProperties}
              >
                <div className={styles.cardBox}>
                  <span className={styles.halo} aria-hidden="true" />
                  <div className={styles.flipper}>
                    <div className={`${styles.side} ${styles.back}`} aria-hidden="true">
                      {item.back(cardW)}
                    </div>
                    <div className={`${styles.side} ${styles.front}`} aria-hidden={!isFlipped}>
                      {item.face(cardW)}
                    </div>
                  </div>
                  {!isFlipped ? (
                    <button
                      type="button"
                      className={styles.hit}
                      onClick={() => flip(index)}
                      aria-label={`Flip ${count > 1 ? `card ${index + 1} of ${count}` : "your card"}`}
                    />
                  ) : null}
                </div>
                <div className={styles.tags} aria-hidden={!isFlipped}>
                  {isFlipped
                    ? item.tags.map((tag) => (
                        <span key={tag.text} data-tone={tag.tone}>
                          {tag.text}
                        </span>
                      ))
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className={styles.foot}>
        {done ? (
          <div className={styles.summary}>
            <div className={styles.best}>
              {best ? (
                <>
                  <span className={styles.bestCard}>{best.face(58)}</span>
                  <span className={styles.bestText}>
                    <small>Best pull</small>
                    <b>{best.name}</b>
                    <em style={{ "--c": best.glow ?? "var(--mid)" } as CSSProperties}>{best.tier}</em>
                  </span>
                </>
              ) : null}
            </div>
            <dl className={styles.stats}>
              {stats.map((stat) => (
                <div key={stat.label} data-tone={stat.tone ?? "plain"}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.summaryActions}>
              {extra}
              <button type="button" className={styles.againButton} onClick={onAgain} disabled={againBusy}>
                {againBusy ? "Pulling…" : againLabel}
              </button>
              <button ref={doneRef} type="button" className={styles.doneButton} onClick={onClose}>
                Done
              </button>
              {againError ? (
                <p className={styles.error} role="alert">
                  {againError}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className={styles.hint}>
            {single ? "Tap the card to flip it" : "Tap a card to flip it"}
            <span>
              <kbd>Space</kbd> flips the next
            </span>
          </p>
        )}
      </footer>

      {momentItem && momentItem.moment ? (
        <div
          className={styles.moment}
          data-big={momentItem.moment.big || undefined}
          data-holo={momentItem.moment.holo || undefined}
          style={{ "--m": momentItem.moment.color } as CSSProperties}
          onClick={dismissMoment}
          role="presentation"
        >
          <span className={styles.flash} aria-hidden="true" />
          <span className={styles.burst} aria-hidden="true" />
          <span className={styles.ring} aria-hidden="true" />
          <div className={styles.momentBody}>
            <p className={styles.slam} aria-hidden="true" data-long={momentItem.moment.label.length > 5 || undefined}>
              {momentItem.moment.label}
            </p>
            <div className={styles.bigCard}>{momentItem.face(bigW)}</div>
            <div className={styles.momentTags}>
              {momentItem.tags.map((tag) => (
                <span key={tag.text} data-tone={tag.tone}>
                  {tag.text}
                </span>
              ))}
            </div>
            <button type="button" className={styles.continue} onClick={dismissMoment} autoFocus>
              Tap to continue
            </button>
          </div>
        </div>
      ) : null}

      <p className={styles.sr} aria-live="polite" aria-atomic="true">
        {done && best ? `All revealed. Best pull: ${best.label}.` : announce}
      </p>
    </div>
  );
}
