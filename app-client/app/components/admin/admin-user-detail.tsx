"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  changeUserEmail,
  clearUserBio,
  fetchUserDetail,
  renameUser,
  sendPasswordResetEmail,
  sendVerificationEmail,
  signOutUser,
  undoV1Link,
  type AdminUser,
  type AdminUserDetail,
  type EmailStatus,
} from "@/app/components/admin/admin-api";
import { ActionLogList } from "@/app/components/admin/admin-action-log";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, fmtCash, until } from "@/app/components/admin/admin-ui";
import {
  ActionStatus,
  AdminRoleConfirm,
  ConfirmBox,
  ConfirmButtons,
  FreezeConfirm,
  PickOne,
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
  type UserAction,
} from "@/app/components/admin/admin-user-actions";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { MUTE_DURATIONS, liftChatRestriction, restrictChatUser } from "@/app/lib/moderation";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-user-detail.module.scss";

// /admin/users/[userId]: one account, what's going on with it, and everything an admin can do to it.
// Roles, moderation and verifying use the same API routes as /admin/people. Every button here is
// admin-only on the server and lands in the admin log, listed at the bottom for this account. Nothing
// here changes a player's money or holdings. The address stays masked: to check one, type the whole
// thing into the search on /admin/users.

type Saved = () => void;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One thing an admin can do: what it is, the button, and its confirmation underneath once pressed. */
function ActionRow({ title, line, button, panel }: { title: string; line: ReactNode; button: ReactNode; panel?: ReactNode }) {
  return (
    <li className={styles.action}>
      <div className={styles.actionText}>
        <b>{title}</b>
        <span>{line}</span>
      </div>
      <div className={styles.actionButton}>{button}</div>
      {panel}
    </li>
  );
}

function OpenButton({ action, name, label, danger }: { action: UserAction; name: string; label: string; danger?: boolean }) {
  return (
    <button type="button" className={danger ? ui.btnDanger : ui.btn} disabled={Boolean(action.busy)} aria-expanded={action.confirm === name} onClick={() => action.setConfirm(action.confirm === name ? null : name)}>
      {label}
    </button>
  );
}

function emailSentLine(status: EmailStatus, sent: string) {
  if (status === "sent") return sent;
  if (status === "not_configured") return "Mail isn't set up on this server, so nothing was sent.";
  if (status === "failed") return "Resend turned it down. Check the API logs and try again.";
  return "Nothing to send.";
}

