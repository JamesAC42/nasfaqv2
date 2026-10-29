"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStoredState } from "@/app/lib/use-stored-state";
import { useAuthStore } from "@/app/stores/auth-store";
import { connectSite, newRelease, useSiteStore, type Announcement } from "@/app/stores/site-store";
import styles from "@/app/components/common/site-status-bar.module.scss";

const DISMISSED_KEY = "nasfaq.announcement.dismissed";
const parseDismissed = (value: unknown) => (typeof value === "string" ? value : null);

const when = (value: string) =>
  new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** True once `expiresAt` has passed (re-renders at that moment). */
function useExpired(expiresAt: string | null) {
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Math.max(0, Math.min(Date.parse(expiresAt) - Date.now(), 2_147_000_000));
    const timer = window.setTimeout(() => setExpired(expiresAt), wait);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  return expiresAt !== null && expired === expiresAt;
}

function AnnouncementBar({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const link = announcement.link;
  return (
    <div className={styles.bar} data-tone={announcement.tone === "warning" ? "warn" : "info"} role="status">
      <span className={styles.tag}>{announcement.tone === "warning" ? "Heads up" : "Announcement"}</span>
      <p className={styles.message}>{announcement.text}</p>
      <div className={styles.actions}>
        {link ? (
          link.startsWith("/") ? (
            <Link href={link} className={styles.link}>
              More
            </Link>
          ) : (
            <a href={link} className={styles.link} target="_blank" rel="noopener noreferrer">
              More ↗
            </a>
          )
        ) : null}
        <button type="button" className={styles.later} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Site-wide notices under the header: your account's suspension, maintenance (a release going out,
 * or an admin pause; new games wait, games in play finish), the admins' announcement and a new
 * release (refresh to get it). Follows /api/site and the market socket, so they appear and clear
 * without a reload.
 */
export function SiteStatusBar() {
  const site = useSiteStore((state) => state.site);
  const release = useSiteStore(newRelease);
  const dismissed = useSiteStore((state) => state.dismissed);
  const dismiss = useSiteStore((state) => state.dismiss);
  const suspension = useAuthStore((state) => state.user?.suspension ?? null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useStoredState<string | null>(DISMISSED_KEY, null, { parse: parseDismissed });
  const announcement = site?.announcement ?? null;
  const expired = useExpired(announcement?.expires_at ?? null);

  useEffect(() => {
    connectSite();
  }, []);

  const maintenance = site?.maintenance.state ?? "off";
  const showRelease = Boolean(release) && release !== dismissed;
  const showAnnouncement = Boolean(announcement) && !expired && announcement?.id !== dismissedAnnouncement;
  if (maintenance === "off" && !showRelease && !showAnnouncement && !suspension) return null;

  return (
    <div className={styles.stack}>
      {suspension ? (
        <div className={styles.bar} data-tone="danger" role="status">
          <span className={styles.tag}>Account suspended</span>
          <p className={styles.message}>
            {suspension.permanent || !suspension.until ? "An admin has suspended your account until further notice." : `An admin has suspended your account until ${when(suspension.until)}.`}
            {suspension.reason ? (
              <>
                {" "}
                Reason: <b>{suspension.reason}</b>
              </>
            ) : null}{" "}
            You can still look around, but trading, posting, chat and games are off until then.
          </p>
        </div>
      ) : null}
      {maintenance === "draining" ? (
        <div className={styles.bar} data-tone="warn" role="status">
          <span className={styles.tag}>
            <i aria-hidden="true" />
            Update going out
          </span>
          <p className={styles.message}>New games are paused for a few minutes. Games already in play finish first; trading is open.</p>
        </div>
      ) : maintenance === "on" ? (
        <div className={styles.bar} data-tone="warn" role="status">
          <span className={styles.tag}>
            <i aria-hidden="true" />
            Maintenance
          </span>
          <p className={styles.message}>{site?.maintenance.message || "Games are paused for maintenance. Back soon."}</p>
        </div>
      ) : null}
      {showAnnouncement && announcement ? <AnnouncementBar announcement={announcement} onDismiss={() => setDismissedAnnouncement(announcement.id)} /> : null}
      {showRelease ? (
        <div className={styles.bar} data-tone="info" role="status">
          <span className={styles.tag}>New version</span>
          <p className={styles.message}>NASFAQ was just updated. Refresh to get the new version.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
              Refresh
            </button>
            <Link href="/changelog" className={styles.link}>
              What&apos;s new
            </Link>
            <button type="button" className={styles.later} onClick={dismiss}>
              Later
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
