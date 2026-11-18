"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, etTime } from "@/app/components/admin/admin-ui";
import { fetchFeedback } from "@/app/lib/games/mahjong/api";
import type { FeedbackItem } from "@/app/lib/games/mahjong/types";
import { useFeature } from "@/app/lib/features";
import styles from "@/app/components/admin/admin-mahjong-feedback-page.module.scss";

// /admin/mahjong-feedback: the notes players send from the mahjong lobby (and, later, the table),
// newest first, with the table or game they were sent from.

export function AdminMahjongFeedbackPage() {
  const access = useAdminAccess();
  const enabled = useFeature("mahjong");
  const now = useNow(30_000);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before?: number) => {
    setBusy(true);
    try {
      const page = await fetchFeedback(before);
      setItems((current) => (before ? [...(current ?? []), ...page.feedback] : page.feedback));
      setNext(page.next_before ?? null);
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
      setItems((current) => current ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!access.isAdmin || !enabled) return;
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [access.isAdmin, enabled, load]);

  if (!access.initialized) return <AdminLoading title="Mahjong feedback" />;
  if (!access.isAdmin || !enabled) return <AdminGate title="Mahjong feedback" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  return (
    <AdminFrame title="Mahjong feedback" blurb="Notes players send from the mahjong beta, newest first.">
      <Section title="Notes" count={items ? `${items.length}${next ? "+" : ""}` : "…"}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!items ? (
          <p className={ui.empty}>Loading…</p>
        ) : items.length ? (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <div className={styles.meta}>
                  <Link href={`/profile/${encodeURIComponent(item.username)}`}>
                    <b>{item.username}</b>
                  </Link>
                  <time dateTime={item.created_at} title={etTime(item.created_at)}>
                    {ago(item.created_at, now)}
                  </time>
                  {item.page ? <code>{item.page}</code> : null}
                  {item.table_id ? <Link href={`/games/mahjong/table/${item.table_id}`}>table {item.table_id}</Link> : null}
                  {item.game_id ? <Link href={`/games/mahjong/replay/${item.game_id}`}>replay of game {item.game_id}</Link> : null}
                </div>
                <p className={styles.body}>{item.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.empty}>{error ? "Couldn’t load the notes." : "No feedback yet. Players send it from the Send feedback button in the lobby."}</p>
        )}
        {next ? (
          <button type="button" className={ui.btn} disabled={busy} onClick={() => void load(next)}>
            {busy ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </Section>
    </AdminFrame>
  );
}
