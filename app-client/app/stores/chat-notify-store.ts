"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { retainChatRooms, type ChatSocketEvent } from "@/app/lib/chat-socket";
import { messagePreview, tagFromChannel } from "@/app/lib/chat-rooms";
import { isCalm } from "@/app/providers/motion-provider";

// Chat popups. The settings live on the server (api/src/services/chatNotify.js); this store holds
// them, subscribes to the rooms they name, and turns what arrives into at most one popup per room.
//
// How a burst becomes one popup. A message in a quiet room waits HOLD_MS, so the rest of a burst lands
// in the same popup. While that popup is up, more messages update it in place. When it goes, the room
// rests for COOLDOWN_MS; whatever lands meanwhile comes out as one summary at the end. So a busy room
// costs one popup a minute however fast it talks, and the socket handler touches React state at most
// once per FLUSH_MS.

export const CHAT_POPUP = {
  HOLD_MS: 1_500,
  SHOW_MS: 7_000,
  /** A popup that keeps getting new messages still goes after this long. */
  MAX_SHOW_MS: 15_000,
  COOLDOWN_MS: 60_000,
  /** Calm mode: the same popups without motion, a third as often. */
  CALM_COOLDOWN_MS: 180_000,
  MAX_VISIBLE: 3,
  /** A phone shows one at a time, at the top where it can't land on the buy and sell buttons. */
  MAX_VISIBLE_PHONE: 1,
  FLUSH_MS: 1_000,
};

/** Live tables and runs where a popup would land on the controls; the badge still counts. */
const LIVE_GAME_PATH = /^\/games\/(blackjack|duel|high-low|ticker-tap)(\/|$)/;

export type ChatNotifyRoom = {
  key: string;
  tag: string;
  /** The player's own choice: true, false, or null for "only because I posted there". */
  notify: boolean | null;
  posted: boolean;
  unread: number;
};

export type ChatToast = {
  key: string;
  tag: string;
  count: number;
  authors: string[];
  latest: string;
};

type SettingsResponse = {
  enabled: boolean;
  rooms: Array<{ channel_key: string; scope_type: string; display_name: string; metadata: Record<string, unknown>; notify: boolean | null; posted: boolean; unread: number }>;
  muted_players: Array<{ id: number; username: string }>;
};

type Store = {
  loaded: boolean;
  enabled: boolean;
  rooms: Record<string, ChatNotifyRoom>;
  muted: Array<{ id: number; username: string }>;
  mutedIds: ReadonlySet<number>;
  toasts: ChatToast[];
  /** Unread across the rooms on the player's list; the number on the top-bar button. */
  unreadTotal: number;
};

const initial: Store = { loaded: false, enabled: true, rooms: {}, muted: [], mutedIds: new Set(), toasts: [], unreadTotal: 0 };

export const useChatNotifyStore = create<Store>(() => initial);

export const isRoomOn = (room: ChatNotifyRoom | undefined) => Boolean(room && (room.notify ?? room.posted));

// ── Bunching state, outside React ─────────────────────────────────────────
type Bucket = {
  count: number;
  authors: string[];
  latest: string;
  latestId: number;
  showing: boolean;
  shownAt: number;
  holdTimer: number | null;
  hideTimer: number | null;
  restUntil: number;
};

const buckets = new Map<string, Bucket>();
const waiting: string[] = [];
const pendingUnread = new Map<string, number>();
const foreground = new Map<"page" | "window", string | null>();
const retained = new Map<string, () => void>();
let viewerId: number | null = null;
let flushTimer: number | null = null;
let fetchedAt = 0;
let fetchSeq = 0;

const bucketFor = (key: string) => {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { count: 0, authors: [], latest: "", latestId: 0, showing: false, shownAt: 0, holdTimer: null, hideTimer: null, restUntil: 0 };
    buckets.set(key, bucket);
  }
  return bucket;
};

function clearBucketTimers(bucket: Bucket) {
  if (bucket.holdTimer !== null) window.clearTimeout(bucket.holdTimer);
  if (bucket.hideTimer !== null) window.clearTimeout(bucket.hideTimer);
  bucket.holdTimer = null;
  bucket.hideTimer = null;
}

