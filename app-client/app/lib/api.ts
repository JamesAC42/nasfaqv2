import { API_BASE } from "@/app/lib/config";

/** What a thrown apiFetch error carries besides its message (a sentence, or the API's error code). */
export type ApiError = Error & { status: number; code: string | null; body: Record<string, unknown> | null };

/** The API's error code for something apiFetch threw (its message may have become a sentence). */
export function apiErrorCode(error: unknown): string {
  const code = (error as Partial<ApiError> | null)?.code;
  return typeof code === "string" && code ? code : String((error as Error | null)?.message || error || "");
}

/** What a 429 (api/src/rateLimit.js) says to the player, from its retry_after (seconds). */
export function rateLimitedMessage(retryAfter: unknown) {
  const seconds = Math.max(1, Math.ceil(Number(retryAfter) || 60));
  const minutes = Math.ceil(seconds / 60);
  const wait = seconds < 90 ? `${seconds} second${seconds === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `Slow down a little: that's a lot in a short time. Try again in ${wait}.`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status}`;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
      if (typeof body?.error === "string") {
        message = body.error;
      }
    } catch {}
    if (message === "email_verification_required") {
      message = "Verify your email before using this feature.";
    }
    if (message === "account_suspended") {
      message = "Your account is suspended: you can look around, but not trade, post or play until it ends.";
    }
    // services/nameRules.js: slurs and hate speech in a bio, chat, a comment or an article title.
    if (message === "blocked_words") {
      const where = { bio: "Your bio", title: "The title", subtitle: "The subtitle" }[String(body?.field ?? "")] ?? "That";
      message = `${where} has a word that isn't allowed here: slurs and hate speech are off-limits. Edit it and try again.`;
    }
    // api/src/rateLimit.js: too many of something in a short while (or a proxy's own 429 with no body).
    if (message === "rate_limited" || (response.status === 429 && message === "429")) {
      message = rateLimitedMessage(body?.retry_after ?? response.headers.get("retry-after"));
    }
    // The parsed body rides along for callers that want the details (limits, reset times…), and
    // `code` keeps the API's error code wherever the message became a sentence.
    const code = typeof body?.error === "string" ? body.error : response.status === 429 ? "rate_limited" : null;
    throw Object.assign(new Error(message), { status: response.status, body, code });
  }

  return (await response.json()) as T;
}
