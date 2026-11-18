"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiErrorCode, rateLimitedMessage } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import { sendFeedback } from "@/app/lib/games/mahjong/api";
import { DISCORD_URL } from "@/app/lib/games/mahjong/links";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/feedback/feedback.module.scss";

export const FEEDBACK_MAX = 2000;

export type FeedbackProps = {
  /** The table being played or watched, sent along so staff can see which one. */
  tableId?: number;
  /** A finished game (a replay or a game-over screen). */
  gameId?: number;
  className?: string;
  label?: string;
};

/** "Send feedback": a button that opens the feedback dialog. Mount it anywhere in the mahjong pages. */
export function FeedbackButton({ tableId, gameId, className, label = "Send feedback" }: FeedbackProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={[styles.trigger, className].filter(Boolean).join(" ")} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <FeedbackDialog tableId={tableId} gameId={gameId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The site's Discord, for bug reports and chatter that don't need to be private. */
export function DiscordLink({ className }: { className?: string }) {
  return (
    <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={[styles.trigger, className].filter(Boolean).join(" ")}>
      Discord
    </a>
  );
}

function errorText(reason: unknown): string {
  const code = apiErrorCode(reason);
  if (code === "rate_limited") return rateLimitedMessage((reason as { body?: { retry_after?: unknown } | null })?.body?.retry_after ?? 600);
  if (code === "invalid_feedback") return `Write something between 1 and ${fmtInteger(FEEDBACK_MAX)} characters.`;
  return gameErrorText(reason);
}

export function FeedbackDialog({ tableId, gameId, onClose }: { tableId?: number; gameId?: number; onClose: () => void }) {
  const { user, initialized } = useAuth();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({
        body: message.trim(),
        page: window.location.pathname.slice(0, 200),
        ...(typeof tableId === "number" ? { table_id: tableId } : {}),
        ...(typeof gameId === "number" ? { game_id: gameId } : {}),
      });
      setSent(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const ready = message.trim().length >= 1 && message.length <= FEEDBACK_MAX;
  const signedIn = Boolean(user);

  return createPortal(
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="mj-feedback-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="mj-feedback-title">Mahjong feedback</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {sent ? (
          <div className={styles.body}>
            <p>Thanks. It goes to the people who build this, and they read every note.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : initialized && !signedIn ? (
          <div className={styles.body}>
            <p>
              <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to send feedback. You can also say it in the{" "}
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                Discord
              </a>
              .
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            className={styles.body}
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !busy) void send();
            }}
          >
            <label>
              <span className={styles.label}>What should we know?</span>
              <textarea
                ref={field}
                value={message}
                maxLength={FEEDBACK_MAX}
                rows={6}
                placeholder="Something confusing, broken or missing, or something you liked."
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <div className={styles.meta}>
              <small className={styles.fine}>Sent with your username and this page{tableId !== undefined ? ", and the table" : gameId !== undefined ? ", and the game" : ""}.</small>
              <small className={styles.count} data-near={message.length > FEEDBACK_MAX - 100 || undefined}>
                {fmtInteger(message.length)} / {fmtInteger(FEEDBACK_MAX)}
              </small>
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={styles.primary} disabled={!ready || busy}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
