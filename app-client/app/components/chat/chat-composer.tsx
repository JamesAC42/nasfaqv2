"use client";

/* eslint-disable @next/next/no-img-element */
import { FaRegFaceSmile, FaRegNoteSticky } from "react-icons/fa6";
import { EmojiPicker } from "@/app/components/chat/emoji-picker";
import { StickerPicker } from "@/app/components/chat/sticker-picker";
import type { ChibiPose } from "@/app/lib/art-manifest";
import { stickerBody } from "@/app/lib/stickers";
import Link from "next/link";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Emoji } from "@/app/components/common/rich-text";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import type { AuthUser } from "@/app/lib/types";
import styles from "@/app/components/chat/chat.module.scss";

const MAX = 1000;
const MAX_LINES = 5;

type Trigger = { type: "mention" | "emoji"; query: string; start: number; end: number } | null;
type Suggestion = { key: string; type: "mention"; username: string } | { key: string; type: "emoji"; emoji: Emoji };

function findTrigger(value: string, cursor: number): Trigger {
  const before = value.slice(0, cursor);
  const mention = before.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  if (mention) return { type: "mention", query: mention[1], start: cursor - mention[1].length - 1, end: cursor };
  const emoji = before.match(/(?:^|\s):([A-Za-z0-9_-]*)$/);
  if (emoji) return { type: "emoji", query: emoji[1], start: cursor - emoji[1].length - 1, end: cursor };
  return null;
}

export const ChatComposer = memo(function ChatComposer({
  user,
  roomKey,
  roomLabel,
  canPost,
  blockedReason,
  emojis,
  usernames,
  onSend,
}: {
  user: AuthUser | null;
  roomKey: string;
  roomLabel: string;
  canPost: boolean;
  blockedReason: string | null;
  emojis: Emoji[];
  usernames: string[];
  onSend: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [stickers, setStickers] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const verify = userNeedsEmailVerification(user);

  const trigger = useMemo(() => findTrigger(draft, cursor), [cursor, draft]);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger || dismissed === trigger.start) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.type === "mention") {
      return usernames
        .filter((name) => !q || name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((username) => ({ key: `m:${username}`, type: "mention", username }));
    }
    if (!q) return [];
    return emojis
      .filter((emoji) => emoji.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map((emoji) => ({ key: `e:${emoji.id}`, type: "emoji", emoji }));
  }, [dismissed, emojis, trigger, usernames]);

  useEffect(() => setActive(0), [suggestions.length]);
  useEffect(() => {
    setError(null);
    setDraft("");
  }, [roomKey]);

  // Grow with the text up to a few lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const line = Number.parseFloat(style.lineHeight) || 20;
    const pad = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    el.style.height = "0px";
    const max = line * MAX_LINES + pad;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft]);

  const apply = (suggestion: Suggestion) => {
    if (!trigger) return;
    const text = suggestion.type === "mention" ? `@${suggestion.username} ` : `:${suggestion.emoji.name}: `;
    const next = `${draft.slice(0, trigger.start)}${text}${draft.slice(trigger.end)}`;
    const position = trigger.start + text.length;
    setDraft(next);
    setCursor(position);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

  // From the emoji grid: insert at the cursor (with a space either side as needed).
  const insertEmoji = (emoji: Emoji) => {
    const el = input.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const lead = start > 0 && !/\s$/.test(draft.slice(0, start)) ? " " : "";
    const text = `${lead}:${emoji.name}: `;
    const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`.slice(0, MAX);
    const position = Math.min(start + text.length, next.length);
    setDraft(next);
    setCursor(position);
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(position, position);
    });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !canPost || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body);
      setDraft("");
      setCursor(0);
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setSending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const sendSticker = async (symbol: string, pose: ChibiPose) => {
    if (!canPost || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(stickerBody(symbol, pose));
      setStickers(false);
    } catch (reason) {
      const code = String((reason as Error).message || reason);
      setError(code === "sticker_locked" ? "you need one of her cards for that sticker" : code);
    } finally {
      setSending(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setActive((active + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        setActive((active - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        apply(suggestions[active] ?? suggestions[0]);
        return;
      }
      if (event.key === "Escape" && trigger) {
        setDismissed(trigger.start);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (!user) {
    return (
      <div className={styles.composerOff}>
        <Link href="/login">Sign in</Link> to chat. Reading is open to everyone.
      </div>
    );
  }
  if (verify) {
    return (
      <div className={styles.composerOff}>
        <VerificationRequiredNotice action="chat" compact />
      </div>
    );
  }

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {blockedReason ? <p className={styles.blocked}>{blockedReason}</p> : null}
      {error ? (
        <p className={styles.sendErr} role="alert">
          Didn&apos;t send: {error}
        </p>
      ) : null}
      {trigger && suggestions.length ? (
        <div className={styles.suggest} role="listbox" aria-label={trigger.type === "mention" ? "Mention someone" : "Emoji"}>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.key}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => apply(suggestion)}
            >
              {suggestion.type === "mention" ? (
                <>
                  <b>@{suggestion.username}</b>
                </>
              ) : (
                <>
                  <img src={suggestion.emoji.url} alt="" />
                  <b>:{suggestion.emoji.name}:</b>
                </>
              )}
            </button>
          ))}
          <small>↑↓ to pick · enter to insert</small>
        </div>
      ) : null}
      {emojiOpen ? <EmojiPicker emojis={emojis} onPick={insertEmoji} onClose={() => setEmojiOpen(false)} /> : null}
      {stickers ? <StickerPicker onPick={(symbol, pose) => void sendSticker(symbol, pose)} onClose={() => setStickers(false)} disabled={!canPost || sending} /> : null}
      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.stickerBtn}
          aria-label="Stickers"
          aria-expanded={stickers}
          title="Stickers: your card reactions"
          disabled={!canPost}
          onClick={() => {
            setEmojiOpen(false);
            setStickers((open) => !open);
          }}
        >
          <FaRegNoteSticky aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.stickerBtn}
          aria-label="Emoji"
          aria-expanded={emojiOpen}
          title="Emoji"
          disabled={!canPost}
          onClick={() => {
            setStickers(false);
            setEmojiOpen((open) => !open);
          }}
        >
          <FaRegFaceSmile aria-hidden="true" />
        </button>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          maxLength={MAX}
          disabled={!canPost || sending}
          placeholder={canPost ? `Message ${roomLabel}` : blockedReason ?? "You can't post here"}
          aria-label={`Message ${roomLabel}`}
          onChange={(event) => {
            setDraft(event.target.value);
            setCursor(event.target.selectionStart || 0);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart || 0)}
          onKeyDown={onKey}
        />
        <button type="submit" className={styles.send} disabled={!canPost || sending || !draft.trim()}>
          {sending ? "…" : "SEND"}
        </button>
      </div>
      <div className={styles.composeHint}>
        <span>enter to send · shift+enter for a new line · @ to mention · : or ☺ for emoji · the note for stickers · $TICKER links a stock</span>
        <span className={draft.length > MAX - 100 ? styles.warnText : undefined}>
          {draft.length}/{MAX}
        </span>
      </div>
    </form>
  );
});
