"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TalentReaction } from "@/app/components/common/talent-reaction";
import { SiteShell } from "@/app/components/layout/site-shell";
import { NotificationRow } from "@/app/components/notifications/notification-row";
import { useAuth } from "@/app/providers/auth-provider";
import { useNotificationStore } from "@/app/stores/notification-store";
import styles from "@/app/components/notifications/notifications.module.scss";

/** Everything the bell has held, newest first. */
export function NotificationsPage() {
  const { user } = useAuth();
  const items = useNotificationStore((state) => state.items);
  const unread = useNotificationStore((state) => state.unread);
  const loaded = useNotificationStore((state) => state.loaded);
  const loading = useNotificationStore((state) => state.loading);
  const hasMore = useNotificationStore((state) => state.hasMore);
  const load = useNotificationStore((state) => state.load);
  const loadMore = useNotificationStore((state) => state.loadMore);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const markRead = useNotificationStore((state) => state.markRead);
  const settle = useNotificationStore((state) => state.settle);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  // Leaving the page settles the "new" dots.
  useEffect(() => () => settle(), [settle]);

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.pageHead}>
          <div>
            <h1>Notifications</h1>
            <p>Friend requests, @mentions and replies, achievements, prediction payouts and card exchange news.</p>
          </div>
          {user && unread ? (
            <button type="button" className={styles.markAll} onClick={() => void markAllRead()}>
              MARK ALL READ
            </button>
          ) : null}
        </header>
        {!user ? (
          <p className={styles.empty}>
            <Link href="/login">Sign in</Link> to see your notifications.
          </p>
        ) : !loaded ? (
          <p className={styles.empty}>Loading…</p>
        ) : items.length ? (
          <>
            <div className={styles.pageList}>
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={(row) => void markRead([row.id])} />
              ))}
            </div>
            {hasMore ? (
              <button type="button" className={styles.more} disabled={loading} onClick={() => void loadMore()}>
                {loading ? "LOADING…" : "OLDER"}
              </button>
            ) : null}
          </>
        ) : (
          <TalentReaction pose="idle" caption="Nothing yet. {name} is waiting with you." />
        )}
      </div>
    </SiteShell>
  );
}
