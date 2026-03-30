"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeLivestreams } from "@/app/lib/normalizers";
import type { LivestreamItem } from "@/app/lib/types";
import { getLivestreamWsUrl } from "@/app/lib/ws";

type ViewerDelta = {
  video_id: string;
  concurrent_viewers?: number | null;
};

type SnapshotUpdate = {
  type: "snapshot";
  live?: Array<Record<string, unknown>>;
  upcoming?: Array<Record<string, unknown>>;
};

type DiffUpdate = {
  type: "diff";
  liveAdded?: Array<Record<string, unknown>>;
  liveUpdated?: Array<Record<string, unknown>>;
  liveRemoved?: string[];
  upcomingAdded?: Array<Record<string, unknown>>;
  upcomingUpdated?: Array<Record<string, unknown>>;
  upcomingRemoved?: string[];
};

type ViewerUpdate = {
  live?: ViewerDelta[];
};

type LivestreamState = {
  items: LivestreamItem[];
  live: LivestreamItem[];
  upcoming: LivestreamItem[];
  isLoading: boolean;
  error: string | null;
  wsStatus: "closed" | "connecting" | "open";
  fetchLivestreams: () => Promise<void>;
};

let livestreamSocket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let socketStarted = false;
let viewerFlushTimer: number | null = null;
let pendingViewerDeltas = new Map<string, ViewerDelta>();

function sortUpcoming(items: LivestreamItem[]) {
  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return [...items].sort((a, b) => {
    const aTime = a.started_at ? new Date(a.started_at).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.started_at ? new Date(b.started_at).getTime() : Number.POSITIVE_INFINITY;
    const aDelayed = Number.isFinite(aTime) && aTime < nowMs - oneDayMs ? 1 : 0;
    const bDelayed = Number.isFinite(bTime) && bTime < nowMs - oneDayMs ? 1 : 0;
    if (aDelayed !== bDelayed) return aDelayed - bDelayed;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
}

function setLists(live: LivestreamItem[], upcoming: LivestreamItem[]) {
  const nextLive = [...live].sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0));
  const nextUpcoming = sortUpcoming(upcoming);
  useLivestreamStore.setState({
    items: nextLive,
    live: nextLive,
    upcoming: nextUpcoming,
  });
}

function mergeById(current: LivestreamItem[], incoming: LivestreamItem[], removed: string[] = []) {
  const next = new Map(current.map((item) => [item.id, item]));
  for (const id of removed) next.delete(id);
  for (const item of incoming) {
    const existing = next.get(item.id);
    next.set(item.id, existing ? { ...existing, ...item } : item);
  }
  return Array.from(next.values());
}

function applyViewerDeltas(deltas: Map<string, ViewerDelta>) {
  if (!deltas.size) return;
  useLivestreamStore.setState((state) => {
    if (!state.live.length) return state;
    const nextLive = state.live.map((item) => {
      const delta = deltas.get(item.id);
      if (!delta) return item;
      return {
        ...item,
        viewer_count: typeof delta.concurrent_viewers === "number" ? delta.concurrent_viewers : item.viewer_count,
      };
    });

    return {
      ...state,
      items: nextLive,
      live: nextLive,
    };
  });
}

function flushViewerDeltas() {
  viewerFlushTimer = null;
  const deltas = pendingViewerDeltas;
  pendingViewerDeltas = new Map<string, ViewerDelta>();
  applyViewerDeltas(deltas);
}

function scheduleViewerFlush() {
  if (viewerFlushTimer !== null) return;
  viewerFlushTimer = window.setTimeout(flushViewerDeltas, 250);
}

function clearSocketTimers() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (viewerFlushTimer !== null) {
    window.clearTimeout(viewerFlushTimer);
    viewerFlushTimer = null;
  }
}

function connectLivestreamSocket() {
  if (typeof window === "undefined" || livestreamSocket || socketStarted) return;
  const wsUrl = getLivestreamWsUrl();
  if (!wsUrl) return;

  socketStarted = true;

  const connect = () => {
    useLivestreamStore.setState({ wsStatus: "connecting" });
    reconnectAttempt += 1;
    livestreamSocket = new WebSocket(wsUrl);

    livestreamSocket.onopen = () => {
      reconnectAttempt = 0;
      useLivestreamStore.setState({ wsStatus: "open" });
    };

    livestreamSocket.onclose = () => {
      livestreamSocket = null;
      useLivestreamStore.setState({ wsStatus: "closed" });
      const delay = Math.min(15_000, 1_000 * Math.max(1, reconnectAttempt));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    livestreamSocket.onerror = () => {
      try {
        livestreamSocket?.close();
      } catch {}
    };

    livestreamSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as Partial<SnapshotUpdate> & Partial<DiffUpdate> & Partial<ViewerUpdate>;

        if (message.type === "snapshot") {
          clearSocketTimers();
          pendingViewerDeltas = new Map<string, ViewerDelta>();
          setLists(normalizeLivestreams(message.live || []), normalizeLivestreams(message.upcoming || []));
          return;
        }

        if (message.type === "diff") {
          clearSocketTimers();
          pendingViewerDeltas = new Map<string, ViewerDelta>();
          useLivestreamStore.setState((state) => {
            const nextLive = mergeById(
              state.live,
              normalizeLivestreams([...(message.liveAdded || []), ...(message.liveUpdated || [])]),
              message.liveRemoved || []
            ).sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0));
            const nextUpcoming = sortUpcoming(
              mergeById(
                state.upcoming,
                normalizeLivestreams([...(message.upcomingAdded || []), ...(message.upcomingUpdated || [])]),
                message.upcomingRemoved || []
              )
            );

            return {
              ...state,
              items: nextLive,
              live: nextLive,
              upcoming: nextUpcoming,
            };
          });
          return;
        }

        if (!Array.isArray(message.live)) return;
        for (const delta of message.live) {
          pendingViewerDeltas.set(delta.video_id, delta);
        }
        scheduleViewerFlush();
      } catch {
        // ignore malformed websocket payloads
      }
    };
  };

  connect();
}

export const useLivestreamStore = create<LivestreamState>((set) => ({
  items: [],
  live: [],
  upcoming: [],
  isLoading: false,
  error: null,
  wsStatus: "closed",
  fetchLivestreams: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiFetch<{
        live?: Array<Record<string, unknown>>;
        upcoming?: Array<Record<string, unknown>>;
      }>("/api/livestreams");
      setLists(normalizeLivestreams(result.live || []), normalizeLivestreams(result.upcoming || []));
      connectLivestreamSocket();
    } catch (error) {
      set({ items: [], live: [], upcoming: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
}));
