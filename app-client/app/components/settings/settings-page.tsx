"use client";

import Link from "next/link";
import { SiteShell } from "@/app/components/layout/site-shell";
import { NotificationSettings } from "@/app/components/settings/notification-settings";
import { withNext } from "@/app/lib/return-path.mjs";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/settings/settings.module.scss";

// /settings: a player's own settings, one section each. Notifications is the first. Each section is a
// <section className={styles.section}> with an id, so it can be linked to (/settings#notifications)
// and listed in the jump links below. A new one goes in SECTIONS and in the page body, in that order.
const SECTIONS = [
  { id: "notifications", label: "Notifications" },
  // { id: "display", label: "Display" }: local time or New York market time, from a later change.
];

export function SettingsPage() {
  const { user, isLoading, initialized } = useAuth();

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.pageHead}>
          <h1>Settings</h1>
          <p>
            Yours only. Your public page is on your <Link href="/profile">profile</Link>.
          </p>
          {SECTIONS.length > 1 ? (
            <nav className={styles.jump} aria-label="Sections">
              {SECTIONS.map((section) => (
                <a key={section.id} href={`#${section.id}`}>
                  {section.label}
                </a>
              ))}
            </nav>
          ) : null}
        </header>

        {!user ? (
          <p className={styles.empty}>
            {!initialized || isLoading ? "Loading…" : (
              <>
                <Link href={withNext("/login", "/settings")}>Sign in</Link> to change your settings.
              </>
            )}
          </p>
        ) : (
          <>
            <NotificationSettings />
            {/* Display (local time vs. New York market time) goes here, as its own <section id="display">. */}
          </>
        )}
      </div>
    </SiteShell>
  );
}
