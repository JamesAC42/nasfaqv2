"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isActivePath, MOBILE_TABS, NAV } from "@/app/components/layout/nav-config";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

/** Phone/tablet bottom bar: four main tabs plus a "More" sheet with everything else. */
export function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { calm, toggleCalm } = useMotion();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMoreOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const close = () => setMoreOpen(false);

  return (
    <>
      {moreOpen ? (
        <div className={styles.sheetScrim} onClick={close}>
          <div className={styles.sheet} role="dialog" aria-label="More" onClick={(event) => event.stopPropagation()}>
            {NAV.filter((group) => group.links).map((group) => (
              <div key={group.key} className={styles.sheetGroup}>
                <div className={styles.sheetLabel}>{group.label}</div>
                {group.links?.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={styles.sheetLink}
                    aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
                    onClick={close}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
            <div className={styles.sheetGroup}>
              <div className={styles.sheetLabel}>More</div>
              <Link href="/games" className={styles.sheetLink} onClick={close}>
                Games
              </Link>
              <Link href="/how-to-play" className={styles.sheetLink} onClick={close}>
                How to play
              </Link>
            </div>
            <div className={styles.sheetPrefs}>
              <button type="button" className={styles.textButton} aria-pressed={calm} onClick={toggleCalm}>
                CALM MODE {calm ? "ON" : "OFF"}
              </button>
              <button type="button" className={styles.textButton} onClick={toggleTheme}>
                {theme === "dark" ? "LIGHT THEME" : "DARK THEME"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className={styles.bottomNav} aria-label="Main">
        {MOBILE_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={styles.bottomTab}
            aria-current={isActivePath(pathname, tab.href) ? "page" : undefined}
            onClick={close}
          >
            <i aria-hidden="true" />
            {tab.label}
          </Link>
        ))}
        <Link
          href={user ? "/profile" : "/login"}
          className={styles.bottomTab}
          aria-current={isActivePath(pathname, "/profile") || isActivePath(pathname, "/login") ? "page" : undefined}
          onClick={close}
        >
          <i aria-hidden="true" />
          {user ? "Me" : "Sign in"}
        </Link>
        <button
          type="button"
          className={styles.bottomTab}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <i aria-hidden="true" />
          More
        </button>
      </nav>
    </>
  );
}
