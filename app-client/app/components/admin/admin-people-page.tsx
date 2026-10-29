"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  patchExchangeFreeze,
  patchSuspension,
  patchUserRoles,
  resetUserProfile,
  searchAdminUsers,
  type AdminUser,
  type RoleFlag,
  type SuspensionDuration,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, fmtCash, fmtCount } from "@/app/components/admin/admin-ui";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-people-page.module.scss";

// /admin/people: find a player and flip their role flags. Admin is a two-step confirm and you
// can't take your own away (the API enforces both). Changes apply on the player's next request.
// Moderation lives here too: freeze someone's exchange, suspend them site-wide (read-only, signed
// out, off the leaderboards) or reset an offensive profile. Each one is logged on /admin/moderation.

type RoleDef = { key: RoleFlag; label: string; short: string; line: string; filter: string };

const ROLES: RoleDef[] = [
  { key: "is_admin", label: "Admin", short: "Admin", filter: "Admins", line: "Everything: market controls, prizes, predictions and this page." },
  { key: "can_manage_assets", label: "Asset manager", short: "Assets", filter: "Asset managers", line: "Uploads and edits emojis and profile pictures. No prizes, no market." },
  { key: "can_create_prediction_markets", label: "Market creator", short: "Create", filter: "Creators", line: "Writes prediction markets and sends them for approval." },
  { key: "can_approve_prediction_markets", label: "Approver", short: "Approve", filter: "Approvers", line: "Approves or rejects the queue. Not their own markets." },
  { key: "can_resolve_prediction_markets", label: "Resolver", short: "Resolve", filter: "Resolvers", line: "Makes the calls and settles disputes. Someone else confirms theirs." },
  { key: "can_void_prediction_markets", label: "Voider", short: "Void", filter: "Voiders", line: "Voids a market and refunds everyone. The big red button." },
];

const SEARCH_DEBOUNCE_MS = 250;

const SUSPENSION_LENGTHS: { key: SuspensionDuration; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "permanent", label: "Until lifted" },
];

