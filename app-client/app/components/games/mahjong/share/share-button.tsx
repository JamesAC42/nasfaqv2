"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheck, FiDownload, FiImage, FiLink, FiShare2, FiX } from "react-icons/fi";
import { useReferralCode } from "@/app/lib/use-referral-code";
import styles from "@/app/components/games/share/share-moment.module.scss";

type ShareProps = {
  /** Dialog title and the post text. */
  title: string;
  text: string;
  /** The card image, a path on this site. */
  cardPath: string;
  /** The page to link, built with the sharer's referral code when there is one. */
  linkFor: (referralCode: string | null) => string;
  label?: string;
  className?: string;
};

type Copied = "image" | "link" | null;

/** Share button for a replay hand, a game result or a tournament: opens a sheet with the card and ways to take it elsewhere. */
export function MahjongShareButton({ label = "Share", className, ...props }: ShareProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <FiShare2 aria-hidden="true" /> {label}
      </button>
      {open ? <ShareSheet {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ShareSheet({ title, text, cardPath, linkFor, onClose }: ShareProps & { onClose: () => void }) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const referralCode = useReferralCode();
  const link = `${origin}${linkFor(referralCode)}`;
  const canCopyImage = typeof window !== "undefined" && typeof window.ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    // The link needs the real origin, known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  const flash = useCallback((what: Copied) => {
    setCopied(what);
    setProblem(null);
    window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 1800);
  }, []);

  async function copyImage() {
    try {
      const blob = fetch(cardPath).then((response) => {
        if (!response.ok) throw new Error("card");
        return response.blob();
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("image");
    } catch {
      setProblem("Couldn’t copy the picture here. Save it instead.");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      flash("link");
    } catch {
      setProblem("Couldn’t copy. The link is in the box below.");
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url: link });
    } catch {
      // Closing the share sheet counts as an error; nothing to say.
    }
  }

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className={styles.head}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <FiX aria-hidden="true" />
          </button>
        </header>
        <div className={styles.preview} data-loaded={loaded || undefined}>
          {failed ? (
            <p className={styles.failed}>The picture didn’t load. Try again in a moment.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardPath} width={1200} height={630} alt={text} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" data-autofocus onClick={() => void copyLink()}>
            {copied === "link" ? <FiCheck aria-hidden="true" /> : <FiLink aria-hidden="true" />}
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          <a href={`${cardPath}${cardPath.includes("?") ? "&" : "?"}download`} download>
            <FiDownload aria-hidden="true" /> Save image
          </a>
          <button type="button" onClick={() => void copyImage()} disabled={!canCopyImage || failed} title={canCopyImage ? undefined : "This browser can’t copy pictures; save it instead"}>
            {copied === "image" ? <FiCheck aria-hidden="true" /> : <FiImage aria-hidden="true" />}
            {copied === "image" ? "Copied" : "Copy image"}
          </button>
          {canShare ? (
            <button type="button" onClick={() => void nativeShare()}>
              <FiShare2 aria-hidden="true" /> Share…
            </button>
          ) : null}
        </div>
        <p className={styles.hint} aria-live="polite">
          {problem ?? (referralCode ? "The link unfurls with this card, and anyone who signs up from it counts as your referral." : "The link unfurls with this card.")}
        </p>
        <input className={styles.linkBox} readOnly value={link} aria-label="Link" onFocus={(event) => event.currentTarget.select()} />
      </div>
    </div>,
    document.body,
  );
}
