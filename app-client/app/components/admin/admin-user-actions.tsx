"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  patchExchangeFreeze,
  patchSuspension,
  patchUserRoles,
  resetUserProfile,
  type AdminUser,
  type LinkedAccount,
  type RoleFlag,
  type SuspensionDuration,
} from "@/app/components/admin/admin-api";
import { adminErrorText, adminUi as ui } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-user-actions.module.scss";

// What /admin/people and the /admin/users detail page share: the role definitions and switches, the
// confirmation for each moderation action, and the state they run on. Every one of these calls an
// admin-only API route that writes to the admin log (market.admin_actions).

export type RoleDef = { key: RoleFlag; label: string; short: string; line: string; filter: string };

export const ROLES: RoleDef[] = [
  { key: "is_admin", label: "Admin", short: "Admin", filter: "Admins", line: "Everything: market controls, prizes, predictions and this page." },
  { key: "can_manage_assets", label: "Asset manager", short: "Assets", filter: "Asset managers", line: "Uploads and edits emojis and profile pictures. No prizes, no market." },
  { key: "can_create_prediction_markets", label: "Market creator", short: "Create", filter: "Creators", line: "Retired with the market maker: it does nothing while pools are on. Give Bookie to anyone who should open pools." },
  { key: "can_approve_prediction_markets", label: "Approver", short: "Approve", filter: "Approvers", line: "Approves or rejects the queue. Not their own markets." },
  { key: "can_resolve_prediction_markets", label: "Resolver", short: "Resolve", filter: "Resolvers", line: "Makes the calls and settles disputes. Someone else confirms theirs." },
  { key: "can_void_prediction_markets", label: "Voider", short: "Void", filter: "Voiders", line: "Voids a market and refunds everyone. The big red button." },
  { key: "is_bookie", label: "Bookie", short: "Bookie", filter: "Bookies", line: "Opens prediction pools without approval and picks the winners. Can't bet in their own pools." },
];

const SUSPENSION_LENGTHS: { key: SuspensionDuration; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "permanent", label: "Until lifted" },
];

export function when(value: string) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function joined(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Other accounts that have used the same IP address: a lead for alts, not proof (homes and schools
 * share one). `href` says where each name goes; by default, their public profile.
 */
export function SharedIp({ accounts, href }: { accounts: LinkedAccount[]; href?: (account: LinkedAccount) => string }) {
  const shown = accounts.slice(0, 8);
  return (
    <p className={styles.sharedIp}>
      <span className={ui.pill} data-tone="warn" title="Has used the same IP address as these accounts (only a salted hash of it is kept)">
        Shares an IP
      </span>
      <span className={styles.dim}>with</span>
      {shown.map((account) => (
        <Link key={account.id} href={href ? href(account) : `/profile/${encodeURIComponent(account.username)}`} title={`joined ${joined(account.created_at)}${account.email_verified ? "" : ", unverified"}${account.suspended ? ", suspended" : ""}`}>
          {account.username}
          {account.suspended ? " (suspended)" : ""}
        </Link>
      ))}
      {accounts.length > shown.length ? <span className={styles.dim}>+{accounts.length - shown.length} more</span> : null}
    </p>
  );
}

export function RoleSwitch({
  role,
  checked,
  disabled,
  busy,
  title,
  onToggle,
}: {
  role: RoleDef;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.role}
      data-admin={role.key === "is_admin" || undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title ?? role.line}
      onClick={onToggle}
    >
      <i aria-hidden="true" />
      <span>{role.short}</span>
    </button>
  );
}

// ── Running an action ────────────────────────────────────────────────────

export type UserAction = {
  /** Which action is running, by its key. */
  busy: string | null;
  error: string | null;
  flash: string | null;
  /** Which confirmation is open, by its key. */
  confirm: string | null;
  setConfirm: (key: string | null) => void;
  /** Runs `work`, then hands the result to `done`, which returns the line to flash. Closes the confirmation if it worked. */
  run: <T>(key: string, work: () => Promise<T>, done: (result: T) => string) => Promise<void>;
};

