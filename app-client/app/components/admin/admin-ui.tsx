"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "@/app/components/admin/admin-ui.module.scss";

// Small building blocks shared by the /admin pages: section heads, stat cells, notices, switches
// and in-page tabs. Styles live in admin-ui.module.scss.

export { styles as adminUi };

export function Section({
  id,
  title,
  count,
  hint,
  tone,
  actions,
  children,
  className,
}: {
  id?: string;
  title: string;
  count?: number | string;
  hint?: ReactNode;
  tone?: "warn";
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} id={id} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId}>
          {title}
          {count !== undefined ? <b data-tone={tone}>{count}</b> : null}
        </h2>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Notice({ tone = "error", children, onClose }: { tone?: "error" | "ok" | "info"; children: ReactNode; onClose?: () => void }) {
  return (
    <p className={styles.notice} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </p>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  on = "On",
  off = "Off",
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  on?: string;
  off?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.switch} disabled={disabled} onClick={() => onChange(!checked)}>
      <i aria-hidden="true" />
      <span>{checked ? on : off}</span>
    </button>
  );
}

export type TabDef<K extends string> = { key: K; label: string; count?: number | string; tone?: "warn" };

/** In-page tabs. Keeps the choice in the URL hash so a reload or a shared link lands on the same tab. */
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: TabDef<K>[]; value: K; onChange: (key: K) => void; label: string }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`tab-${tab.key}`}
          aria-selected={value === tab.key}
          aria-controls={`panel-${tab.key}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? <small data-tone={tab.tone}>{tab.count}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function useHashTab<K extends string>(keys: readonly K[], fallback: K, setTab: (key: K) => void) {
  const keysRef = useRef(keys);
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.replace(/^#/, "") as K;
      if (keysRef.current.includes(hash)) setTab(hash);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [setTab]);
  return (key: K) => {
    setTab(key);
    try {
      window.history.replaceState(null, "", key === fallback ? window.location.pathname + window.location.search : `#${key}`);
    } catch {
      /* history blocked */
    }
  };
}

// ── Formatting ────────────────────────────────────────────────────────────

export function fmtCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function fmtCash(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? "−" : ""}$${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 100_000) return `${value < 0 ? "−" : ""}$${Math.round(abs / 1000)}k`;
  return `${value < 0 ? "−" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "12s", "4m", "3h", "2d" ago. */
export function ago(at: string | number | null | undefined, now = Date.now()) {
  if (at === null || at === undefined) return "—";
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** "in 4m 09s", "in 2h 05m", "3m late". */
export function until(at: string | number | null | undefined, now = Date.now()) {
  if (at === null || at === undefined) return "—";
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "—";
  const ms = t - now;
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return ms >= 0 ? `in ${text}` : `${text} late`;
}

/** Time in New York, where the market's clock lives: "Sep 25, 15:00 ET". */
export function etTime(value: string | number | null | undefined, withDate = true) {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const text = date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: withDate ? "short" : undefined,
    day: withDate ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${text} ET`;
}

/** Market dates come back as midnight ET in UTC ("2026-09-25T04:00:00Z"); show the ET date key. */
export function marketDateKey(value: string | null | undefined) {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** API error codes → copy. */
export function adminErrorText(error: unknown) {
  const code = error instanceof Error ? error.message : String(error ?? "");
  const map: Record<string, string> = {
    forbidden: "You don't have the role for that.",
    unauthenticated: "Your session ran out. Sign in again.",
    "401": "Your session ran out. Sign in again.",
    "403": "You don't have the role for that.",
    "404": "That endpoint isn't there. Is the API up to date?",
    "502": "Can't reach the API.",
    cannot_remove_own_admin: "You can't take your own admin away. Ask another admin.",
    admin_change_needs_confirm: "Admin changes need the second click to confirm.",
    cannot_unverify_email: "Emails can be verified here, not unverified.",
    user_not_found: "That user doesn't exist any more.",
    invalid_role: "The API didn't accept that change.",
    invalid_admin_asset: "The API rejected that file. Check the size and format.",
    s3_not_configured: "S3 isn't configured on this server, so uploads and syncs can't run.",
    invalid_market_tuning: "The API rejected those numbers.",
    missing_market_date: "No market date to tick. Settle a day first.",
    settlement_already_completed: "That day is already settled.",
    invalid_market_date: "That market date isn't valid.",
    market_settling: "The daily settlement is running. Try again in a minute.",
    market_not_closed: "Trading isn't paused (it may have been reopened already).",
    "Failed to fetch": "Can't reach the API.",
  };
  return map[code] ?? (code || "Something went wrong.");
}