/** Forgets a room's pending popup and takes down the one showing. */
function clearRoomPopups(key: string) {
  const bucket = buckets.get(key);
  if (bucket) {
    clearBucketTimers(bucket);
    bucket.count = 0;
    bucket.authors = [];
    bucket.latest = "";
    bucket.showing = false;
  }
  const at = waiting.indexOf(key);
  if (at !== -1) waiting.splice(at, 1);
  if (!useChatNotifyStore.getState().toasts.some((toast) => toast.key === key)) return;
  useChatNotifyStore.setState((state) => ({ toasts: state.toasts.filter((toast) => toast.key !== key) }));
  showNextWaiting();
}

function showNextWaiting() {
  const next = waiting.shift();
  if (next) show(next);
}

function totalOf(rooms: Record<string, ChatNotifyRoom>) {
  let total = 0;
  for (const room of Object.values(rooms)) if (isRoomOn(room)) total += room.unread;
  return total;
}

function flushUnread() {
  flushTimer = null;
  if (!pendingUnread.size) return;
  const added = new Map(pendingUnread);
  pendingUnread.clear();
  useChatNotifyStore.setState((state) => {
    const rooms = { ...state.rooms };
    for (const [key, count] of added) {
      if (rooms[key]) rooms[key] = { ...rooms[key], unread: rooms[key].unread + count };
    }
    // Popups on screen pick up what landed since the last flush.
    const toasts = state.toasts.map((toast) => {
      const bucket = buckets.get(toast.key);
      return bucket && bucket.showing && bucket.count !== toast.count ? { ...toast, count: bucket.count, authors: bucket.authors, latest: bucket.latest } : toast;
    });
    return { rooms, toasts, unreadTotal: totalOf(rooms) };
  });
}

function queueFlush() {
  if (flushTimer === null) flushTimer = window.setTimeout(flushUnread, CHAT_POPUP.FLUSH_MS);
}

function isForeground(key: string) {
  return !document.hidden && (foreground.get("page") === key || foreground.get("window") === key);
}

function popupsAllowedNow() {
  return !document.hidden && !LIVE_GAME_PATH.test(window.location.pathname);
}

function schedule(key: string, delay: number) {
  const bucket = bucketFor(key);
  if (bucket.showing || bucket.holdTimer !== null) return;
  bucket.holdTimer = window.setTimeout(() => {
    bucket.holdTimer = null;
    show(key);
  }, Math.max(0, delay));
}

function show(key: string) {
  const bucket = bucketFor(key);
  if (!bucket.count || bucket.showing) return;
  const state = useChatNotifyStore.getState();
  const room = state.rooms[key];
  if (!room || !state.enabled || !isRoomOn(room) || isForeground(key)) return clearRoomPopups(key);
  // Away, or at a table: it stays in the bucket and comes out when they're back.
  if (!popupsAllowedNow()) return;
  if (state.toasts.length >= (window.matchMedia("(max-width: 720px)").matches ? CHAT_POPUP.MAX_VISIBLE_PHONE : CHAT_POPUP.MAX_VISIBLE)) {
    if (!waiting.includes(key)) waiting.push(key);
    return;
  }
  bucket.showing = true;
  bucket.shownAt = Date.now();
  bucket.hideTimer = window.setTimeout(() => hide(key), CHAT_POPUP.SHOW_MS);
  useChatNotifyStore.setState((current) => ({ toasts: [...current.toasts, { key, tag: room.tag, count: bucket.count, authors: bucket.authors, latest: bucket.latest }] }));
}

/** A popup's time is up, or the player closed it. The room rests, then says what it's said since. */
function hide(key: string) {
  const bucket = buckets.get(key);
  if (bucket) {
    clearBucketTimers(bucket);
    bucket.showing = false;
    bucket.count = 0;
    bucket.authors = [];
    bucket.latest = "";
    bucket.restUntil = Date.now() + (isCalm() ? CHAT_POPUP.CALM_COOLDOWN_MS : CHAT_POPUP.COOLDOWN_MS);
  }
  useChatNotifyStore.setState((state) => ({ toasts: state.toasts.filter((toast) => toast.key !== key) }));
  showNextWaiting();
}

