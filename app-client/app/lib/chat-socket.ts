"use client";

import { useSyncExternalStore } from "react";
import { getChatWsUrl } from "@/app/lib/ws";

// One chat socket per tab, shared by whatever wants rooms: /chat, the floating window and the popups.
// Rooms are ref-counted like the games socket (use-games-socket.ts): the first to want a room
// subscribes on the server, the last one out unsubscribes.
//
// It only stays open while something needs it. No rooms wanted means no socket (a player who turned
// popups off costs nothing), and a tab left hidden for a minute lets go of it until it's looked at
// again, unless a page holds it open with holdChatSocket. Whoever wants a gap-free room refetches when
// useChatSocketStatus comes back to "open".

export type ChatSocketStatus = "connecting" | "open" | "closed";
export type ChatSocketEvent = { type: string; channel_key?: string | null; user_id?: number; message?: Record<string, unknown>; channel?: Record<string, unknown> };

/** The server takes this many rooms per subscribe message. */
const SUBSCRIBE_CHUNK = 20;
const SYNC_DELAY_MS = 120;
const HIDDEN_RELEASE_MS = 60_000;
const IDLE_CLOSE_MS = 20_000;

const wanted = new Map<string, number>();
const listeners = new Set<(event: ChatSocketEvent) => void>();
const statusListeners = new Set<() => void>();
/** Rooms this socket has asked the server for. */
const onServer = new Set<string>();

let socket: WebSocket | null = null;
let status: ChatSocketStatus = "closed";
let holds = 0;
let retries = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenReleased = false;
let syncQueued = false;
let visibilityBound = false;

function setStatus(next: ChatSocketStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((notify) => notify());
}

const needed = () => holds > 0 || wanted.size > 0;

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
  return null;
}

function send(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** Brings the server in line with `wanted`, a batch at a time. */
function syncRooms() {
  syncQueued = false;
  if (socket?.readyState !== WebSocket.OPEN) return;
  const drop = [...onServer].filter((key) => !wanted.has(key));
  const add = [...wanted.keys()].filter((key) => !onServer.has(key));
  if (drop.length) {
    send({ action: "unsubscribe", channel_keys: drop });
    drop.forEach((key) => onServer.delete(key));
  }
  for (let start = 0; start < add.length; start += SUBSCRIBE_CHUNK) {
    const chunk = add.slice(start, start + SUBSCRIBE_CHUNK);
    send({ action: "subscribe", channel_keys: chunk });
    chunk.forEach((key) => onServer.add(key));
  }
}

/** Soon, not now: flipping through rooms shouldn't spend the socket's message allowance (30 per 10s). */
function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(syncRooms, SYNC_DELAY_MS);
}

function connect() {
  if (typeof window === "undefined" || socket || hiddenReleased) return;
  const url = getChatWsUrl();
  if (!url) return;
  setStatus("connecting");
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    retries = 0;
    onServer.clear();
    setStatus("open");
    syncRooms();
  };
  ws.onmessage = (event) => {
    let payload: ChatSocketEvent;
    try {
      payload = JSON.parse(String(event.data || "")) as ChatSocketEvent;
    } catch {
      return;
    }
    listeners.forEach((listener) => listener(payload));
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    onServer.clear();
    setStatus("closed");
    reconnectTimer = clearTimer(reconnectTimer);
    if (!needed() || hiddenReleased) return;
    // Every open tab reconnects after a deploy; the jitter keeps them from all arriving at once.
    const delay = Math.min(15_000, 600 * 2 ** retries) + Math.random() * 1_000;
    retries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => ws.close();
}

function closeSocket() {
  const ws = socket;
  socket = null;
  onServer.clear();
  reconnectTimer = clearTimer(reconnectTimer);
  ws?.close();
  setStatus("closed");
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    hiddenTimer = clearTimer(hiddenTimer);
    if (hiddenReleased) {
      hiddenReleased = false;
      retries = 0;
      if (needed()) connect();
    }
    return;
  }
  if (hiddenTimer) return;
  hiddenTimer = setTimeout(() => {
    hiddenTimer = null;
    if (document.visibilityState !== "hidden" || holds > 0) return;
    hiddenReleased = true;
    closeSocket();
  }, HIDDEN_RELEASE_MS);
}

function wake() {
  idleTimer = clearTimer(idleTimer);
  if (typeof document === "undefined") return;
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden") onVisibility();
  }
  if (!socket && !reconnectTimer) connect();
  else queueSync();
}

function maybeIdle() {
  if (needed() || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!needed()) closeSocket();
  }, IDLE_CLOSE_MS);
}

/** Keeps these rooms subscribed until the returned function is called. */
export function retainChatRooms(keys: string[]) {
  for (const key of keys) wanted.set(key, (wanted.get(key) ?? 0) + 1);
  wake();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of keys) {
      const left = (wanted.get(key) ?? 1) - 1;
      if (left > 0) wanted.set(key, left);
      else wanted.delete(key);
    }
    queueSync();
    maybeIdle();
  };
}

/** Every event on this tab's socket, whichever room asked for it. */
export function onChatSocketEvent(listener: (event: ChatSocketEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps the socket open even with no rooms and in a hidden tab (the /chat page, as it always did). */
export function holdChatSocket() {
  holds += 1;
  if (hiddenReleased) {
    hiddenReleased = false;
    retries = 0;
  }
  wake();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    maybeIdle();
    if (holds === 0 && typeof document !== "undefined" && document.visibilityState === "hidden") {
      hiddenTimer = clearTimer(hiddenTimer);
      onVisibility();
    }
  };
}

/** Signing in or out: the socket learns who it belongs to when it connects, so it starts over. */
export function reconnectChatSocket() {
  if (!socket && !reconnectTimer) return;
  closeSocket();
  retries = 0;
  if (needed()) connect();
}

export function useChatSocketStatus() {
  return useSyncExternalStore(
    (notify) => {
      statusListeners.add(notify);
      return () => statusListeners.delete(notify);
    },
    () => status,
    (): ChatSocketStatus => "connecting",
  );
}
