"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getGamesWsUrl } from "@/app/lib/ws";

// One shared socket to /api/games/ws for every lobby and table on the page. Channels are
// ref-counted: the first subscriber subscribes on the server, the last one out unsubscribes.
// The server sends a snapshot on subscribe, then pushes every change. Messages carry `channel`.
//
// HTTP action responses are fed back in with `primeChannel` so the UI moves the moment the
// request returns, without waiting for the push. Payloads with a `server_time` older than
// what we already have are dropped, so a late push never rewinds the table.

type Payload = { channel?: string; server_time?: number; [key: string]: unknown };

const latest = new Map<string, Payload>();
const listeners = new Map<string, Set<() => void>>();
const statusListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let connected = false;
let retries = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let clockOffset = 0;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach((notify) => notify());
}

function activeChannels() {
  return [...listeners.entries()].filter(([, set]) => set.size > 0).map(([channel]) => channel);
}

function send(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** server_time sits on the payload or, for table pushes, on payload.table. */
function stampOf(payload: Payload | undefined) {
  if (!payload) return null;
  if (typeof payload.server_time === "number") return payload.server_time;
  const table = payload.table as { server_time?: unknown } | undefined;
  return typeof table?.server_time === "number" ? table.server_time : null;
}

function accept(channel: string, payload: Payload) {
  const previous = latest.get(channel);
  // Spectator-count pings only carry the count: merge it into the table we already have.
  if (payload.type === "spectators") {
    if (previous && previous.table && typeof previous.table === "object") {
      latest.set(channel, { ...previous, table: { ...(previous.table as object), spectators: payload.spectators } });
      listeners.get(channel)?.forEach((notify) => notify());
    }
    return;
  }
  const stamp = stampOf(payload);
  const previousStamp = stampOf(previous);
  if (previousStamp && stamp && stamp < previousStamp) return;
  if (stamp) clockOffset = stamp - Date.now();
  latest.set(channel, payload);
  listeners.get(channel)?.forEach((notify) => notify());
}

function connect() {
  if (typeof window === "undefined" || socket) return;
  const url = getGamesWsUrl();
  if (!url) return;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    retries = 0;
    setConnected(true);
    const channels = activeChannels();
    if (channels.length) send({ action: "subscribe", channels });
  };
  ws.onmessage = (event) => {
    let payload: Payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (payload.channel) accept(payload.channel, payload);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    setConnected(false);
    if (!activeChannels().length) return;
    const delay = Math.min(15_000, 600 * 2 ** retries) + Math.random() * 400;
    retries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => ws.close();
}

function addListener(channel: string, notify: () => void) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  const first = set.size === 0;
  set.add(notify);
  if (!socket && !reconnectTimer) connect();
  else if (first) send({ action: "subscribe", channels: [channel] });

  return () => {
    set.delete(notify);
    if (set.size) return;
    send({ action: "unsubscribe", channels: [channel] });
    if (!activeChannels().length) {
      idleTimer = setTimeout(() => {
        if (activeChannels().length) return;
        socket?.close();
        socket = null;
      }, 20_000);
    }
  };
}

/** Latest payload on a channel (`lobby:oshi-duel`, `table:12`, `blackjack:low`), live. */
export function useGamesChannel<T>(channel: string | null): T | null {
  const subscribe = useCallback((notify: () => void) => (channel ? addListener(channel, notify) : () => {}), [channel]);
  const snapshot = useCallback(() => (channel ? ((latest.get(channel) as T | undefined) ?? null) : null), [channel]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function useGamesConnected() {
  return useSyncExternalStore(
    (notify) => {
      statusListeners.add(notify);
      return () => statusListeners.delete(notify);
    },
    () => connected,
    () => false,
  );
}

/** Feed an HTTP response into a channel so the UI updates before the push arrives. */
export function primeChannel(channel: string, payload: Payload) {
  accept(channel, { ...payload, channel });
}

/** Seed a channel from an HTTP fetch, only if the socket hasn't delivered anything yet. */
export function useSeedChannel(channel: string | null, payload: Payload | null) {
  useEffect(() => {
    if (channel && payload && !latest.has(channel)) accept(channel, { ...payload, channel });
  }, [channel, payload]);
}

/** Current time on the server's clock (from the last payload's server_time). */
export function serverNow() {
  return Date.now() + clockOffset;
}
