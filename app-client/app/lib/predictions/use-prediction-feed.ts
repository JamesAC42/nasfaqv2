"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getPredictionMarketWsUrl } from "@/app/lib/ws";
import type { SocketMessage } from "@/app/lib/predictions/types";

// One shared socket to /api/prediction-markets/ws. Every trade and market change on the site comes
// through it (prediction.trade, prediction.market.updated); components filter what they need.

type Listener = (message: SocketMessage) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let connected = false;
let retries = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (socket === ws) socket = null;
    setConnected(false);
    if (!listeners.size) return;
    const delay = Math.min(15_000, 600 * 2 ** retries) + Math.random() * 400;
    retries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => ws.close();
}

function subscribe(listener: Listener) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  listeners.add(listener);
  if (!socket && !reconnectTimer) connect();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      idleTimer = setTimeout(() => {
        if (listeners.size) return;
        socket?.close();
        socket = null;
      }, 20_000);
    }
  };
}

/** Calls `onMessage` for every live prediction event while mounted. */
export function usePredictionFeed(onMessage: Listener) {
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  useEffect(() => subscribe((message) => handler.current(message)), []);
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
