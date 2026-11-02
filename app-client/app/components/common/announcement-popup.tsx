"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { useStoredState } from "@/app/lib/use-stored-state";
import { useAuth } from "@/app/providers/auth-provider";
import { busy, connectSite, useSiteStore, type PopupAnnouncement } from "@/app/stores/site-store";
import styles from "@/app/components/common/announcement-popup.module.scss";

// Announcement popups from the admins (api/src/services/announcements.js; the one-line banner is in
// site-status-bar.tsx). /api/site lists what's running. This decides whether to show one: the oldest
// this visitor hasn't dismissed, and only when it's not in the way.

/** Ids dismissed in this browser. A signed-in player's also live in the API, for their other devices. */
const DISMISSED_KEY = "nasfaq.announcements.dismissed";
/** Dismissed ids the API hasn't heard about: dismissed while signed out, or the request failed. */
const UNSYNCED_KEY = "nasfaq.announcements.unsynced";
const SHOWN_AT_KEY = "nasfaq.announcements.shownAt";
/** One popup this often at most, so a second one waits and reloading past one doesn't bring it right back. */
const SHOW_EVERY_MS = 12 * 3_600_000;
/** How often it looks for a good moment. The first look is this long after the page opens, so it never lands mid-load. */
const CHECK_MS = 2000;
const KEEP_IDS = 100;
const SYNC_BATCH = 50;
/** The sign-in and sign-up flow, the page the first announcement points at, and the back office. */
const QUIET_PAGES = /^\/(login|register|forgot-password|reset-password|verify-email|link-v1|admin)(\/|$)/;

const NO_IDS: number[] = [];
const parseIds = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : null);
const parseTime = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const IDS_STORAGE = { parse: parseIds };
const TIME_STORAGE = { parse: parseTime };

const remember = (ids: number[], more: number[]) => [...new Set([...ids, ...more])].slice(-KEEP_IDS);

const meantFor = (item: PopupAnnouncement, signedIn: boolean) => item.audience === "everyone" || item.audience === (signedIn ? "signed_in" : "signed_out");

