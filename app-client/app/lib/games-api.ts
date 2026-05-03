import { apiFetch } from "@/app/lib/api";
import {
  normalizeGameCatalogEntry,
  normalizeGameCatalogResponse,
  normalizeGameItemLockerResponse,
  normalizeGameInventoryResponse,
  normalizeGamesSummary,
  normalizeGachaCatalogResponse,
  normalizeGachaPullResult,
  normalizeGachaSpendingLeaderboardResponse,
  normalizeTickerTapLeaderboardResponse,
  normalizeTickerTapSessionCreateResponse,
  normalizeTickerTapSubmitResponse,
} from "@/app/lib/normalizers";

export async function fetchGamesCatalog() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/catalog", { cache: "no-store" });
  return normalizeGameCatalogResponse(result);
}

export async function fetchGameCatalogEntry(gameKey: string) {
  const result = await apiFetch<Record<string, unknown>>(`/api/games/catalog/${encodeURIComponent(gameKey)}`, { cache: "no-store" });
  return normalizeGameCatalogEntry(((result.game || {}) as Record<string, unknown>));
}

export async function fetchGamesSummary() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/me/summary", { cache: "no-store" });
  return normalizeGamesSummary(result);
}

export async function fetchGamesInventory() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/me/inventory", { cache: "no-store" });
  return normalizeGameInventoryResponse(result);
}

export async function fetchGameItemLocker() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/me/item-locker", { cache: "no-store" });
  return normalizeGameItemLockerResponse(result);
}

export async function pullCapsuleGacha(count = 1) {
  const result = await apiFetch<Record<string, unknown>>("/api/games/capsule-gacha/pull", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
  return normalizeGachaPullResult(result);
}

export async function fetchCapsuleGachaCatalog() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/capsule-gacha/catalog", { cache: "no-store" });
  return normalizeGachaCatalogResponse(result);
}

export async function createTickerTapSession() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/ticker-tap/sessions", {
    method: "POST",
  });
  return normalizeTickerTapSessionCreateResponse(result);
}

export async function submitTickerTapSession(sessionId: number, payload: Record<string, unknown>) {
  const result = await apiFetch<Record<string, unknown>>(`/api/games/ticker-tap/sessions/${sessionId}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeTickerTapSubmitResponse(result);
}

export async function fetchTickerTapLeaderboard() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/ticker-tap/leaderboard", { cache: "no-store" });
  return normalizeTickerTapLeaderboardResponse(result);
}

export async function fetchCapsuleGachaSpendingLeaderboard() {
  const result = await apiFetch<Record<string, unknown>>("/api/games/capsule-gacha/spending-leaderboard", { cache: "no-store" });
  return normalizeGachaSpendingLeaderboardResponse(result);
}

export async function fetchUserItemLocker(username: string) {
  const result = await apiFetch<Record<string, unknown>>(`/api/games/${encodeURIComponent(username)}/item-locker`, { cache: "no-store" });
  return normalizeGameItemLockerResponse(result);
}
