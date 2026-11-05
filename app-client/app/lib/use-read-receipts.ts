"use client";

import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/app/lib/api";

const READ_RECEIPT_MS = 10_000;

/**
 * Read receipts for a room on screen: the server hears at most once per room every
 * READ_RECEIPT_MS (a busy room used to cost a request per message per reader), and again straight
 * away when you leave the room or hide the tab.
 */
export function useReadReceipts(viewerId: number | null, roomKey: string | null) {
  const receipts = useRef(new Map<string, { id: number; sentId: number; sentAt: number; timer: number | null }>());

  const sendRead = useCallback((key: string) => {
    const entry = receipts.current.get(key);
    if (!entry) return;
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.id <= entry.sentId) return;
    entry.sentId = entry.id;
    entry.sentAt = Date.now();
    // keepalive: this can be the last thing a closing tab sends.
    void apiFetch(`/api/chat/channels/${encodeURIComponent(key)}/read`, { method: "POST", body: JSON.stringify({ last_read_message_id: entry.id }), keepalive: true }).catch(() => undefined);
  }, []);

  const markRead = useCallback(
    (key: string, id: number) => {
      if (viewerId === null) return;
      let entry = receipts.current.get(key);
      if (!entry) {
        entry = { id: 0, sentId: 0, sentAt: 0, timer: null };
        receipts.current.set(key, entry);
      }
      entry.id = Math.max(entry.id, id);
      if (entry.timer !== null) return;
      const wait = entry.sentAt + READ_RECEIPT_MS - Date.now();
      if (wait <= 0) sendRead(key);
      else entry.timer = window.setTimeout(() => sendRead(key), wait);
    },
    [sendRead, viewerId],
  );

  // Leaving a room (or the page) sends what's pending for it, and so does hiding the tab.
  useEffect(() => {
    if (!roomKey) return;
    const flush = () => sendRead(roomKey);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [roomKey, sendRead]);

  // Signing out or in as someone else drops what's pending: it was the last player's. (Declared after
  // the effects above so that leaving the page sends first.)
  useEffect(() => {
    const pending = receipts.current;
    return () => {
      for (const entry of pending.values()) if (entry.timer !== null) window.clearTimeout(entry.timer);
      pending.clear();
    };
  }, [viewerId]);

  return markRead;
}