function when(value: string) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function joined(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RoleSwitch({
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

function UserRow({
  user,
  selfId,
  now,
  onSaved,
}: {
  user: AdminUser;
  selfId: string | null;
  now: number;
  onSaved: (next: AdminUser, changed: string[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"admin" | "email" | "freeze" | "suspend" | "reset" | null>(null);
  const [freezeNote, setFreezeNote] = useState("");
  const [suspendLength, setSuspendLength] = useState<SuspensionDuration>("24h");
  const [suspendReason, setSuspendReason] = useState("");
  const [resetReason, setResetReason] = useState("");
  const frozen = Boolean(user.exchange_frozen_at);
  const suspension = user.suspension ?? null;
  const isSelf = selfId !== null && String(user.id) === selfId;

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  async function save(key: string, body: Parameters<typeof patchUserRoles>[1], done: string) {
    setBusy(key);
    setError(null);
    try {
      const result = await patchUserRoles(user.id, body);
      onSaved(result.user, result.changed);
      setFlash(result.changed.length ? done : "No change");
      setConfirm(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function setFreeze(next: boolean) {
    setBusy("exchange");
    setError(null);
    try {
      const result = await patchExchangeFreeze(user.id, { frozen: next, note: next ? freezeNote.trim() || undefined : undefined });
      onSaved(result.user, ["exchange"]);
      setFlash(next ? "Exchange frozen" : "Exchange unfrozen");
      setConfirm(null);
      setFreezeNote("");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function setSuspended(next: boolean) {
    setBusy("suspension");
    setError(null);
    try {
      const result = await patchSuspension(user.id, next ? { suspended: true, duration: suspendLength, reason: suspendReason.trim() } : { suspended: false });
      onSaved(result.user, ["suspension"]);
      setFlash(next ? `Suspended${result.sessions_revoked ? `, signed out of ${result.sessions_revoked} session${result.sessions_revoked === 1 ? "" : "s"}` : ""}` : "Suspension lifted");
      setConfirm(null);
      setSuspendReason("");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  async function resetProfile() {
    setBusy("reset");
    setError(null);
    try {
      const result = await resetUserProfile(user.id, resetReason);
      onSaved(result.user, ["profile"]);
      setFlash(`Reset: ${result.before.username} is now ${result.after.username}`);
      setConfirm(null);
      setResetReason("");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  const adminRole = ROLES[0];

  return (
    <li className={styles.user} data-admin={user.is_admin || undefined}>
      <div className={styles.who}>
        <PlayerAvatar username={user.username} pictureUrl={user.profile_picture_url} color={user.profile_color} size={36} />
        <div className={styles.whoText}>
          <p className={styles.name}>
            <Link href={`/profile/${encodeURIComponent(user.username)}`}>{user.username}</Link>
            {isSelf ? <span className={ui.pill} data-tone="blue">You</span> : null}
            {user.is_admin ? <span className={ui.pill} data-tone="warn">Admin</span> : null}
            {frozen ? (
              <span className={ui.pill} data-tone="warn" title={user.exchange_frozen_note ?? undefined}>
                Exchange frozen
              </span>
            ) : null}
            {suspension ? (
              <span className={ui.pill} data-tone="warn" title={suspension.reason ?? undefined}>
                Suspended
              </span>
            ) : null}
          </p>
          <p className={styles.meta}>
            <span>#{user.id}</span>
            <span>joined {joined(user.created_at)}</span>
            <span>{user.last_seen_at ? `seen ${ago(user.last_seen_at, now)} ago` : "never seen"}</span>
            <span className={styles.cash}>{fmtCash(user.cash, 2)}</span>
            {user.credit !== null && user.credit !== undefined ? <span className={styles.dim}>{fmtCash(user.credit, 2)} Credit</span> : null}
          </p>
          <p className={styles.email}>
            {user.has_email ? <span className={styles.emailAddr}>{user.email_masked}</span> : <span className={styles.dim}>no email on file</span>}
            {user.email_verified ? (
              <span className={ui.pill} data-tone="blue">
                <i aria-hidden="true" />
                Verified
              </span>
            ) : user.has_email ? (
              <>
                <span className={ui.pill} data-tone="dim">
                  Unverified
                </span>
                {confirm === "email" ? null : (
                  <button type="button" className={styles.linkBtn} onClick={() => setConfirm("email")} disabled={Boolean(busy)}>
                    Verify by hand
                  </button>
                )}
              </>
            ) : null}
          </p>
          <p className={styles.email}>
            {frozen ? (
              <>
                <span className={styles.dim}>
                  Exchange frozen {ago(user.exchange_frozen_at ?? "", now)} ago{user.exchange_frozen_note ? `: ${user.exchange_frozen_note}` : ""}
                </span>
                <button type="button" className={styles.linkBtn} onClick={() => void setFreeze(false)} disabled={Boolean(busy)}>
                  {busy === "exchange" ? "Saving…" : "Unfreeze"}
                </button>
              </>
            ) : confirm === "freeze" ? null : (
              <button type="button" className={styles.linkBtn} onClick={() => setConfirm("freeze")} disabled={Boolean(busy)}>
                Freeze exchange
              </button>
            )}
          </p>
          <p className={styles.email}>
            {suspension ? (
              <>
                <span className={styles.dim}>
                  Suspended {suspension.until ? `until ${when(suspension.until)}` : "until lifted"}
                  {suspension.by ? ` by ${suspension.by}` : ""}
                  {suspension.reason ? `: ${suspension.reason}` : ""}
                </span>
                <button type="button" className={styles.linkBtn} onClick={() => void setSuspended(false)} disabled={Boolean(busy)}>
                  {busy === "suspension" ? "Saving…" : "Lift suspension"}
                </button>
              </>
            ) : confirm === "suspend" || user.is_admin || isSelf ? null : (
              <button type="button" className={styles.linkBtn} onClick={() => setConfirm("suspend")} disabled={Boolean(busy)}>
                Suspend…
              </button>
            )}
            {confirm === "reset" ? null : (
              <button type="button" className={styles.linkBtn} onClick={() => setConfirm("reset")} disabled={Boolean(busy)}>
                Reset profile…
              </button>
            )}
          </p>
        </div>
      </div>

      <div className={styles.roles} role="group" aria-label={`Roles for ${user.username}`}>
        {ROLES.map((role) => {
          const checked = user[role.key];
          if (role.key === "is_admin") {
            const lockedSelf = isSelf && checked;
            return (
              <RoleSwitch
                key={role.key}
                role={role}
                checked={checked}
                disabled={lockedSelf}
                busy={busy === role.key}
                title={lockedSelf ? "That's you. Another admin has to take this away." : role.line}
                onToggle={() => setConfirm(confirm === "admin" ? null : "admin")}
              />
            );
          }
          return (
            <RoleSwitch
              key={role.key}
              role={role}
              checked={checked}
              busy={busy === role.key}
              disabled={Boolean(busy)}
              onToggle={() => void save(role.key, { [role.key]: !checked }, `${role.label} ${checked ? "removed" : "granted"}`)}
            />
          );
        })}
      </div>

      {confirm === "admin" ? (
        <div className={styles.confirm} data-tone={user.is_admin ? "danger" : "warn"} role="group" aria-label="Confirm admin change">
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
          <div className={styles.confirmBtns}>
            <button
              type="button"
              className={user.is_admin ? ui.btnDangerSolid : ui.btnPrimary}
              disabled={busy === adminRole.key}
              onClick={() => void save(adminRole.key, { is_admin: !user.is_admin, confirm: true }, user.is_admin ? "Admin removed" : "Admin granted")}
            >
              {busy === adminRole.key ? "Saving…" : user.is_admin ? `Remove admin` : `Yes, make admin`}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm === "email" ? (
        <div className={styles.confirm} data-tone="warn" role="group" aria-label="Confirm email verification">
          <p>
            Mark <b>{user.email_masked}</b> as verified? Only do this if you know the address is theirs. It unlocks trading and paid games.
          </p>
          <div className={styles.confirmBtns}>
            <button type="button" className={ui.btnPrimary} disabled={busy === "email_verified"} onClick={() => void save("email_verified", { email_verified: true }, "Email verified")}>
              {busy === "email_verified" ? "Saving…" : "Verify email"}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm === "freeze" ? (
        <div className={styles.confirm} data-tone="warn" role="group" aria-label="Confirm exchange freeze">
          <p>
            Freeze <b>{user.username}</b> out of the exchange? They can&apos;t list, bid, buy or trade until you unfreeze them. What they already have listed or
            offered runs out as normal.
          </p>
          <input className={ui.input} value={freezeNote} maxLength={200} placeholder="Why (for other admins, optional)" onChange={(event) => setFreezeNote(event.target.value)} />
          <div className={styles.confirmBtns}>
            <button type="button" className={ui.btnDangerSolid} disabled={busy === "exchange"} onClick={() => void setFreeze(true)}>
              {busy === "exchange" ? "Saving…" : "Freeze exchange"}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm === "suspend" ? (
        <form
          className={styles.confirm}
          data-tone="danger"
          aria-label="Confirm suspension"
          onSubmit={(event) => {
            event.preventDefault();
            void setSuspended(true);
          }}
        >
          <p>
            Suspend <b>{user.username}</b> from the whole site? They&apos;re signed out everywhere, can sign back in to read but can&apos;t trade, post, chat
            or play, and drop off the leaderboards until it ends. They see the reason.
          </p>
          <div className={styles.filters} role="radiogroup" aria-label="How long">
            {SUSPENSION_LENGTHS.map((entry) => (
              <button key={entry.key} type="button" role="radio" aria-checked={suspendLength === entry.key} onClick={() => setSuspendLength(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
          <input className={ui.input} value={suspendReason} maxLength={280} required placeholder="Reason (the player sees this)" onChange={(event) => setSuspendReason(event.target.value)} />
          <div className={styles.confirmBtns}>
            <button type="submit" className={ui.btnDangerSolid} disabled={busy === "suspension" || !suspendReason.trim()}>
              {busy === "suspension" ? "Saving…" : "Suspend"}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {confirm === "reset" ? (
        <div className={styles.confirm} data-tone="warn" role="group" aria-label="Confirm profile reset">
          <p>
            Reset <b>{user.username}</b>&apos;s profile? They&apos;re renamed to <b>player_{user.id}</b> and their bio and banner are cleared. They can pick a new
            name afterwards.
          </p>
          <input className={ui.input} value={resetReason} maxLength={280} placeholder="Why (for other admins, optional)" onChange={(event) => setResetReason(event.target.value)} />
          <div className={styles.confirmBtns}>
            <button type="button" className={ui.btnDangerSolid} disabled={busy === "reset"} onClick={() => void resetProfile()}>
              {busy === "reset" ? "Saving…" : "Reset profile"}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.status} aria-live="polite">
        {error ? <p className={ui.inlineError}>{error}</p> : null}
        {flash ? <p className={ui.inlineOk}>{flash}</p> : null}
      </div>
    </li>
  );
}

export function AdminPeoplePage() {
  const access = useAdminAccess();
  const { refreshSession } = useAuth();
  const now = useNow(15_000);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (q: string, r: string) => {
    const id = ++requestRef.current;
    setLoading(true);
    try {
      const result = await searchAdminUsers(q, r);
      if (id !== requestRef.current) return;
      setUsers(result.users);
      setError(null);
    } catch (caught) {
      if (id !== requestRef.current) return;
      setError(adminErrorText(caught));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void run(query, role), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [access.initialized, access.isAdmin, query, role, run]);

  // /admin/people?role=can_manage_assets (linked from the assets page) opens on that filter.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("role");
    if (!wanted || !ROLES.some((entry) => entry.key === wanted)) return;
    const timer = setTimeout(() => setRole(wanted), 0);
    return () => clearTimeout(timer);
  }, []);

  const onSaved = useCallback(
    (next: AdminUser, changed: string[]) => {
      setUsers((current) => (current ? current.map((entry) => (entry.id === next.id ? next : entry)) : current));
      // Your own flags live in the session; reload it so the nav and gates catch up.
      if (changed.length && access.userId === String(next.id)) void refreshSession();
    },
    [access.userId, refreshSession],
  );

  if (!access.initialized) return <AdminLoading title="People & roles" />;
  if (!access.isAdmin) return <AdminGate title="People & roles" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const searching = query.trim().length > 0;
  const filters = [{ key: "", label: searching ? "Everyone" : "All staff" }, ...ROLES.map((entry) => ({ key: entry.key, label: entry.filter }))];

  return (
    <AdminFrame
      title="People & roles"
      blurb={
        users && !searching && !role ? (
          <>
            <b>{users.length}</b> {users.length === 1 ? "person holds" : "people hold"} a role. Changes land on their next click.
          </>
        ) : (
          "Changes land on their next click."
        )
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.searchBar}>
            <label className={styles.search}>
              <span className={ui.srOnly}>Find a player</span>
              <input
                type="search"
                className={ui.input}
                placeholder="Find a player: username or exact email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className={styles.filters} role="radiogroup" aria-label="Filter by role">
              {filters.map((filter) => (
                <button key={filter.key || "all"} type="button" role="radio" aria-checked={role === filter.key} onClick={() => setRole(filter.key)}>
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {error ? <Notice>{error}</Notice> : null}

          <Section
            title={searching ? "Matches" : role ? (ROLES.find((entry) => entry.key === role)?.filter ?? "Staff") : "Staff"}
            count={users ? (users.length >= 50 ? "50+" : users.length) : "…"}
            hint={loading ? "Searching…" : users && users.length >= 50 ? "Showing the first 50. Narrow it down." : undefined}
          >
            {users === null ? (
              <p className={ui.empty}>Loading…</p>
            ) : users.length ? (
              <ul className={styles.users}>
                {users.map((entry) => (
                  <UserRow key={entry.id} user={entry} selfId={access.userId} now={now} onSaved={onSaved} />
                ))}
              </ul>
            ) : (
              <p className={ui.empty}>{searching ? `Nobody matches “${query.trim()}”.` : "Nobody holds that role yet. Search for a player to hand it out."}</p>
            )}
          </Section>
        </div>

        <aside className={styles.side}>
          <Section title="Who can do what">
            <dl className={styles.legend}>
              {ROLES.map((entry) => (
                <div key={entry.key}>
                  <dt>
                    {entry.label} <code>{entry.short}</code>
                  </dt>
                  <dd>{entry.line}</dd>
                </div>
              ))}
              <div>
                <dt>Verified email</dt>
                <dd>Needed to trade or play for cash. Verify by hand if the email never showed up.</dd>
              </div>
            </dl>
            <p className={styles.note}>
              Admin needs a second click, and nobody can take their own admin away. Admins skip the own-market and own-call limits.
            </p>
            <p className={styles.note}>
              Role changes, freezes, suspensions and profile resets are logged on <Link href="/admin/moderation">Moderation</Link>.{" "}
              {users ? `${fmtCount(users.length)} shown.` : null}
            </p>
          </Section>
        </aside>
      </div>
    </AdminFrame>
  );
}
