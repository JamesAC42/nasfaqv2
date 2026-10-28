"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getPredictionMarketWsUrl } from "@/app/lib/ws";
import type { SocketMessage } from "@/app/lib/predictions/types";

// One shared socket to /api/prediction-markets/ws. Every trade and market change on the site comes
// through it (prediction.trade, prediction.market.updated); components filter what they need.
// Whatever is sent while it's down (a deploy closes every socket) never arrives, so when it comes
// back after a drop, each page refetches what it shows.

type Listener = (message: SocketMessage) => void;

const listeners = new Set<Listener>();
const reconnectListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let connected = false;
let retries = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** The socket dropped while pages were listening: they missed whatever came meanwhile. */
let missed = false;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach((notify) => notify());
}

function connect() {
  if (typeof window === "undefined" || socket) return;
  const url = getPredictionMarketWsUrl();
  if (!url) return;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    retries = 0;
    setConnected(true);
    if (!missed) return;
    missed = false;
    // Jittered, so a whole site reconnecting after a deploy doesn't refetch in the same instant.
    setTimeout(() => reconnectListeners.forEach((notify) => notify()), Math.random() * 2_000);
  };
  ws.onmessage = (event) => {
    let message: SocketMessage;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    listeners.forEach((listener) => listener(message));
  };
  ws.onclose = () => {
    // Let go of on purpose (nobody was listening), maybe after a new one already opened.
    if (socket !== ws) return;
    socket = null;
    setConnected(false);
    if (!listeners.size) return;
    missed = true;
    const delay = Math.min(15_000, 600 * 2 ** retries) + Math.random() * 400;
    retries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => ws.close();
}

function subscribe(listener: Listener, onReconnect: () => void) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  listeners.add(listener);
  reconnectListeners.add(onReconnect);
  if (!socket && !reconnectTimer) connect();
  return () => {
    listeners.delete(listener);
    reconnectListeners.delete(onReconnect);
    if (!listeners.size) {
      idleTimer = setTimeout(() => {
        if (listeners.size || !socket) return;
        const idle = socket;
        socket = null;
        setConnected(false);
        idle.close();
      }, 20_000);
    }
  };
}

/**
 * Calls `onMessage` for every live prediction event while mounted, and `onReconnect` when the socket
 * is back after a drop: refetch there, since events sent meanwhile are lost.
 */
export function usePredictionFeed(onMessage: Listener, onReconnect: () => void) {
  const handlers = useRef({ onMessage, onReconnect });
  useEffect(() => {
    handlers.current = { onMessage, onReconnect };
  });
  useEffect(
    () =>
      subscribe(
        (message) => handlers.current.onMessage(message),
        () => handlers.current.onReconnect(),
      ),
    [],
  );
}

export function usePredictionFeedConnected() {
  return useSyncExternalStore(
    (notify) => {
      statusListeners.add(notify);
      return () => statusListeners.delete(notify);
    },
    () => connected,
    () => false,
  );
}
