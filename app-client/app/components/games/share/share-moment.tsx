"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaXTwitter } from "react-icons/fa6";
import { FiCheck, FiDownload, FiImage, FiLink, FiShare2, FiX } from "react-icons/fi";
import { momentCardPath, momentPath, type MomentKind } from "@/app/lib/games/moments";
import { useReferralCode } from "@/app/lib/use-referral-code";
import styles from "@/app/components/games/share/share-moment.module.scss";

type ShareMomentProps = {
  kind: MomentKind;
  id: string;
  /** The talent the player just saw react; the card uses it when they have no oshi. */
  talent?: string | null;
  /** Text for the post (X) and the dialog title. */
  text: string;
  label?: string;
  /** Icon-only button (history rows). */
  compact?: boolean;
  className?: string;
};

/** What a share sheet shows: one moment, plus the talent and post text the button was given. */
export type ShareTarget = { kind: MomentKind; id: string; talent?: string | null; text: string };

type Copied = "image" | "link" | null;

/**
 * Share button for a game moment: opens a sheet with the 1200×630 share card and ways to take it
 * elsewhere (copy the picture, save it, copy the link, post on X). The link unfurls with the card.
 *
 * Where the button can vanish while the sheet is open (a blackjack result banner gives way to the
 * next round), pass `onOpen` and render `<ShareSheet>` from a parent that stays mounted.
 */
export function ShareMoment({ kind, id, talent, text, label = "Share", compact = false, className, onOpen }: ShareMomentProps & { onOpen?: (target: ShareTarget) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={[compact ? styles.iconButton : styles.button, className].filter(Boolean).join(" ")}
        onClick={() => (onOpen ? onOpen({ kind, id, talent, text }) : setOpen(true))}
        aria-label={compact ? `${label}: ${text}` : undefined}
        title={compact ? label : undefined}
      >
        <FiShare2 aria-hidden="true" />
        {compact ? null : <span>{label}</span>}
      </button>
      {open ? <ShareSheet kind={kind} id={id} talent={talent} text={text} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ShareSheet({ kind, id, talent, text, onClose }: ShareTarget & { onClose: () => void }) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The latest onClose without re-running the focus effect: parents re-render many times a second
  // (table clocks), and each re-run would pull focus back to the first button.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const cardPath = momentCardPath(kind, id, talent);
  // The link carries the sharer's referral code, so a sign-up from it counts for them.
  const referralCode = useReferralCode();
  const link = `${origin}${momentPath(kind, id, talent, referralCode)}`;
  const canCopyImage = typeof window !== "undefined" && typeof window.ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

  useEffect(() => {
    // The link needs the real origin, known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  // Modal on top of whatever is open (the gacha reveal included): our keys win, focus stays here.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const nodes = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') ?? []);
        if (!nodes.length) return;
        event.stopPropagation();
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!sheetRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const flash = useCallback((what: Copied) => {
    setCopied(what);
    setCopyError(null);
    window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 1800);
  }, []);

  async function copyImage() {
    try {
      // Safari wants the ClipboardItem created inside the click, with the blob still loading.
      const blob = fetch(cardPath).then((response) => {
        if (!response.ok) throw new Error("card");
        return response.blob();
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("image");
    } catch {
      setCopyError("Couldn't copy the picture here. Save it instead.");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      flash("link");
    } catch {
      setCopyError("Couldn't copy. The link is in the box below.");
    }
  }

  const post = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className={styles.head}>
          <h2 id={titleId}>Share this moment</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <FiX aria-hidden="true" />
          </button>
        </header>
        <div className={styles.preview} data-loaded={loaded || undefined}>
          {failed ? (
            <p className={styles.failed}>The picture didn&apos;t load. Try again in a moment.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardPath} width={1200} height={630} alt={text} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" data-autofocus onClick={() => void copyImage()} disabled={!canCopyImage || failed} title={canCopyImage ? undefined : "This browser can't copy pictures; save it instead"}>
            {copied === "image" ? <FiCheck aria-hidden="true" /> : <FiImage aria-hidden="true" />}
            {copied === "image" ? "Copied" : "Copy image"}
          </button>
          <a href={`${cardPath}${cardPath.includes("?") ? "&" : "?"}download`} download>
            <FiDownload aria-hidden="true" /> Save
          </a>
          <button type="button" onClick={() => void copyLink()}>
            {copied === "link" ? <FiCheck aria-hidden="true" /> : <FiLink aria-hidden="true" />}
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          <a href={post} target="_blank" rel="noopener noreferrer">
            <FaXTwitter aria-hidden="true" /> Post on X
          </a>
        </div>
        <p className={styles.hint} aria-live="polite">
          {copyError ??
            (referralCode
              ? "Paste the picture into Discord or X, or post the link: it unfurls with this card, and anyone who signs up from it counts as your referral."
              : "Paste the picture into Discord or X, or post the link: it unfurls with this card.")}
        </p>
        <input className={styles.linkBox} readOnly value={link} aria-label="Moment link" onFocus={(event) => event.currentTarget.select()} />
      </div>
    </div>,
    document.body,
  );
}
