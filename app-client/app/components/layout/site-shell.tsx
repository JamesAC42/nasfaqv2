"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { API_BASE } from "@/app/lib/config";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/layout/site-shell.module.scss";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/news", label: "News" },
  { href: "/articles", label: "Articles" },
  { href: "/indexes", label: "Indexes" },
  { href: "/stocks", label: "Stocks" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/livestreams", label: "Livestreams" },
  { href: "/login", label: "Login" },
  { href: "/register", label: "Register" },
  { href: "/profile", label: "Profile" },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, isLoading } = useAuth();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>NASFAQ</h1>
        </div>
        <nav className={styles.nav} aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`.trim()}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.authBlock}>
          {user ? <span className={styles.userText}>Signed in as {user.username}</span> : <span className={styles.userText}>Guest session</span>}
          {user ? (
            <button type="button" className={styles.action} onClick={() => void logout()} disabled={isLoading}>
              Logout
            </button>
          ) : null}
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
