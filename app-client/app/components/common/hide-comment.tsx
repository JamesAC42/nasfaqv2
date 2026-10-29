"use client";

import { useState } from "react";
import { moderationErrorText, setCommentHidden, type CommentKind } from "@/app/lib/moderation";
import { useAuthStore } from "@/app/stores/auth-store";
import styles from "@/app/components/common/hide-comment.module.scss";

type Hidden = { hidden_at: string | null; hidden_reason: string | null };

/** Dims a comment an admin hid (only admins get hidden comments back from the API). */
export const hiddenCommentStyle = (comment: Hidden) => (comment.hidden_at ? { opacity: 0.55 } : undefined);

/**
 * Admins only: Hide (with an optional reason for the log) or Unhide a stock board, article or
 * prediction comment. Hidden comments are gone for everyone else; admins still see them, marked.
 */
export function HideComment({ kind, comment, onChange }: { kind: CommentKind; comment: { id: number } & Hidden; onChange: (next: Hidden) => void }) {
  const isAdmin = useAuthStore((state) => Boolean(state.user?.is_admin));
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isAdmin) return null;

  const save = async (hidden: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setCommentHidden(kind, comment.id, hidden, reason);
      onChange({ hidden_at: result.comment.hidden_at, hidden_reason: result.comment.hidden_reason });
      setAsking(false);
      setReason("");
    } catch (caught) {
      setError(moderationErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={styles.wrap}>
      {comment.hidden_at ? (
        <>
          <span className={styles.tag} title={comment.hidden_reason ?? undefined}>
            Hidden{comment.hidden_reason ? `: ${comment.hidden_reason}` : ""}
          </span>
          <button type="button" className={styles.btn} disabled={busy} onClick={() => void save(false)}>
            {busy ? "…" : "Unhide"}
          </button>
        </>
      ) : asking ? (
        <form
          className={styles.ask}
          onSubmit={(event) => {
            event.preventDefault();
            void save(true);
          }}
        >
          <input value={reason} maxLength={280} placeholder="Why (optional)" aria-label="Why hide it" onChange={(event) => setReason(event.target.value)} autoFocus />
          <button type="submit" className={styles.btn} data-danger disabled={busy}>
            {busy ? "…" : "Hide"}
          </button>
          <button type="button" className={styles.btn} onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className={styles.btn} title="Hide this comment from everyone but admins" onClick={() => setAsking(true)}>
          Hide
        </button>
      )}
      {error ? <span className={styles.error}>{error}</span> : null}
    </span>
  );
}
