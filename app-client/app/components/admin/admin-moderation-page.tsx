"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  fetchActiveChatRestrictions,
  fetchAdminActions,
  fetchChatReports,
  setChatReportStatus,
  type AdminAction,
  type ChatReport,
  type ChatReportStatus,
  type ChatRestrictionEntry,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, until } from "@/app/components/admin/admin-ui";
import { liftChatRestriction, removeChatMessage } from "@/app/lib/moderation";
import styles from "@/app/components/admin/admin-moderation-page.module.scss";

// /admin/moderation: the chat report queue (remove the message, or close the report), the mutes
// and bans in force, and the log of every admin action from the moderation tools. Suspensions and
// profile resets are on /admin/people; hiding a comment is a button on the comment itself.

const POLL_MS = 30_000;

const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended",
  "user.unsuspend": "Lifted suspension",
  "user.reset_profile": "Reset profile",
  "user.v1_unlink": "Undid the v1 link of",
  "user.roles": "Changed roles",
  "user.exchange_freeze": "Froze exchange",
  "user.exchange_unfreeze": "Unfroze exchange",
  "comment.hide": "Hid comment",
  "comment.unhide": "Unhid comment",
  "chat.message.remove": "Removed chat message",
  "chat.mute": "Muted in chat",
  "chat.ban": "Banned from chat",
  "chat.unmute": "Unmuted",
  "chat.unban": "Unbanned",
  "chat.report.resolve": "Resolved report",
  "chat.report.dismiss": "Dismissed report",
  "chat.report.reopen": "Reopened report",
  "chat.channel.update": "Changed chat room",
  "site.announcement.post": "Posted announcement",
  "site.announcement.clear": "Cleared announcement",
  "announcement.create": "Wrote the popup",
  "announcement.update": "Edited the popup",
  "announcement.retire": "Retired the popup",
  "announcement.restore": "Brought back the popup",
  "announcement.delete": "Deleted the popup",
  "news.thumbnail.remove": "Removed the thumbnail of",
  "news.front_page.pins": "Changed the front page pins",
};

const TARGET_LABELS: Record<string, string> = {
  stock_comment: "stock board",
  article_comment: "article",
  prediction_comment: "prediction",
};

const chatHref = (channelKey: string) => `/chat?channel=${encodeURIComponent(channelKey)}`;

/** One line of what else the log entry recorded, where there's something worth showing. */
function detailLine(entry: AdminAction): string | null {
  const d = entry.details;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (entry.action === "user.suspend") return d.until ? `until ${new Date(String(d.until)).toLocaleString()}` : "until lifted";
  if (entry.action === "user.v1_unlink") return text(d.v1_username) ? `v1 account ${text(d.v1_username)}` : null;
  if (entry.action === "user.reset_profile") {
    const after = d.after && typeof d.after === "object" ? text((d.after as Record<string, unknown>).username) : null;
    return after ? `now ${after}` : null;
  }
  if (entry.action === "user.roles") return Object.entries(d).map(([key, value]) => `${key.replace(/^can_|_prediction_markets$/g, "")} ${value ? "on" : "off"}`).join(", ") || null;
  if (entry.action.startsWith("comment.") || entry.action === "chat.message.remove") return text(d.excerpt) ? `“${text(d.excerpt)}”` : null;
  if (entry.action === "chat.mute" || entry.action === "chat.ban") return d.expires_at ? `until ${new Date(String(d.expires_at)).toLocaleString()}` : "until lifted";
  if (entry.action.startsWith("site.announcement")) return text(d.text) ? `“${text(d.text)}”` : null;
  if (entry.action === "news.front_page.pins") return Array.isArray(d.after) ? (d.after.length ? `${d.after.length} pinned` : "none pinned") : null;
  return null;
}

function targetText(entry: AdminAction) {
  if (entry.target_type === "user") return entry.target_label ?? `#${entry.target_id}`;
  if (entry.target_type && TARGET_LABELS[entry.target_type]) return `${entry.target_label ?? "someone"} on ${TARGET_LABELS[entry.target_type]}`;
  if (entry.target_type === "chat_message" || entry.target_type === "chat_report") return entry.target_label ?? null;
  if (entry.target_type === "chat_channel") return entry.target_label ?? entry.target_id;
  if (entry.target_type === "news_article" || entry.target_type === "announcement") return entry.target_label ?? entry.target_id;
  return null;
}

