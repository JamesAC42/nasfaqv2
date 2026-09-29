"use client";

import Link from "next/link";
import { useEffect } from "react";
import { connectSite, newRelease, useSiteStore } from "@/app/stores/site-store";
import styles from "@/app/components/common/site-status-bar.module.scss";

/**
 * Site-wide notices under the header: maintenance (a release going out, or an admin pause; new games
 * wait, games in play finish) and a new release (refresh to get it). Follows /api/site and the
 * market socket, so it appears and clears without a reload.
 */
export function SiteStatusBar() {
  const site = useSiteStore((state) => state.site);
  const release = useSiteStore(newRelease);
  const dismissed = useSiteStore((state) => state.dismissed);
  const dismiss = useSiteStore((state) => state.dismiss);

  useEffect(() => {
    connectSite();
  }, []);

  const maintenance = site?.maintenance.state ?? "off";
  const showRelease = Boolean(release) && release !== dismissed;
  if (maintenance === "off" && !showRelease) return null;

  return (
    <div className={styles.stack}>
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
