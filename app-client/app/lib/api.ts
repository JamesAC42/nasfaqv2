import { API_BASE } from "@/app/lib/config";

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
    // The parsed body rides along for callers that want the details (limits, reset times…).
    throw Object.assign(new Error(message), { status: response.status, body });
  }

  return (await response.json()) as T;
}