function ReportQueue({ now, onChanged }: { now: number; onChanged: () => void }) {
  const [status, setStatus] = useState<ChatReportStatus>("open");
  const [data, setData] = useState<{ reports: ChatReport[]; open_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchChatReports(status));
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }, [status]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const act = async (report: ChatReport, work: () => Promise<unknown>) => {
    setBusyId(report.id);
    try {
      await work();
      await load();
      onChanged();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section
      id="reports"
      title="Chat reports"
      count={data ? data.open_count : "…"}
      tone={data?.open_count ? "warn" : undefined}
      actions={
        <span className={styles.tabs}>
          {(["open", "resolved", "dismissed"] as const).map((key) => (
            <button key={key} type="button" className={ui.btn} aria-pressed={status === key} onClick={() => setStatus(key)}>
              {key === "open" ? "Open" : key === "resolved" ? "Resolved" : "Dismissed"}
            </button>
          ))}
        </span>
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data ? (
        <p className={ui.empty}>Loading…</p>
      ) : data.reports.length ? (
        <ul className={styles.list}>
          {data.reports.map((report) => {
            const live = report.message.status === "active";
            return (
              <li key={report.id} className={styles.report}>
                <div className={styles.meta}>
                  <b>{report.reason}</b>
                  <span>
                    by <Link href={`/profile/${encodeURIComponent(report.reporter.username)}`}>{report.reporter.username}</Link>
                  </span>
                  <span title={new Date(report.created_at).toLocaleString()}>{ago(report.created_at, now)} ago</span>
                  {report.open_reports > 1 ? (
                    <span className={ui.pill} data-tone="warn">
                      {report.open_reports} open reports
                    </span>
                  ) : null}
                  {report.reviewed_by ? <span>closed by {report.reviewed_by}</span> : null}
                </div>
                {report.details ? <p className={styles.details}>{report.details}</p> : null}
                <blockquote className={styles.quote} data-removed={!live || undefined}>
                  <span className={styles.quoteHead}>
                    <Link href={`/profile/${encodeURIComponent(report.message.author.username)}`}>{report.message.author.username}</Link> in{" "}
                    <Link href={chatHref(report.message.channel_key)}>{report.message.channel_name}</Link>
                    {!live ? <em> · {report.message.status === "moderated" ? "removed" : "deleted"}</em> : null}
                  </span>
                  <span className={styles.quoteBody}>{report.message.body}</span>
                </blockquote>
                <div className={styles.buttons}>
                  {report.status === "open" ? (
                    <>
                      {live ? (
                        <button
                          type="button"
                          className={ui.btnDangerSolid}
                          disabled={busyId === report.id}
                          onClick={() => void act(report, () => removeChatMessage(report.message.id, `Reported: ${report.reason}`))}
                        >
                          Remove message
                        </button>
                      ) : null}
                      <button type="button" className={ui.btnPrimary} disabled={busyId === report.id} onClick={() => void act(report, () => setChatReportStatus(report.id, "resolved"))}>
                        Resolve
                      </button>
                      <button type="button" className={ui.btnGhost} disabled={busyId === report.id} onClick={() => void act(report, () => setChatReportStatus(report.id, "dismissed"))}>
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button type="button" className={ui.btn} disabled={busyId === report.id} onClick={() => void act(report, () => setChatReportStatus(report.id, "open"))}>
                      Reopen
                    </button>
                  )}
                  <Link href={chatHref(report.message.channel_key)} className={styles.sideLink}>
                    Open the room →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={ui.empty}>{status === "open" ? "Nothing to review. Players report messages from the ⋯ menu in chat." : `No ${status} reports.`}</p>
      )}
    </Section>
  );
}

function Restrictions({ now, revision, onChanged }: { now: number; revision: number; onChanged: () => void }) {
  const [rows, setRows] = useState<ChatRestrictionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await fetchActiveChatRestrictions()).actions);
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load, revision]);

  const lift = async (entry: ChatRestrictionEntry) => {
    setBusyId(entry.id);
    try {
      await liftChatRestriction(entry.user.id, entry.action_type === "ban" ? "unban" : "unmute");
      await load();
      onChanged();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title="Chat mutes & bans" count={rows ? rows.length : "…"}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!rows ? (
        <p className={ui.empty}>Loading…</p>
      ) : rows.length ? (
        <ul className={styles.list}>
          {rows.map((entry) => (
            <li key={entry.id} className={styles.restriction}>
              <div className={styles.meta}>
                <span className={ui.pill} data-tone={entry.action_type === "ban" ? "warn" : "blue"}>
                  {entry.action_type === "ban" ? "Banned" : "Muted"}
                </span>
                <Link href={`/profile/${encodeURIComponent(entry.user.username)}`}>
                  <b>{entry.user.username}</b>
                </Link>
                <span>{entry.channel_name ? `in ${entry.channel_name}` : "all of chat"}</span>
              </div>
              <p className={styles.details}>
                {entry.expires_at ? `Ends ${until(entry.expires_at, now)}` : "Until lifted"}
                {entry.created_by ? ` · by ${entry.created_by}` : ""}
                {entry.reason ? ` · ${entry.reason}` : ""}
              </p>
              <button type="button" className={ui.btn} disabled={busyId === entry.id} onClick={() => void lift(entry)}>
                {busyId === entry.id ? "Lifting…" : entry.action_type === "ban" ? "Unban" : "Unmute"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={ui.empty}>Nobody is muted or banned. Do it from a message&apos;s ⋯ menu in chat.</p>
      )}
    </Section>
  );
}

function ActionLog({ now, revision }: { now: number; revision: number }) {
  const [rows, setRows] = useState<AdminAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await fetchAdminActions(60)).actions);
      setError(null);
    } catch (caught) {
      setError(adminErrorText(caught));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, revision]);

  return (
    <Section id="log" title="Admin log" hint="Every action from the moderation tools, newest first">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!rows ? (
        <p className={ui.empty}>Loading…</p>
      ) : rows.length ? (
        <ol className={styles.log}>
          {rows.map((entry) => {
            const target = targetText(entry);
            const detail = detailLine(entry);
            return (
              <li key={entry.id}>
                <time dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString()}>
                  {ago(entry.created_at, now)}
                </time>
                <p>
                  <b>{entry.actor?.username ?? "someone"}</b> {(ACTION_LABELS[entry.action] ?? entry.action).toLowerCase()}
                  {target ? (
                    <>
                      {" "}
                      {entry.target_type === "user" ? <Link href={`/profile/${encodeURIComponent(target)}`}>{target}</Link> : <span>{target}</span>}
                    </>
                  ) : null}
                  {entry.reason ? <span className={styles.reason}> · {entry.reason}</span> : null}
                  {detail ? <span className={styles.detail}> · {detail}</span> : null}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={ui.empty}>Nothing logged yet.</p>
      )}
    </Section>
  );
}

export function AdminModerationPage() {
  const access = useAdminAccess();
  const now = useNow(15_000);
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  if (!access.initialized) return <AdminLoading title="Moderation" />;
  if (!access.isAdmin) return <AdminGate title="Moderation" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  return (
    <AdminFrame title="Moderation" blurb="Chat reports, who's muted or banned, and what every admin did. Suspend or reset a player from People & roles.">
      <div className={styles.layout}>
        <div className={styles.main}>
          <ReportQueue now={now} onChanged={bump} />
          <ActionLog now={now} revision={revision} />
        </div>
        <aside className={styles.side}>
          <Restrictions now={now} revision={revision} onChanged={bump} />
          <Section title="Tools">
            <dl className={styles.howto}>
              <div>
                <dt>Chat</dt>
                <dd>Hover a message and open ⋯ to remove it, or mute or ban its author.</dd>
              </div>
              <div>
                <dt>Comments</dt>
                <dd>Admins see a Hide button on stock board, article and prediction comments. Hidden ones stay visible to admins, marked.</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>
                  <Link href="/admin/people">People &amp; roles</Link>: suspend site-wide, reset a profile, freeze the exchange.
                </dd>
              </div>
              <div>
                <dt>Everyone</dt>
                <dd>
                  Post an announcement banner from the <Link href="/admin">back office</Link>.
                </dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </AdminFrame>
  );
}