export function useUserAction(): UserAction {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setOpenConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  // Opening or closing a confirmation also clears what the last try said.
  function setConfirm(key: string | null) {
    setError(null);
    setOpenConfirm(key);
  }

  async function run<T>(key: string, work: () => Promise<T>, done: (result: T) => string) {
    setBusy(key);
    setError(null);
    try {
      const result = await work();
      setFlash(done(result));
      setOpenConfirm(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, flash, confirm, setConfirm, run };
}

export function ActionStatus({ action }: { action: UserAction }) {
  return (
    <div className={styles.status} aria-live="polite">
      {action.error ? <p className={ui.inlineError}>{action.error}</p> : null}
      {action.flash ? <p className={ui.inlineOk}>{action.flash}</p> : null}
    </div>
  );
}

type ActionProps = { user: AdminUser; action: UserAction; onSaved: (user: AdminUser, changed: string[]) => void };

/** Flips role flags (and verifies an email), reporting whether anything really changed. */
export function saveRoles({ user, action, onSaved }: ActionProps, key: string, body: Parameters<typeof patchUserRoles>[1], done: string) {
  return action.run(
    key,
    () => patchUserRoles(user.id, body),
    (result) => {
      onSaved(result.user, result.changed);
      return result.changed.length ? done : "No change";
    },
  );
}

export function unfreezeExchange({ user, action, onSaved }: ActionProps) {
  return action.run(
    "exchange",
    () => patchExchangeFreeze(user.id, { frozen: false }),
    (result) => {
      onSaved(result.user, ["exchange"]);
      return "Exchange unfrozen";
    },
  );
}

export function liftSuspension({ user, action, onSaved }: ActionProps) {
  return action.run(
    "suspension",
    () => patchSuspension(user.id, { suspended: false }),
    (result) => {
      onSaved(result.user, ["suspension"]);
      return "Suspension lifted";
    },
  );
}

// ── Confirmations ────────────────────────────────────────────────────────

/** The box every confirmation sits in. */
export function ConfirmBox({ tone = "warn", label, children, onSubmit }: { tone?: "warn" | "danger"; label: string; children: ReactNode; onSubmit?: () => void }) {
  if (onSubmit) {
    return (
      <form
        className={styles.confirm}
        data-tone={tone}
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    );
  }
  return (
    <div className={styles.confirm} data-tone={tone} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function ConfirmButtons({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  return (
    <div className={styles.confirmBtns}>
      {children}
      <button type="button" className={ui.btnGhost} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** A row of pills to pick one from: how long, and so on. */
export function PickOne<K extends string | number>({ label, options, value, onChange }: { label: string; options: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  return (
    <div className={styles.pickOne} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.key} type="button" role="radio" aria-checked={value === option.key} onClick={() => onChange(option.key)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AdminRoleConfirm(props: ActionProps) {
  const { user, action } = props;
  return (
    <ConfirmBox tone={user.is_admin ? "danger" : "warn"} label="Confirm admin change">
      <p>
        {user.is_admin ? (
          <>
            Take admin away from <b>{user.username}</b>? They lose market controls, prizes and this page.
          </>
        ) : (
          <>
            Make <b>{user.username}</b> a full admin? They get everything: market resets, prizes, roles, predictions.
          </>
        )}
      </p>
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button
          type="button"
          className={user.is_admin ? ui.btnDangerSolid : ui.btnPrimary}
          disabled={action.busy === "is_admin"}
          onClick={() => void saveRoles(props, "is_admin", { is_admin: !user.is_admin, confirm: true }, user.is_admin ? "Admin removed" : "Admin granted")}
        >
          {action.busy === "is_admin" ? "Saving…" : user.is_admin ? `Remove admin` : `Yes, make admin`}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

export function VerifyEmailConfirm(props: ActionProps) {
  const { user, action } = props;
  return (
    <ConfirmBox label="Confirm email verification">
      <p>
        Mark <b>{user.email_masked}</b> as verified? Only do this if you know the address is theirs. It unlocks trading and paid games.
      </p>
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnPrimary} disabled={action.busy === "email_verified"} onClick={() => void saveRoles(props, "email_verified", { email_verified: true }, "Email verified")}>
          {action.busy === "email_verified" ? "Saving…" : "Verify email"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

export function FreezeConfirm({ user, action, onSaved }: ActionProps) {
  const [note, setNote] = useState("");
  const freeze = () =>
    action.run(
      "exchange",
      () => patchExchangeFreeze(user.id, { frozen: true, note: note.trim() || undefined }),
      (result) => {
        onSaved(result.user, ["exchange"]);
        return "Exchange frozen";
      },
    );
  return (
    <ConfirmBox label="Confirm exchange freeze">
      <p>
        Freeze <b>{user.username}</b>{" "}out of the exchange? They can&apos;t list, bid, buy or trade until you unfreeze them. What they already have listed or
        offered runs out as normal.
      </p>
      <input className={ui.input} value={note} maxLength={200} placeholder="Why (for other admins, optional)" onChange={(event) => setNote(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === "exchange"} onClick={() => void freeze()}>
          {action.busy === "exchange" ? "Saving…" : "Freeze exchange"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

export function SuspendConfirm({ user, action, onSaved }: ActionProps) {
  const [length, setLength] = useState<SuspensionDuration>("24h");
  const [reason, setReason] = useState("");
  const suspend = () =>
    action.run(
      "suspension",
      () => patchSuspension(user.id, { suspended: true, duration: length, reason: reason.trim() }),
      (result) => {
        onSaved(result.user, ["suspension"]);
        return `Suspended${result.sessions_revoked ? `, signed out of ${result.sessions_revoked} session${result.sessions_revoked === 1 ? "" : "s"}` : ""}`;
      },
    );
  return (
    <ConfirmBox tone="danger" label="Confirm suspension" onSubmit={() => void suspend()}>
      <p>
        Suspend <b>{user.username}</b>{" "}from the whole site? They&apos;re signed out everywhere, can sign back in to read but can&apos;t trade, post, chat
        or play, and drop off the leaderboards until it ends. They see the reason.
      </p>
      <PickOne label="How long" options={SUSPENSION_LENGTHS} value={length} onChange={setLength} />
      <input className={ui.input} value={reason} maxLength={280} required placeholder="Reason (the player sees this)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="submit" className={ui.btnDangerSolid} disabled={action.busy === "suspension" || !reason.trim()}>
          {action.busy === "suspension" ? "Saving…" : "Suspend"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

export function ResetProfileConfirm({ user, action, onSaved }: ActionProps) {
  const [reason, setReason] = useState("");
  const reset = () =>
    action.run(
      "reset",
      () => resetUserProfile(user.id, reason),
      (result) => {
        onSaved(result.user, ["profile"]);
        return `Reset: ${result.before.username} is now ${result.after.username}`;
      },
    );
  return (
    <ConfirmBox label="Confirm profile reset">
      <p>
        Reset <b>{user.username}</b>&apos;s profile? They&apos;re renamed to <b>player_{user.id}</b>{" "}and their bio and banner are cleared. They can pick a new
        name afterwards.
      </p>
      <input className={ui.input} value={reason} maxLength={280} placeholder="Why (for other admins, optional)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === "reset"} onClick={() => void reset()}>
          {action.busy === "reset" ? "Saving…" : "Reset profile"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}
