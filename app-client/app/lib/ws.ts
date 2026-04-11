const LIVESTREAM_WS_PATH = "/api/livestreams/ws";
const BUCKET_WS_PATH = "/api/livestreams/buckets/ws";
const SITE_STATS_WS_PATH = "/api/stats/ws";
const CHAT_WS_PATH = "/api/chat/ws";

function toWsBase(base: string) {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  return trimmed;
}

export function getLivestreamWsUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_WS_API_BASE ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE) : "";
  const base = explicitBase || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${LIVESTREAM_WS_PATH}` : "";
}

export function getBucketWsUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_WS_API_BASE ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE) : "";
  const base = explicitBase || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${BUCKET_WS_PATH}` : "";
}

export function getSiteStatsWsUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_WS_API_BASE ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE) : "";
  const base = explicitBase || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${SITE_STATS_WS_PATH}` : "";
}

export function getChatWsUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_WS_API_BASE ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE) : "";
  const base = explicitBase || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${CHAT_WS_PATH}` : "";
}
