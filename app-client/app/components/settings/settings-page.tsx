"use client";

import Link from "next/link";
import { SiteShell } from "@/app/components/layout/site-shell";
import { DisplaySettings } from "@/app/components/settings/display-settings";
import { NotificationSettings } from "@/app/components/settings/notification-settings";
import { useFeature } from "@/app/lib/features";
import { withNext } from "@/app/lib/return-path.mjs";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/settings/settings.module.scss";

// /settings: a player's own settings, one section each. Each section is a
// <section className={styles.section}> with an id, so it can be linked to (/settings#display) and
// listed in the jump links below. A new one goes in SECTIONS and in the page body, in that order.
// Each has its own flag: Display is timezone-setting and works signed out too (the pick stays in the
// browser); Notifications is checkin-reminders and needs an account.
const SECTIONS = [
  { id: "display", label: "Display", flag: "timezone-setting", signedOut: true },
  { id: "notifications", label: "Notifications", flag: "checkin-reminders", signedOut: false },
] as const;

export function SettingsPage() {
  const { user, isLoading, initialized } = useAuth();
  const displayOn = useFeature("timezone-setting");
  const notificationsOn = useFeature("checkin-reminders");
  const on: Record<string, boolean> = { "timezone-setting": displayOn, "checkin-reminders": notificationsOn };
  const shown = SECTIONS.filter((section) => on[section.flag] && (user || section.signedOut));
  const signInFor = SECTIONS.some((section) => on[section.flag] && !section.signedOut);

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.pageHead}>
          <h1>Settings</h1>
          {shown.length > 1 ? (
            <nav className={styles.jump} aria-label="Sections">
              {shown.map((section) => (
                <a key={section.id} href={`#${section.id}`}>
                  {section.label}
                </a>
              ))}
            </nav>
          ) : null}
        </header>

        {displayOn ? <DisplaySettings /> : null}

        {!user ? (
          signInFor || !initialized || isLoading ? (
            <p className={styles.empty}>
              {!initialized || isLoading ? "Loading…" : (
                <>
                  <Link href={withNext("/login", "/settings")}>Sign in</Link> to change your {displayOn ? "other " : ""}settings.
                </>
              )}
            </p>
          ) : null
        ) : notificationsOn ? (
          <NotificationSettings />
        ) : null}
      </div>
    </SiteShell>
  );
}
