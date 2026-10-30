import { apiErrorCode, apiFetch } from "@/app/lib/api";

// Moderation actions taken outside /admin: players reporting chat messages, and admins removing
// messages, muting or banning from chat and hiding comments where they read them. The API is in
// api/src/routes/chat.js and api/src/routes/admin.js; every admin action lands in the log on
// /admin/moderation.

/** Reasons a player can pick when reporting a chat message. */
export const REPORT_REASONS = ["Spam", "Harassment", "Hate or slurs", "Personal information", "Something else"] as const;

export const reportChatMessage = (messageId: number, reason: string, details?: string) =>
  apiFetch<{ report: { id: number; status: string } }>(`/api/chat/messages/${messageId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason, details: details?.trim() || undefined }),
  });

export const removeChatMessage = (messageId: number, reason?: string) =>
  apiFetch<{ message: Record<string, unknown>; reports_resolved: number }>(`/api/chat/messages/${messageId}/moderate`, {
    method: "POST",
    body: JSON.stringify({ status: "moderated", reason: reason?.trim() || undefined }),
  });

/** Mute choices in the chat menu, in minutes. */
export const MUTE_DURATIONS = [
  { minutes: 10, label: "10 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 24 * 60, label: "24 hours" },
  { minutes: 7 * 24 * 60, label: "7 days" },
] as const;

/** Mutes or bans a player from all of chat (site-wide); no duration is until lifted. */
export const restrictChatUser = (userId: number, actionType: "mute" | "ban", { minutes, reason }: { minutes?: number | null; reason?: string } = {}) =>
  apiFetch<{ action: Record<string, unknown> }>(`/api/chat/users/${userId}/moderation`, {
    method: "POST",
    body: JSON.stringify({ action_type: actionType, duration_minutes: minutes ?? undefined, reason: reason?.trim() || undefined }),
  });

export const liftChatRestriction = (userId: number, kind: "unmute" | "unban", reason?: string) =>
  apiFetch<{ lifted: number }>(`/api/chat/users/${userId}/${kind}`, { method: "POST", body: JSON.stringify({ reason: reason?.trim() || undefined }) });

export type CommentKind = "stock" | "article" | "prediction";

/** Hides (or brings back) a comment. Hidden ones are gone for everyone but admins. */
export const setCommentHidden = (kind: CommentKind, commentId: number, hidden: boolean, reason?: string) =>
  apiFetch<{ comment: { kind: CommentKind; id: number; hidden_at: string | null; hidden_reason: string | null } }>(`/api/admin/comments/${kind}/${commentId}/hide`, {
    method: "POST",
    body: JSON.stringify({ hidden, reason: reason?.trim() || undefined }),
  });

const ERRORS: Record<string, string> = {
  invalid_chat_report: "Pick a reason. (You can't report your own messages.)",
  chat_message_not_found: "That message is gone.",
  comment_not_found: "That comment is gone.",
  invalid_chat_moderation: "The API didn't accept that.",
  forbidden: "Admins only.",
  unauthenticated: "Sign in first.",
  rate_limited: "That's a lot of reports. Try again later.",
};

export function moderationErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return ERRORS[apiErrorCode(error)] ?? (message || "Something went wrong.");
}
