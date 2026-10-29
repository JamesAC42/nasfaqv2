"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeChatMessage } from "@/app/lib/normalizers";
import { MUTE_DURATIONS, REPORT_REASONS, moderationErrorText, removeChatMessage, reportChatMessage, restrictChatUser } from "@/app/lib/moderation";
import type { AuthUser, ChatMessage } from "@/app/lib/types";
import styles from "@/app/components/chat/chat.module.scss";

/**
 * The ⋯ menu on a chat message. Players report someone else's message; admins also remove it, or
 * mute or ban its author from all of chat. Everything an admin does here is logged on
 * /admin/moderation, where the report queue is.
 */
export function MessageMenu({ message, viewer, onUpdated }: { message: ChatMessage; viewer: AuthUser | null; onUpdated: (message: ChatMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report" | "ban">("menu");
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  const author = message.author;
  const own = Boolean(viewer && author && author.id === viewer.id);
  const isAdmin = Boolean(viewer?.is_admin);
  const canReport = Boolean(viewer && !own && !viewer.suspension);

  // Clicking elsewhere or Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (message.status !== "active" || (!canReport && !isAdmin)) return null;

  const toggle = () => {
    setOpen((value) => !value);
    setMode("menu");
    setError(null);
    setDone(null);
  };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      setDone(await work());
      setMode("menu");
    } catch (caught) {
      setError(moderationErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.msgTools} ref={root} data-open={open || undefined}>
      <button type="button" className={styles.msgToolsBtn} aria-haspopup="menu" aria-expanded={open} aria-label="Message actions" onClick={toggle}>
        ⋯
      </button>
      {open ? (
        <div className={styles.msgMenu} role="menu">
          {done ? <p className={styles.msgMenuOk}>{done}</p> : null}
          {error ? <p className={styles.msgMenuErr}>{error}</p> : null}

          {mode === "report" ? (
            <form
              className={styles.msgMenuForm}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await reportChatMessage(message.id, reason, details);
                  setDetails("");
                  return "Reported. An admin will take a look.";
                });
              }}
            >
              <label>
                <span>What&apos;s wrong?</span>
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  {REPORT_REASONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <textarea rows={2} maxLength={1000} value={details} placeholder="Anything else? (optional)" onChange={(event) => setDetails(event.target.value)} />
              <div className={styles.msgMenuRow}>
                <button type="submit" className={styles.msgMenuPrimary} disabled={busy}>
                  {busy ? "Sending…" : "Send report"}
                </button>
                <button type="button" onClick={() => setMode("menu")}>
                  Back
                </button>
              </div>
            </form>
          ) : mode === "ban" && author ? (
            <div className={styles.msgMenuForm}>
              <p>
                Ban <b>{author.username}</b> from all of chat until an admin lifts it?
              </p>
              <div className={styles.msgMenuRow}>
                <button
                  type="button"
                  className={styles.msgMenuDanger}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await restrictChatUser(author.id, "ban", { reason: note });
                      return `${author.username} is banned from chat.`;
                    })
                  }
                >
                  {busy ? "Banning…" : "Ban"}
                </button>
                <button type="button" onClick={() => setMode("menu")}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <>
              {canReport ? (
                <button type="button" role="menuitem" onClick={() => setMode("report")}>
                  Report message…
                </button>
              ) : null}
              {isAdmin ? (
                <>
                  <p className={styles.msgMenuHead}>Admin</p>
                  <input className={styles.msgMenuInput} value={note} maxLength={280} placeholder="Reason (optional, for the log)" onChange={(event) => setNote(event.target.value)} />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const raw = await removeChatMessage(message.id, note);
                        onUpdated(normalizeChatMessage(raw.message));
                        return "Message removed.";
                      })
                    }
                  >
                    Remove message
                  </button>
                  {author && !own ? (
                    <>
                      <p className={styles.msgMenuHead}>Mute {author.username} in all of chat</p>
                      <div className={styles.msgMenuRow}>
                        {MUTE_DURATIONS.map((entry) => (
                          <button
                            key={entry.minutes}
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await restrictChatUser(author.id, "mute", { minutes: entry.minutes, reason: note });
                                return `${author.username} is muted for ${entry.label}.`;
                              })
                            }
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                      <button type="button" role="menuitem" className={styles.msgMenuDangerText} disabled={busy} onClick={() => setMode("ban")}>
                        Ban from chat…
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
