"use client";

import Link from "next/link";
import type { AdminAction } from "@/app/components/admin/admin-api";
import { ago } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-moderation-page.module.scss";

// How an entry in the admin log (market.admin_actions) reads, on /admin/moderation and on one
// account's page.

const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended",
  "user.unsuspend": "Lifted suspension",
  "user.reset_profile": "Reset profile",
  "user.rename": "Renamed",
  "user.email_change": "Changed the email of",
  "user.clear_bio": "Cleared the bio of",
  "user.sign_out": "Signed out",
  "user.verification_email": "Sent a verification email to",
  "user.password_reset_email": "Sent a password reset email to",
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

const EMAIL_STATUS_LABELS: Record<string, string> = {
  sent: "sent",
  failed: "the send failed",
  not_configured: "not sent: no mail set up here",
};

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
  if (entry.action === "user.rename") return text(d.before) ? `was ${text(d.before)}` : null;
  if (entry.action === "user.email_change") return `${text(d.before) ?? "none"} to ${text(d.after) ?? "none"}`;
  if (entry.action === "user.clear_bio") return text(d.bio) ? `“${text(d.bio)}”` : null;
  if (entry.action === "user.sign_out") return typeof d.sessions_revoked === "number" ? `${d.sessions_revoked} session${d.sessions_revoked === 1 ? "" : "s"}` : null;
  if (entry.action === "user.verification_email" || entry.action === "user.password_reset_email") return EMAIL_STATUS_LABELS[String(d.status)] ?? null;
  if (entry.action === "user.roles") {
    return (
      Object.entries(d)
        .map(([key, value]) => (key === "email_verified" ? "email verified by hand" : `${key.replace(/^can_|_prediction_markets$/g, "")} ${value ? "on" : "off"}`))
        .join(", ") || null
    );
  }
  if (entry.action.startsWith("comment.") || entry.action === "chat.message.remove") return text(d.excerpt) ? `“${text(d.excerpt)}”` : null;
  if (entry.action === "chat.mute" || entry.action === "chat.ban") return d.expires_at ? `until ${new Date(String(d.expires_at)).toLocaleString()}` : "until lifted";
  if (entry.action.startsWith("site.announcement")) return text(d.text) ? `“${text(d.text)}”` : null;
  if (entry.action === "announcement.update") return Array.isArray(d.changed) && d.changed.length ? `changed ${d.changed.join(", ").replaceAll("_", " ")}` : null;
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

/** The entries, newest first. `showTarget` is off on one account's page, where it's always them. */
export function ActionLogList({ entries, now, showTarget = true }: { entries: AdminAction[]; now: number; showTarget?: boolean }) {
  return (
    <ol className={styles.log}>
      {entries.map((entry) => {
        const target = showTarget ? targetText(entry) : null;
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
                  {entry.target_type === "user" && entry.target_id ? <Link href={`/admin/users/${entry.target_id}`}>{target}</Link> : <span>{target}</span>}
                </>
              ) : null}
              {entry.reason ? <span className={styles.reason}> · {entry.reason}</span> : null}
              {detail ? <span className={styles.detail}> · {detail}</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
