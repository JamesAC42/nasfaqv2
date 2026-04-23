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
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {}
    if (message === "email_verification_required") {
      message = "Verify your email before using this feature.";
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}
