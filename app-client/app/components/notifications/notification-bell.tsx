"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaRegBell } from "react-icons/fa6";
import { NotificationRow } from "@/app/components/notifications/notification-row";
import { useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { useNotificationStore } from "@/app/stores/notification-store";
import styles from "@/app/components/notifications/notifications.module.scss";

type ShellClasses = { button: string; hot: string; badge: string; icon: string };

/**
 * The bell in the top bar: friend requests, @mentions and replies, achievements, prediction
 * payouts, exchange alerts. New ones arrive on the games socket (`me`), with a slow poll behind it.
 * Opening the panel marks everything read; the dots stay until it closes.
 */
export function NotificationBell({ userId, classes }: { userId: number; classes: ShellClasses }) {
  const items = useNotificationStore((state) => state.items);
  const unread = useNotificationStore((state) => state.unread);
  const loaded = useNotificationStore((state) => state.loaded);
  const load = useNotificationStore((state) => state.load);
  const refreshUnread = useNotificationStore((state) => state.refreshUnread);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const settle = useNotificationStore((state) => state.settle);
  const receive = useNotificationStore((state) => state.receive);
  const reset = useNotificationStore((state) => state.reset);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  // A different account starts from its own inbox.
  const owner = useRef<number | null>(null);
  useEffect(() => {
    if (owner.current !== null && owner.current !== userId) reset();
    owner.current = userId;
  }, [reset, userId]);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshUnread();
    }, 90_000);
    const onFocus = () => void refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshUnread]);

  const onPush = useCallback(
    (payload: GamesPayload) => {
      if (payload.type === "notification" && payload.notification && typeof payload.notification === "object") receive(payload.notification as Record<string, unknown>);
    },
    [receive]
  );
  useGamesEvents("me", onPush);

  const close = useCallback(() => {
    setOpen(false);
    settle();
  }, [settle]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  const toggle = () => {
    if (open) return close();
    setOpen(true);
    void markAllRead();
  };

  const shown = items.slice(0, 8);
  return (
    <div ref={wrap} className={styles.wrap}>
      <button type="button" className={[classes.button, unread ? classes.hot : ""].filter(Boolean).join(" ")} aria-label={unread ? `Notifications: ${unread} new` : "Notifications"} aria-expanded={open} onClick={toggle}>
        <FaRegBell className={classes.icon} aria-hidden />
        {unread ? <span className={classes.badge}>{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.head}>
            <strong>Notifications</strong>
            <Link href="/notifications" onClick={close}>
              SEE ALL →
            </Link>
          </div>
          {!loaded ? (
            <p className={styles.empty}>Loading…</p>
          ) : shown.length ? (
            <div className={styles.list}>
              {shown.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={close} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Nothing yet. Friend requests, @mentions, payouts and exchange news land here.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
