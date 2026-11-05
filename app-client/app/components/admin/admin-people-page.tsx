"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { findUsersByEmail, searchAdminUsers, type AdminUser } from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, fmtCash, fmtCount } from "@/app/components/admin/admin-ui";
import {
  ActionStatus,
  AdminRoleConfirm,
  FreezeConfirm,
  ROLES,
  ResetProfileConfirm,
  RoleSwitch,
  SharedIp,
  SuspendConfirm,
  VerifyEmailConfirm,
  joined,
  liftSuspension,
  saveRoles,
  unfreezeExchange,
  useUserAction,
  when,
} from "@/app/components/admin/admin-user-actions";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-people-page.module.scss";

// /admin/people: find a player and flip their role flags. Admin is a two-step confirm and you
// can't take your own away (the API enforces both). Changes apply on the player's next request.
// Moderation lives here too: freeze someone's exchange, suspend them site-wide (read-only, signed
// out, off the leaderboards) or reset an offensive profile. Each one is logged on /admin/moderation.
// /admin/users lists everyone, and has the same tools plus the account fixes.

const SEARCH_DEBOUNCE_MS = 250;

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
  const action = useUserAction();
  const { busy, confirm, setConfirm } = action;
  const props = { user, action, onSaved };
  const frozen = Boolean(user.exchange_frozen_at);
  const suspension = user.suspension ?? null;
  const isSelf = selfId !== null && String(user.id) === selfId;

  return (
    <li className={styles.user} data-admin={user.is_admin || undefined}>
      <div className={styles.who}>
        <PlayerAvatar username={user.username} pictureUrl={user.profile_picture_url} color={user.profile_color} size={36} />
        <div className={styles.whoText}>
          <p className={styles.name}>
            <Link href={`/admin/users/${user.id}`}>{user.username}</Link>
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
          {user.shared_ip_accounts?.length ? <SharedIp accounts={user.shared_ip_accounts} /> : null}
          <p className={styles.email}>
            {frozen ? (
              <>
                <span className={styles.dim}>
                  Exchange frozen {ago(user.exchange_frozen_at ?? "", now)} ago{user.exchange_frozen_note ? `: ${user.exchange_frozen_note}` : ""}
                </span>
                <button type="button" className={styles.linkBtn} onClick={() => void unfreezeExchange(props)} disabled={Boolean(busy)}>
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
                <button type="button" className={styles.linkBtn} onClick={() => void liftSuspension(props)} disabled={Boolean(busy)}>
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
              onToggle={() => void saveRoles(props, role.key, { [role.key]: !checked }, `${role.label} ${checked ? "removed" : "granted"}`)}
            />
          );
        })}
      </div>

      {confirm === "admin" ? <AdminRoleConfirm {...props} /> : null}
      {confirm === "email" ? <VerifyEmailConfirm {...props} /> : null}
      {confirm === "freeze" ? <FreezeConfirm {...props} /> : null}
      {confirm === "suspend" ? <SuspendConfirm {...props} /> : null}
      {confirm === "reset" ? <ResetProfileConfirm {...props} /> : null}

      <ActionStatus action={action} />
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
  const [ipLinking, setIpLinking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (q: string, r: string) => {
    const id = ++requestRef.current;
    setLoading(true);
    try {
      // An address goes in a POST body, so it stays out of URLs and access logs.
      const result: { users: AdminUser[]; ip_linking?: boolean } = q.includes("@") ? await findUsersByEmail(q.trim()) : await searchAdminUsers(q, r);
      if (id !== requestRef.current) return;
      setUsers(result.users);
      setIpLinking(result.ip_linking !== false);
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
              <div>
                <dt>Shares an IP</dt>
                <dd>
                  {ipLinking
                    ? "Accounts that signed up or played from the same IP address. A lead for alts, not proof: homes, schools and phone networks share one. Only a salted hash is kept, never the address."
                    : "Off: the API has no IP_HASH_SALT, so no IP hashes are being kept."}
                </dd>
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