export function dismissChatToast(key: string) {
  hide(key);
}

function onMessageCreated(raw: Record<string, unknown>, key: string) {
  const author = (raw.author || null) as { id?: unknown; username?: unknown } | null;
  const authorId = Number(author?.id || 0);
  const state = useChatNotifyStore.getState();
  // `is_mine` on a broadcast is about the author, so only the id can say whose this is.
  if (authorId && authorId === viewerId) return notePosted(key);
  const room = state.rooms[key];
  if (!state.enabled || !isRoomOn(room)) return;
  if (raw.status !== "active" || state.mutedIds.has(authorId)) return;
  if (isForeground(key)) return;

  pendingUnread.set(key, (pendingUnread.get(key) ?? 0) + 1);
  queueFlush();

  const bucket = bucketFor(key);
  const name = String(author?.username || "someone");
  bucket.count += 1;
  // Newest first; only the first name and how many others ever show.
  bucket.authors = [name, ...bucket.authors.filter((entry) => entry !== name)].slice(0, 50);
  bucket.latest = messagePreview(String(raw.body || ""), 90);
  bucket.latestId = Number(raw.id || 0);
  if (bucket.showing) {
    // Keep it up a little longer for the new message, but not forever.
    if (bucket.hideTimer !== null) window.clearTimeout(bucket.hideTimer);
    const left = Math.min(CHAT_POPUP.SHOW_MS, bucket.shownAt + CHAT_POPUP.MAX_SHOW_MS - Date.now());
    bucket.hideTimer = window.setTimeout(() => hide(key), Math.max(0, left));
    return;
  }
  schedule(key, Math.max(CHAT_POPUP.HOLD_MS, bucket.restUntil - Date.now()));
}

function onMessageUpdated(raw: Record<string, unknown>, key: string) {
  if (raw.status === "active") return;
  // An admin took it down: it shouldn't be what a popup shows.
  const bucket = buckets.get(key);
  if (!bucket || bucket.latestId !== Number(raw.id || 0) || !bucket.count) return;
  bucket.latest = "";
  bucket.count -= 1;
  if (!bucket.count) clearRoomPopups(key);
  else useChatNotifyStore.setState((state) => ({ toasts: state.toasts.map((toast) => (toast.key === key ? { ...toast, count: bucket.count, latest: "" } : toast)) }));
}

/** Everything on the chat socket comes through here (ChatEverywhere wires it up). */
export function handleChatEventForPopups(event: ChatSocketEvent) {
  if (event.type === "chat.user.notify_changed") {
    // Another tab or device changed something. This tab's own change already has its answer; give
    // that a moment to arrive, so it doesn't load the same settings twice.
    if (Number(event.user_id) === viewerId) {
      window.setTimeout(() => {
        if (Date.now() - fetchedAt > 1_500) void refreshChatNotify(true);
      }, 1_500);
    }
    return;
  }
  if (!event.message || !event.channel_key) return;
  if (event.type === "chat.message.created") onMessageCreated(event.message, event.channel_key);
  else if (event.type === "chat.message.updated") onMessageUpdated(event.message, event.channel_key);
}

// ── Rooms on the socket ───────────────────────────────────────────────────
function syncRetained(state: Pick<Store, "enabled" | "rooms">) {
  const want = new Set(state.enabled ? Object.values(state.rooms).filter(isRoomOn).map((room) => room.key) : []);
  for (const [key, release] of retained) {
    if (want.has(key)) continue;
    release();
    retained.delete(key);
    clearRoomPopups(key);
  }
  for (const key of want) if (!retained.has(key)) retained.set(key, retainChatRooms([key]));
}

function applySettings(data: SettingsResponse) {
  const rooms: Record<string, ChatNotifyRoom> = {};
  for (const row of data.rooms || []) {
    const onScreen = isForeground(row.channel_key);
    rooms[row.channel_key] = {
      key: row.channel_key,
      tag: tagFromChannel(row.scope_type, row.display_name, row.metadata || {}),
      notify: row.notify ?? null,
      posted: Boolean(row.posted),
      unread: onScreen ? 0 : Number(row.unread || 0),
    };
  }
  const muted = (data.muted_players || []).map((row) => ({ id: Number(row.id), username: String(row.username) }));
  const next = { loaded: true, enabled: data.enabled !== false, rooms, muted, mutedIds: new Set(muted.map((row) => row.id)), unreadTotal: totalOf(rooms) };
  useChatNotifyStore.setState(next);
  syncRetained(next);
}

