"use client";

import { useCallback } from "react";
import { create } from "zustand";
import type { StreamPreview } from "@/app/lib/streams";

// The stream sheet is driven by a `?stream=<videoId>` search param so it can be opened
// from any page, linked to, and closed with the back button. The store only remembers
// what the opener already knew so the sheet can paint before its own fetch lands.
//
// The player itself lives outside the sheet (StreamDock, mounted once at the app root) so a
// stream keeps playing when the sheet closes and while you move around the site: it sits over
// the sheet's video slot while that sheet is open and floats as a miniplayer otherwise.

export type PlayingStream = {
  id: string;
  title: string;
  accent: string | null;
  live: boolean;
  /** Floating in the corner rather than sitting in its sheet. */
  mini: boolean;
};

type StreamStore = {
  previews: Record<string, StreamPreview>;
  /** True when this tab pushed the `?stream=` entry itself, so closing can go back. */
  pushed: boolean;
  playing: PlayingStream | null;
  remember: (item: StreamPreview) => void;
  setPushed: (pushed: boolean) => void;
  /** Start a stream in its open sheet (replacing whatever was playing). */
  play: (stream: Omit<PlayingStream, "mini">) => void;
  /** Put the playing stream back in its sheet (when the sheet for it opens). */
  dock: (id: string) => void;
  /** Keep the stream going in the miniplayer (when its sheet closes). */
  minimize: (id: string) => void;
  stop: () => void;
};

export const useStreamStore = create<StreamStore>((set) => ({
  previews: {},
  pushed: false,
  playing: null,
  remember: (item) => set((state) => ({ previews: { ...state.previews, [item.id]: { ...state.previews[item.id], ...item } } })),
  setPushed: (pushed) => set({ pushed }),
  play: (stream) => set({ playing: { ...stream, mini: false } }),
  dock: (id) => set((state) => (state.playing?.id === id && state.playing.mini ? { playing: { ...state.playing, mini: false } } : state)),
  minimize: (id) => set((state) => (state.playing?.id === id && !state.playing.mini ? { playing: { ...state.playing, mini: true } } : state)),
  stop: () => set({ playing: null }),
}));

/** Open the stream sheet over the current page. */
export function useOpenStream() {
  const remember = useStreamStore((state) => state.remember);
  const setPushed = useStreamStore((state) => state.setPushed);
  return useCallback(
    (item: StreamPreview) => {
      remember(item);
      const params = new URLSearchParams(window.location.search);
      const already = params.has("stream");
      params.set("stream", item.id);
      const href = `${window.location.pathname}?${params.toString()}`;
      // Only the search changes, so native history (which Next keeps useSearchParams in sync with)
      // rather than the router: router.replace didn't take when the path stayed the same.
      // Hopping between streams inside the sheet replaces, so Back still closes it.
      if (already) window.history.replaceState(null, "", href);
      else {
        setPushed(true);
        window.history.pushState(null, "", href);
      }
    },
    [remember, setPushed],
  );
}
