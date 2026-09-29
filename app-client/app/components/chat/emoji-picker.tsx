"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Emoji } from "@/app/components/common/rich-text";
import pickerStyles from "@/app/components/chat/sticker-picker.module.scss";
import styles from "@/app/components/chat/emoji-picker.module.scss";

/**
 * The site's custom emoji as a grid, for anyone who doesn't know the names to type after `:`.
 * Picking one inserts `:name:` at the cursor; the panel stays open for a few in a row (shift-click
 * or the ✕ / Escape to close).
 */
export function EmojiPicker({ emojis, onPick, onClose }: { emojis: Emoji[]; onPick: (emoji: Emoji) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Straight into the search box with a keyboard; not on phones, where it would pop the keyboard up.
    if (window.matchMedia("(pointer: fine)").matches) search.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
    const sorted = [...emojis].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((emoji) => emoji.name.toLowerCase().includes(q)) : sorted;
  }, [emojis, query]);

  return (
    <div className={`${pickerStyles.picker} ${styles.picker}`} role="dialog" aria-label="Emoji">
      <header className={pickerStyles.head}>
        <b>Emoji</b>
        <small>{emojis.length} on the site</small>
        <button type="button" onClick={onClose} aria-label="Close emoji">
          ✕
        </button>
      </header>
      <label className={styles.search}>
        <span aria-hidden="true">⌕</span>
        <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an emoji" aria-label="Find an emoji" />
      </label>
      {!emojis.length ? (
        <p className={pickerStyles.note}>No custom emoji yet.</p>
      ) : !shown.length ? (
        <p className={pickerStyles.note}>Nothing called “{query}”.</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((emoji) => (
            <button key={emoji.id} type="button" title={`:${emoji.name}:`} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(emoji)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emoji.url} alt={`:${emoji.name}:`} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