/** Loads the settings. Tab focus asks too, so unforced it goes out at most every couple of minutes. */
export async function refreshChatNotify(force = false) {
  if (viewerId === null || (!force && Date.now() - fetchedAt < 120_000)) return;
  fetchedAt = Date.now();
  const seq = ++fetchSeq;
  try {
    const data = await apiFetch<SettingsResponse>("/api/chat/notify");
    if (seq === fetchSeq && viewerId !== null) applySettings(data);
  } catch {
    /* offline, or signed out meanwhile: the next focus tries again */
  }
}

/** Who the store is for. A new viewer starts from their own settings. */
export function setChatNotifyViewer(id: number | null) {
  if (id === viewerId) return;
  viewerId = id;
  fetchSeq += 1;
  fetchedAt = 0;
  for (const bucket of buckets.values()) clearBucketTimers(bucket);
  buckets.clear();
  waiting.length = 0;
  pendingUnread.clear();
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  for (const release of retained.values()) release();
  retained.clear();
  useChatNotifyStore.setState(initial);
  if (id !== null) void refreshChatNotify(true);
}

// ── What's on screen ──────────────────────────────────────────────────────
/** A room being looked at (the /chat page or the floating window) gets no popups and no unread. */
export function setForegroundRoom(where: "page" | "window", key: string | null) {
  foreground.set(where, key);
  if (key) markRoomSeen(key);
}

export function markRoomSeen(key: string) {
  pendingUnread.delete(key);
  clearRoomPopups(key);
  useChatNotifyStore.setState((state) => {
    if (!state.rooms[key]?.unread) return state;
    const rooms = { ...state.rooms, [key]: { ...state.rooms[key], unread: 0 } };
    return { rooms, unreadTotal: totalOf(rooms) };
  });
}

/** What waited (for the tab, or for a game to end) comes out as one popup per room. */
export function letOutWaitingPopups() {
  for (const [key, bucket] of buckets) {
    if (bucket.count && !bucket.showing && bucket.holdTimer === null) schedule(key, Math.max(CHAT_POPUP.HOLD_MS, bucket.restUntil - Date.now()));
  }
}

/** Coming back to the tab: rooms on screen are seen, and the rest catch up. */
export function chatNotifyOnVisible() {
  for (const key of foreground.values()) if (key) markRoomSeen(key);
  letOutWaitingPopups();
  void refreshChatNotify();
}

/** The player posted here: it's on their list now (unless they turned it off), and read. */
export function notePosted(key: string) {
  markRoomSeen(key);
  const state = useChatNotifyStore.getState();
  const room = state.rooms[key];
  if (room?.posted) return;
  // The next load fills in the room's name; a known one just flips.
  if (room) {
    const rooms = { ...state.rooms, [key]: { ...room, posted: true } };
    const next = { rooms, unreadTotal: totalOf(rooms) };
    useChatNotifyStore.setState(next);
    syncRetained({ enabled: state.enabled, rooms });
    return;
  }
  void refreshChatNotify(true);
}

// ── Changing settings ─────────────────────────────────────────────────────
async function put(path: string, body: unknown, method = "PUT") {
  const data = await apiFetch<SettingsResponse>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  fetchSeq += 1;
  fetchedAt = Date.now();
  applySettings(data);
}

export const setChatPopupsEnabled = (enabled: boolean) => put("/api/chat/notify", { enabled });
export const setChatRoomNotify = (key: string, notify: boolean | null) => put(`/api/chat/channels/${encodeURIComponent(key)}/notify`, { notify });
export const muteChatPlayer = (id: number) => put(`/api/chat/mutes/${id}`, undefined);
export const unmuteChatPlayer = (id: number) => put(`/api/chat/mutes/${id}`, undefined, "DELETE");