function RenameForm({ user, action, onSaved }: { user: AdminUser; action: UserAction; onSaved: Saved }) {
  const [username, setUsername] = useState(user.username);
  const [reason, setReason] = useState("");
  const save = () =>
    action.run(
      "rename",
      () => renameUser(user.id, username.trim(), reason),
      (result) => {
        onSaved();
        return result.changed ? `Renamed: ${result.before} is now ${result.after}` : "No change";
      },
    );
  return (
    <ConfirmBox label="Rename" onSubmit={() => void save()}>
      <p>
        Rename <b>{user.username}</b>? The name rules still apply. Their old name is free for anyone to take, and their own 7-day rename wait stays as it was.
      </p>
      <input className={ui.input} value={username} maxLength={32} required aria-label="New username" spellCheck={false} onChange={(event) => setUsername(event.target.value)} />
      <input className={ui.input} value={reason} maxLength={280} aria-label="Why" placeholder="Why (for the log, optional)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="submit" className={ui.btnPrimary} disabled={action.busy === "rename" || !username.trim() || username.trim() === user.username}>
          {action.busy === "rename" ? "Saving…" : "Rename"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function ChangeEmailForm({ user, action, onSaved }: { user: AdminUser; action: UserAction; onSaved: Saved }) {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const save = () =>
    action.run(
      "email-change",
      () => changeUserEmail(user.id, email.trim(), reason.trim()),
      (result) => {
        onSaved();
        const notice = result.notice_email === "failed" ? " The notice to the old address didn't go out." : "";
        return `Email changed. ${emailSentLine(result.verification_email, "The verification link went to the new address.")}${notice}`;
      },
    );
  return (
    <ConfirmBox tone="danger" label="Change email" onSubmit={() => void save()}>
      <p>
        Change the email on <b>{user.username}</b>? This decides where password resets go, so whoever holds the new address can take over this account. Only use an address you&apos;ve checked with the player.
        They go back to unverified until they use the link sent there, so they can&apos;t trade until then. Links already sent to the old address stop working{user.email_verified ? ", and the old address gets a notice" : ""}.
      </p>
      <input className={ui.input} type="email" value={email} maxLength={320} required aria-label="New email address" placeholder="New email address" autoComplete="off" spellCheck={false} onChange={(event) => setEmail(event.target.value)} />
      <input className={ui.input} value={reason} maxLength={280} required aria-label="Why" placeholder="Why, and how you checked (for the log)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="submit" className={ui.btnDangerSolid} disabled={action.busy === "email-change" || !email.trim() || !reason.trim()}>
          {action.busy === "email-change" ? "Saving…" : "Change email"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function ClearBioForm({ user, action, onSaved }: { user: AdminUser; action: UserAction; onSaved: Saved }) {
  const [reason, setReason] = useState("");
  const save = () =>
    action.run(
      "bio",
      () => clearUserBio(user.id, reason),
      (result) => {
        onSaved();
        return result.changed ? "Bio cleared" : "No change";
      },
    );
  return (
    <ConfirmBox label="Clear bio">
      <p>
        Clear <b>{user.username}</b>&apos;s bio? Their name and everything else stay. The admin log keeps what it said.
      </p>
      <input className={ui.input} value={reason} maxLength={280} aria-label="Why" placeholder="Why (for the log, optional)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === "bio"} onClick={() => void save()}>
          {action.busy === "bio" ? "Saving…" : "Clear bio"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function SignOutForm({ user, action, onSaved }: { user: AdminUser; action: UserAction; onSaved: Saved }) {
  const [reason, setReason] = useState("");
  const save = () =>
    action.run(
      "sign-out",
      () => signOutUser(user.id, reason),
      (result) => {
        onSaved();
        return `Signed out of ${result.sessions_revoked} session${result.sessions_revoked === 1 ? "" : "s"}`;
      },
    );
  return (
    <ConfirmBox label="Sign out everywhere">
      <p>
        Sign <b>{user.username}</b> out on every device? Open tabs drop too. They can sign straight back in with their password. Queued orders stay queued.
      </p>
      <input className={ui.input} value={reason} maxLength={280} aria-label="Why" placeholder="Why (for the log, optional)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === "sign-out"} onClick={() => void save()}>
          {action.busy === "sign-out" ? "Saving…" : "Sign out everywhere"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function SendEmailConfirm({ user, action, onSaved, kind }: { user: AdminUser; action: UserAction; onSaved: Saved; kind: "verification" | "reset" }) {
  const key = `send-${kind}`;
  const save = () =>
    action.run(
      key,
      () => (kind === "reset" ? sendPasswordResetEmail(user.id) : sendVerificationEmail(user.id)),
      (result) => {
        onSaved();
        return emailSentLine(result.status, `Sent to ${user.email_masked}`);
      },
    );
  return (
    <ConfirmBox label={kind === "reset" ? "Send password reset" : "Send verification email"}>
      <p>
        {kind === "reset" ? (
          <>
            Email <b>{user.email_masked}</b> a password reset link? You don&apos;t see the link, and nothing changes unless they use it within the hour. Using it signs them out everywhere else and marks the
            address verified.
          </>
        ) : (
          <>
            Email a new verification link to <b>{user.email_masked}</b>? You don&apos;t see the link.
          </>
        )}
      </p>
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnPrimary} disabled={action.busy === key} onClick={() => void save()}>
          {action.busy === key ? "Sending…" : "Send it"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function ChatRestrictForm({ user, action, onSaved, kind }: { user: AdminUser; action: UserAction; onSaved: Saved; kind: "mute" | "ban" }) {
  const [minutes, setMinutes] = useState<number>(60);
  const [reason, setReason] = useState("");
  const key = `chat-${kind}`;
  const save = () =>
    action.run(
      key,
      () => restrictChatUser(user.id, kind, { minutes: kind === "mute" ? minutes : null, reason }),
      () => {
        onSaved();
        return kind === "mute" ? "Muted in all of chat" : "Banned from chat";
      },
    );
  return (
    <ConfirmBox tone={kind === "ban" ? "danger" : "warn"} label={kind === "mute" ? "Mute in chat" : "Ban from chat"}>
      <p>
        {kind === "mute" ? (
          <>
            Mute <b>{user.username}</b> in all of chat? They can still read.
          </>
        ) : (
          <>
            Ban <b>{user.username}</b> from chat until someone lifts it? For a timed one, use a mute.
          </>
        )}
      </p>
      {kind === "mute" ? <PickOne label="How long" options={MUTE_DURATIONS.map((entry) => ({ key: entry.minutes as number, label: entry.label }))} value={minutes} onChange={setMinutes} /> : null}
      <input className={ui.input} value={reason} maxLength={280} aria-label="Why" placeholder="Why (for the log, optional)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === key} onClick={() => void save()}>
          {action.busy === key ? "Saving…" : kind === "mute" ? "Mute" : "Ban"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function V1UndoForm({ user, v1Username, action, onSaved }: { user: AdminUser; v1Username: string; action: UserAction; onSaved: Saved }) {
  const [reason, setReason] = useState("");
  const save = () =>
    action.run(
      "v1",
      () => undoV1Link(user.id, reason.trim()),
      () => {
        onSaved();
        return `Undid the link to ${v1Username}`;
      },
    );
  return (
    <ConfirmBox tone="danger" label="Undo the v1 link">
      <p>
        Undo the link between <b>{user.username}</b> and <b>{v1Username}</b> on v1? The badge and theme are taken back, and the v1 account can link again.
      </p>
      <input className={ui.input} value={reason} maxLength={280} aria-label="Why" placeholder="Why (for the log)" onChange={(event) => setReason(event.target.value)} />
      <ConfirmButtons onCancel={() => action.setConfirm(null)}>
        <button type="button" className={ui.btnDangerSolid} disabled={action.busy === "v1"} onClick={() => void save()}>
          {action.busy === "v1" ? "Saving…" : "Undo the link"}
        </button>
      </ConfirmButtons>
    </ConfirmBox>
  );
}

function AccountSection({ detail, isSelf, action, onSaved, now }: { detail: AdminUserDetail; isSelf: boolean; action: UserAction; onSaved: Saved; now: number }) {
  const { user, bio } = detail;
  const props = { user, action, onSaved };
  const panel = (name: string, node: ReactNode) => (action.confirm === name ? node : null);
  return (
    <Section title="Account">
      <dl className={styles.facts}>
        <Fact label="Email">
          {user.has_email ? <span className={styles.mono}>{user.email_masked}</span> : <span className={styles.dim}>none on file</span>}{" "}
          {user.email_verified ? (
            <span className={ui.pill} data-tone="blue">
              <i aria-hidden="true" />
              Verified
            </span>
          ) : (
            <span className={ui.pill} data-tone="dim">
              Unverified
            </span>
          )}
        </Fact>
        <Fact label="Verified">{user.email_verified_at ? when(user.email_verified_at) : "—"}</Fact>
        <Fact label="Last verification email">{detail.verification_sent_at ? `${ago(detail.verification_sent_at, now)} ago` : "—"}</Fact>
        <Fact label="Last password reset email">{detail.password_reset_sent_at ? `${ago(detail.password_reset_sent_at, now)} ago` : "—"}</Fact>
        <Fact label="Joined">{joined(user.created_at)}</Fact>
        <Fact label="Last seen">{user.last_seen_at ? `${ago(user.last_seen_at, now)} ago` : "never"}</Fact>
        <Fact label="Renamed themselves">{detail.username_changed_at ? joined(detail.username_changed_at) : "never"}</Fact>
        <Fact label="Bio">{bio ? <span className={styles.bio}>{bio}</span> : <span className={styles.dim}>none</span>}</Fact>
      </dl>

      <ul className={styles.actions}>
        {!user.email_verified && user.has_email ? (
          <>
            <ActionRow
              title="Verify email"
              line="Mark the address as theirs, for when the email never showed up. It unlocks trading and paid games."
              button={<OpenButton action={action} name="verify" label="Verify…" />}
              panel={panel("verify", <VerifyEmailConfirm {...props} />)}
            />
            <ActionRow
              title="Send verification email"
              line="The same link they can ask for themselves, to the address on file."
              button={<OpenButton action={action} name="send-verification" label="Send…" />}
              panel={panel("send-verification", <SendEmailConfirm user={user} action={action} onSaved={onSaved} kind="verification" />)}
            />
          </>
        ) : null}
        {user.has_email ? (
          <ActionRow
            title="Send password reset"
            line="For someone locked out. The link goes to the address on file, and you never see it."
            button={<OpenButton action={action} name="send-reset" label="Send…" />}
            panel={panel("send-reset", <SendEmailConfirm user={user} action={action} onSaved={onSaved} kind="reset" />)}
          />
        ) : null}
        <ActionRow
          title="Rename"
          line="Fix a username. The name rules still apply."
          button={<OpenButton action={action} name="rename" label="Rename…" />}
          panel={panel("rename", <RenameForm user={user} action={action} onSaved={onSaved} />)}
        />
        <ActionRow
          title={user.has_email ? "Change email" : "Add email"}
          line={isSelf || user.is_admin ? "Not available on admin accounts. Take admin away first." : "For an address typed wrong at sign-up, or one they've lost. Players can't change their own."}
          button={isSelf || user.is_admin ? null : <OpenButton action={action} name="change-email" label="Change…" danger />}
          panel={panel("change-email", <ChangeEmailForm user={user} action={action} onSaved={onSaved} />)}
        />
        {bio ? (
          <ActionRow
            title="Clear bio"
            line="Only the bio. The name stays."
            button={<OpenButton action={action} name="clear-bio" label="Clear…" danger />}
            panel={panel("clear-bio", <ClearBioForm user={user} action={action} onSaved={onSaved} />)}
          />
        ) : null}
        <ActionRow
          title="Reset profile"
          line={
            <>
              Rename to <code>player_{user.id}</code> and clear the bio and banner, for an offensive profile.
            </>
          }
          button={<OpenButton action={action} name="reset" label="Reset…" danger />}
          panel={panel("reset", <ResetProfileConfirm {...props} />)}
        />
        {isSelf ? null : (
          <ActionRow
            title="Sign out everywhere"
            line="For a stolen session or a shared computer. Their password stays the same."
            button={<OpenButton action={action} name="sign-out" label="Sign out…" danger />}
            panel={panel("sign-out", <SignOutForm user={user} action={action} onSaved={onSaved} />)}
          />
        )}
      </ul>
    </Section>
  );
}

function ModerationSection({ detail, isSelf, action, onSaved, now }: { detail: AdminUserDetail; isSelf: boolean; action: UserAction; onSaved: Saved; now: number }) {
  const { user } = detail;
  const props = { user, action, onSaved };
  const panel = (name: string, node: ReactNode) => (action.confirm === name ? node : null);
  const suspension = user.suspension ?? null;
  const frozen = Boolean(user.exchange_frozen_at);
  const muted = detail.chat_restrictions.filter((entry) => entry.action_type === "mute");
  const banned = detail.chat_restrictions.filter((entry) => entry.action_type === "ban");
  const lift = (kind: "unmute" | "unban") =>
    action.run(
      `chat-${kind}`,
      () => liftChatRestriction(user.id, kind),
      (result) => {
        onSaved();
        return result.lifted ? (kind === "unmute" ? "Unmuted" : "Unbanned") : "No change";
      },
    );
  return (
    <Section id="moderation" title="Moderation">
      <ul className={styles.actions}>
        <ActionRow
          title="Suspension"
          line={
            suspension ? (
              <>
                Suspended {suspension.until ? `until ${when(suspension.until)}` : "until lifted"}
                {suspension.by ? ` by ${suspension.by}` : ""}
                {suspension.reason ? `: ${suspension.reason}` : ""}
              </>
            ) : user.is_admin || isSelf ? (
              "Admins can't be suspended. Take admin away first."
            ) : (
              "Read-only site-wide, signed out, off the leaderboards. They see the reason."
            )
          }
          button={
            suspension ? (
              <button type="button" className={ui.btn} disabled={Boolean(action.busy)} onClick={() => void liftSuspension(props)}>
                {action.busy === "suspension" ? "Saving…" : "Lift suspension"}
              </button>
            ) : user.is_admin || isSelf ? null : (
              <OpenButton action={action} name="suspend" label="Suspend…" danger />
            )
          }
          panel={panel("suspend", <SuspendConfirm {...props} />)}
        />
        <ActionRow
          title="Exchange"
          line={
            frozen ? (
              <>
                Frozen {ago(user.exchange_frozen_at ?? "", now)} ago{user.exchange_frozen_note ? `: ${user.exchange_frozen_note}` : ""}
              </>
            ) : (
              "Shut them out of the card and item exchange. Stock trading, games and chat carry on."
            )
          }
          button={
            frozen ? (
              <button type="button" className={ui.btn} disabled={Boolean(action.busy)} onClick={() => void unfreezeExchange(props)}>
                {action.busy === "exchange" ? "Saving…" : "Unfreeze"}
              </button>
            ) : (
              <OpenButton action={action} name="freeze" label="Freeze…" danger />
            )
          }
          panel={panel("freeze", <FreezeConfirm {...props} />)}
        />
        <ActionRow
          title="Chat"
          line={
            detail.chat_restrictions.length ? (
              detail.chat_restrictions.map((entry) => (
                <span key={entry.id} className={styles.line}>
                  {entry.action_type === "ban" ? "Banned" : "Muted"} {entry.channel_name ? `in ${entry.channel_name}` : "in all of chat"}
                  {entry.expires_at ? `, ends ${until(entry.expires_at, now)}` : ", until lifted"}
                  {entry.created_by ? ` by ${entry.created_by}` : ""}
                  {entry.reason ? `: ${entry.reason}` : ""}
                </span>
              ))
            ) : (
              "Free to chat."
            )
          }
          button={
            <span className={styles.buttonRow}>
              {muted.length ? (
                <button type="button" className={ui.btn} disabled={Boolean(action.busy)} onClick={() => void lift("unmute")}>
                  Unmute
                </button>
              ) : isSelf ? null : (
                <OpenButton action={action} name="mute" label="Mute…" danger />
              )}
              {banned.length ? (
                <button type="button" className={ui.btn} disabled={Boolean(action.busy)} onClick={() => void lift("unban")}>
                  Unban
                </button>
              ) : isSelf ? null : (
                <OpenButton action={action} name="ban" label="Ban…" danger />
              )}
            </span>
          }
          panel={
            <>
              {panel("mute", <ChatRestrictForm user={user} action={action} onSaved={onSaved} kind="mute" />)}
              {panel("ban", <ChatRestrictForm user={user} action={action} onSaved={onSaved} kind="ban" />)}
            </>
          }
        />
      </ul>
    </Section>
  );
}

function RolesSection({ detail, isSelf, action, onSaved }: { detail: AdminUserDetail; isSelf: boolean; action: UserAction; onSaved: Saved }) {
  const { user } = detail;
  const props = { user, action, onSaved };
  return (
    <Section title="Roles" hint="Land on their next click. Admin and asset manager also need their email added to Cloudflare Access.">
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
                busy={action.busy === role.key}
                title={lockedSelf ? "That's you. Another admin has to take this away." : role.line}
                onToggle={() => action.setConfirm(action.confirm === "admin" ? null : "admin")}
              />
            );
          }
          return (
            <RoleSwitch
              key={role.key}
              role={role}
              checked={checked}
              busy={action.busy === role.key}
              disabled={Boolean(action.busy)}
              onToggle={() => void saveRoles(props, role.key, { [role.key]: !checked }, `${role.label} ${checked ? "removed" : "granted"}`)}
            />
          );
        })}
      </div>
      {action.confirm === "admin" ? <AdminRoleConfirm {...props} /> : null}
    </Section>
  );
}

export function AdminUserDetailPage({ userId }: { userId: number }) {
  const access = useAdminAccess();
  const { refreshSession } = useAuth();
  const now = useNow(15_000);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = useUserAction();

  const load = useCallback(async () => {
    try {
      setDetail(await fetchUserDetail(userId));
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }, [userId]);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [access.initialized, access.isAdmin, load]);

  const isSelf = access.userId === String(userId);
  const onSaved = useCallback(() => {
    void load();
    // Your own flags live in the session; reload it so the nav and gates catch up.
    if (isSelf) void refreshSession();
  }, [load, isSelf, refreshSession]);

  if (!access.initialized) return <AdminLoading title="User" />;
  if (!access.isAdmin) return <AdminGate title="User" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const backLink = (
    <Link href="/admin/users" className={ui.btn}>
      All users
    </Link>
  );

  if (!detail) {
    return (
      <AdminFrame title="User" aside={backLink}>
        {error ? <Notice>{error}</Notice> : <p className={ui.empty}>Loading…</p>}
      </AdminFrame>
    );
  }

  const { user } = detail;
  const props = { detail, isSelf, action, onSaved };

  return (
    <AdminFrame
      kicker={`Users · #${user.id}`}
      title={user.username}
      blurb={
        <span className={styles.pills}>
          <PlayerAvatar username={user.username} pictureUrl={user.profile_picture_url} color={user.profile_color} size={28} />
          {isSelf ? <span className={ui.pill} data-tone="blue">You</span> : null}
          {user.is_admin ? <span className={ui.pill} data-tone="warn">Admin</span> : null}
          {user.suspension ? <span className={ui.pill} data-tone="warn">Suspended</span> : null}
          {user.exchange_frozen_at ? <span className={ui.pill} data-tone="warn">Exchange frozen</span> : null}
          {detail.chat_restrictions.length ? <span className={ui.pill} data-tone="warn">Chat restricted</span> : null}
          {detail.chat_reports.open ? <span className={ui.pill} data-tone="warn">{detail.chat_reports.open} open report{detail.chat_reports.open === 1 ? "" : "s"}</span> : null}
        </span>
      }
      aside={
        <>
          <Link href={`/profile/${encodeURIComponent(user.username)}`} className={ui.btn}>
            Public profile
          </Link>
          {backLink}
        </>
      }
    >
      {error ? <Notice>{error}</Notice> : null}
      <div className={styles.statusBar}>
        <ActionStatus action={action} />
      </div>
      <div className={styles.layout}>
        <div className={styles.main}>
          <AccountSection {...props} now={now} />
          <ModerationSection {...props} now={now} />
          <RolesSection {...props} />
          {detail.v1_link ? (
            <Section title="v1 account">
              <ul className={styles.actions}>
                <ActionRow
                  title={detail.v1_link.v1_username}
                  line={`Joined v1 on ${joined(detail.v1_link.v1_joined_at)}. Linked ${ago(detail.v1_link.linked_at, now)} ago.`}
                  button={<OpenButton action={action} name="v1" label="Undo…" danger />}
                  panel={action.confirm === "v1" ? <V1UndoForm user={user} v1Username={detail.v1_link.v1_username} action={action} onSaved={onSaved} /> : null}
                />
              </ul>
            </Section>
          ) : null}
          <Section title="Admin history" count={detail.history.length} hint="What admins have done to this account, newest first. The full log is on Moderation.">
            {detail.history.length ? <ActionLogList entries={detail.history} now={now} showTarget={false} /> : <p className={ui.empty}>Nothing yet.</p>}
          </Section>
        </div>

        <aside className={styles.side}>
          <Section title="Money" hint="Read-only">
            <dl className={styles.facts}>
              <Fact label="Cash">
                <span className={styles.mono}>{fmtCash(user.cash, 2)}</span>
              </Fact>
              <Fact label="Credit">
                <span className={styles.mono}>{fmtCash(user.credit, 2)}</span>
              </Fact>
              <Fact label="Holdings">
                <span className={styles.mono}>{fmtCash(detail.holdings_value, 2)}</span>
              </Fact>
              <Fact label="Net worth">
                <span className={styles.mono}>{fmtCash(user.net_worth, 2)}</span>
              </Fact>
            </dl>
            <p className={styles.note}>Nothing on this page changes a player&apos;s money or holdings.</p>
          </Section>
          <Section title="Chat reports" count={detail.chat_reports.open} tone={detail.chat_reports.open ? "warn" : undefined}>
            <p className={styles.note}>
              {detail.chat_reports.total} against their messages in all. <Link href="/admin/moderation#reports">Open the queue</Link>
            </p>
          </Section>
          <Section title="Other accounts">
            {user.shared_ip_accounts?.length ? (
              <>
                <SharedIp accounts={user.shared_ip_accounts} href={(account) => `/admin/users/${account.id}`} />
                <p className={styles.note}>A lead for alts, not proof: homes, schools and phone networks share an address. Only a salted hash of it is kept.</p>
              </>
            ) : (
              <p className={styles.note}>{detail.ip_linking === false ? "Off: the API has no IP_HASH_SALT, so no IP hashes are being kept." : "No other account has used the same IP address."}</p>
            )}
            <p className={styles.note}>
              <Link href="/admin/exchange">Exchange review</Link> shows lopsided trades.
            </p>
          </Section>
        </aside>
      </div>
    </AdminFrame>
  );
}