/** Something else has the player's attention: an open trade ticket, a game, typed text, a field they're in, another dialog. */
function occupied() {
  if (busy()) return true;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']")) return true;
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/** The API only stores a path here or an https URL; this says the same for whatever reaches the page. */
function safeHref(link: string | null) {
  if (!link || /[\s\p{Cc}\p{Cf}\\]/u.test(link)) return null;
  if (link.startsWith("/")) return link.startsWith("//") ? null : link;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

type CardContent = Pick<PopupAnnouncement, "title" | "body" | "button_label" | "button_link">;

/**
 * What the popup says, also the preview on /admin/announcements (which can't close or go anywhere).
 * The title and body are text nodes, so markup in them shows as written.
 */
export function AnnouncementCard({ announcement, titleId, bodyId, onClose }: { announcement: CardContent; titleId?: string; bodyId?: string; onClose?: () => void }) {
  const href = safeHref(announcement.button_link);
  const label = href ? announcement.button_label : null;
  return (
    <div className={styles.card}>
      <header className={styles.head}>
        <span className={styles.kicker}>Announcement</span>
        {onClose ? (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss this announcement">
            ✕
          </button>
        ) : null}
      </header>
      <h2 id={titleId} className={styles.title}>
        {announcement.title}
      </h2>
      <p id={bodyId} className={styles.body}>
        {announcement.body}
      </p>
      <div className={styles.actions}>
        {onClose ? (
          <button type="button" className={styles.ghost} onClick={onClose}>
            Dismiss
          </button>
        ) : (
          <span className={styles.ghost}>Dismiss</span>
        )}
        {label && href ? (
          !onClose ? (
            <span className={styles.primary}>{label}</span>
          ) : href.startsWith("/") ? (
            <Link href={href} className={styles.primary} onClick={onClose}>
              {label}
            </Link>
          ) : (
            <a href={href} className={styles.primary} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              {label} ↗
            </a>
          )
        ) : null}
      </div>
    </div>
  );
}

function AnnouncementDialog({ announcement, onDismiss }: { announcement: PopupAnnouncement; onDismiss: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
        return;
      }
      const root = panel.current;
      if (event.key !== "Tab" || !root) return;
      // Tab stays inside until it's closed.
      const stops = Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"));
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (!root.contains(active) || (event.shiftKey ? active === first || active === root : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onDismiss]);

  return (
    <div className={styles.scrim} onClick={onDismiss} data-announcement-popup="">
      <div
        ref={panel}
        tabIndex={-1}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
      >
        <AnnouncementCard announcement={announcement} titleId={titleId} bodyId={bodyId} onClose={onDismiss} />
      </div>
    </div>
  );
}

/** Lives outside each page's shell, so an open popup and the wait for a good moment survive moving between pages. */
export function AnnouncementPopup() {
  const pathname = usePathname() || "";
  const { user, initialized } = useAuth();
  const userId = user?.id ?? null;
  const list = useSiteStore((state) => state.announcements);
  const refresh = useSiteStore((state) => state.refresh);
  const [dismissed, setDismissed] = useStoredState(DISMISSED_KEY, NO_IDS, IDS_STORAGE);
  const [unsynced, setUnsynced] = useStoredState(UNSYNCED_KEY, NO_IDS, IDS_STORAGE);
  const [shownAt, setShownAt] = useStoredState(SHOWN_AT_KEY, 0, TIME_STORAGE);
  const [account, setAccount] = useState<{ userId: number; v1Linked: boolean } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    connectSite();
  }, []);

  // The list depends on who's asking, so signing in or out reads it again.
  const lastUser = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!initialized) return;
    if (lastUser.current !== undefined && lastUser.current !== userId) void refresh();
    lastUser.current = userId;
  }, [initialized, refresh, userId]);

  const waiting = useMemo(
    () => (initialized ? list.filter((item) => meantFor(item, userId !== null) && !dismissed.includes(item.id)) : []),
    [dismissed, initialized, list, userId],
  );

  // Only asked when there's something to show, so a player who has seen them all costs nothing. If it
  // fails there's no popup this visit, which beats showing one they've already closed.
  const needAccount = userId !== null && waiting.length > 0 && account?.userId !== userId;
  useEffect(() => {
    if (!needAccount || userId === null) return;
    let cancelled = false;
    apiFetch<{ dismissed?: unknown; v1_linked?: unknown }>("/api/site/announcements/me", { cache: "no-store" })
      .then((result) => {
        if (cancelled) return;
        setDismissed((current) => remember(current, parseIds(result.dismissed) ?? []));
        setAccount({ userId, v1Linked: result.v1_linked === true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needAccount, setDismissed, userId]);

  // Tells the API what it hasn't heard yet. If that fails they stay queued for the next visit.
  useEffect(() => {
    if (userId === null || !unsynced.length) return;
    const ids = unsynced.slice(0, SYNC_BATCH);
    apiFetch("/api/site/announcements/dismiss", { method: "POST", body: JSON.stringify({ ids }) })
      .then(() => setUnsynced((current) => current.filter((id) => !ids.includes(id))))
      .catch(() => {});
  }, [setUnsynced, unsynced, userId]);

  const dismiss = useCallback(
    (id: number) => {
      setDismissed((current) => remember(current, [id]));
      setUnsynced((current) => remember(current, [id]));
      setOpenId(null);
    },
    [setDismissed, setUnsynced],
  );

  const accountKnown = userId === null || account?.userId === userId;
  const v1Linked = accountKnown && account?.v1Linked === true;
  const next = accountKnown ? waiting.find((item) => !(item.hide_from_v1_linked && v1Linked)) : undefined;
  const open = openId === null ? undefined : waiting.find((item) => item.id === openId);
  const openedId = open?.id ?? null;
  const nextId = next?.id ?? null;
  const quiet = QUIET_PAGES.test(pathname);

  useEffect(() => {
    if (nextId === null || openedId !== null || quiet) return;
    const timer = window.setInterval(() => {
      if (Date.now() - shownAt < SHOW_EVERY_MS || document.visibilityState !== "visible" || occupied()) return;
      setShownAt(Date.now());
      setOpenId(nextId);
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [nextId, openedId, quiet, setShownAt, shownAt]);

  const close = useCallback(() => {
    if (openedId !== null) dismiss(openedId);
  }, [dismiss, openedId]);

  if (!open || quiet) return null;
  return <AnnouncementDialog key={open.id} announcement={open} onDismiss={close} />;
}
