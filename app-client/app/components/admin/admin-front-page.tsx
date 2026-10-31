"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fetchFrontPagePins, saveFrontPagePins, type FrontPagePins } from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago } from "@/app/components/admin/admin-ui";
import { apiFetch } from "@/app/lib/api";
import { normalizeNewsFeedResponse } from "@/app/lib/normalizers";
import type { NewsItem } from "@/app/lib/types";
import styles from "@/app/components/admin/admin-front-page.module.scss";

const enc = encodeURIComponent;

/**
 * /admin/front-page: the stories pinned to the top of the home page. Pinned stories lead, in this
 * order; the slots after them fill automatically as before (the newest stories, the first one with a
 * picture leading). Every change saves at once. A player article is pinned from its own page.
 */
export function AdminFrontPage() {
  const access = useAdminAccess();
  const now = useNow(30_000);
  const [data, setData] = useState<FrontPagePins | null>(null);
  const [recent, setRecent] = useState<NewsItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    let cancelled = false;
    fetchFrontPagePins()
      .then((result) => !cancelled && (setData(result), setError(null)))
      .catch((caught) => !cancelled && setError(adminErrorText(caught)));
    return () => {
      cancelled = true;
    };
  }, [access.initialized, access.isAdmin]);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    let cancelled = false;
    apiFetch<Record<string, unknown>>(`/api/news?sort=newest&limit=20${search ? `&q=${enc(search)}` : ""}`)
      .then((result) => !cancelled && setRecent(normalizeNewsFeedResponse(result).items))
      .catch((caught) => !cancelled && setError(adminErrorText(caught)));
    return () => {
      cancelled = true;
    };
  }, [access.initialized, access.isAdmin, search]);

  const save = useCallback(async (slugs: string[]) => {
    setBusy(true);
    try {
      setData(await saveFrontPagePins(slugs));
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!access.initialized) return <AdminLoading title="Front page" />;
  if (!access.isAdmin) return <AdminGate title="Front page" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const pins = data?.pins ?? [];
  const limit = data?.limit ?? 6;
  const slugs = pins.map((pin) => pin.article_slug);
  const full = pins.length >= limit;
  const move = (index: number, by: number) => {
    const next = [...slugs];
    const [slug] = next.splice(index, 1);
    next.splice(index + by, 0, slug);
    void save(next);
  };
  const find = (event: FormEvent) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  return (
    <AdminFrame
      title="Front page"
      blurb={
        <>
          Pin up to {limit} stories to the top of the <Link href="/">home page</Link>. Pinned stories lead, in this order; the slots after them fill
          automatically as before, with the newest stories and the first one with a picture as the lead. Unpin a story to give its slot back. To pin a
          player article, use PIN TO FRONT on its page.
        </>
      }
    >
      {error ? <Notice onClose={() => setError(null)}>{error}</Notice> : null}

      <Section title="Pinned" count={data ? `${pins.length}/${limit}` : "…"} hint="Changes save at once and reach the home page within a few seconds.">
        {!data ? (
          <p className={ui.empty}>Loading…</p>
        ) : pins.length ? (
          <ol className={styles.list}>
            {pins.map((pin, index) => (
              <li key={pin.article_id} className={styles.row}>
                <span className={styles.position}>{index === 0 ? "LEAD" : `#${index + 1}`}</span>
                <div className={styles.main}>
                  <Link href={`/articles/${enc(pin.article_slug)}`} className={styles.headline}>
                    {pin.headline}
                  </Link>
                  <span className={styles.meta}>
                    <span className={ui.pill} data-tone={pin.is_news ? "blue" : undefined}>
                      {pin.is_news ? "HoloNews" : "Player article"}
                    </span>
                    {pin.status !== "published" ? (
                      <span className={ui.pill} data-tone="warn" title="Unpublished stories stay pinned but the home page skips them">
                        not shown: {pin.status}
                      </span>
                    ) : null}
                    {pin.thumbnail_url ? null : (
                      <span className={ui.pill} data-tone="dim">
                        no picture
                      </span>
                    )}
                    {pin.pinned_at ? (
                      <span>
                        pinned {ago(pin.pinned_at, now)}
                        {pin.pinned_by ? ` by ${pin.pinned_by}` : ""}
                      </span>
                    ) : null}
                  </span>
                </div>
                <span className={styles.actions}>
                  <button type="button" className={ui.btnGhost} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move “${pin.headline}” up`}>
                    ↑
                  </button>
                  <button type="button" className={ui.btnGhost} disabled={busy || index === pins.length - 1} onClick={() => move(index, 1)} aria-label={`Move “${pin.headline}” down`}>
                    ↓
                  </button>
                  <button type="button" className={ui.btn} disabled={busy} onClick={() => void save(slugs.filter((slug) => slug !== pin.article_slug))}>
                    Unpin
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={ui.empty}>Nothing pinned: the home page picks its stories automatically.</p>
        )}
        {pins.length ? (
          <div className={styles.footer}>
            <button type="button" className={ui.btnDanger} disabled={busy} onClick={() => void save([])}>
              Unpin all
            </button>
          </div>
        ) : null}
      </Section>

      <Section
        title={search ? `Stories matching “${search}”` : "Recent stories"}
        actions={
          <form className={styles.search} onSubmit={find} role="search">
            <input className={ui.input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a headline" aria-label="Find a headline" />
            <button type="submit" className={ui.btn}>
              Find
            </button>
          </form>
        }
      >
        {!recent ? (
          <p className={ui.empty}>Loading…</p>
        ) : recent.length ? (
          <ul className={styles.list}>
            {recent.map((item) => {
              const slug = item.article_slug || "";
              const pinned = slugs.includes(slug);
              return (
                <li key={item.id} className={styles.row}>
                  <span className={styles.position}>{item.published_at ? new Date(item.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""}</span>
                  <div className={styles.main}>
                    <Link href={`/articles/${enc(slug)}`} className={styles.headline}>
                      {item.headline}
                    </Link>
                    <span className={styles.meta}>
                      {item.thumbnail_url ? null : (
                        <span className={ui.pill} data-tone="dim">
                          no picture
                        </span>
                      )}
                      {item.stock_symbols?.length ? <span>{item.stock_symbols.slice(0, 4).join(" · ")}</span> : null}
                    </span>
                  </div>
                  <span className={styles.actions}>
                    <button type="button" className={ui.btn} disabled={busy || !slug || pinned || full || !data} onClick={() => void save([...slugs, slug])} title={full && !pinned ? `${limit} pinned already: unpin one first` : undefined}>
                      {pinned ? "Pinned" : "Pin"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={ui.empty}>{search ? "No headline matches that." : "No stories yet."}</p>
        )}
      </Section>
    </AdminFrame>
  );
}
