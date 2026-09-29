"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";
import type { StreamPreview } from "@/app/lib/streams";

// The stream sheet is driven by a `?stream=<videoId>` search param so it can be opened
// from any page, linked to, and closed with the back button. The store only remembers
// what the opener already knew so the sheet can paint before its own fetch lands.

type StreamStore = {
  previews: Record<string, StreamPreview>;
  /** True when this tab pushed the `?stream=` entry itself, so closing can go back. */
  pushed: boolean;
  remember: (item: StreamPreview) => void;
  setPushed: (pushed: boolean) => void;
};

export const useStreamStore = create<StreamStore>((set) => ({
  previews: {},
  pushed: false,
  remember: (item) => set((state) => ({ previews: { ...state.previews, [item.id]: { ...state.previews[item.id], ...item } } })),
  setPushed: (pushed) => set({ pushed }),
}));

/** Open the stream sheet over the current page. */
export function useOpenStream() {
  const router = useRouter();
  const pathname = usePathname();
  const remember = useStreamStore((state) => state.remember);
  const setPushed = useStreamStore((state) => state.setPushed);
  return useCallback(
    (item: StreamPreview) => {
      remember(item);
      const params = new URLSearchParams(window.location.search);
      const already = params.has("stream");
      params.set("stream", item.id);
      const href = `${pathname}?${params.toString()}`;
      // Hopping between streams inside the sheet replaces, so Back still closes it.
      if (already) router.replace(href, { scroll: false });
      else {
        setPushed(true);
        router.push(href, { scroll: false });
      }
    },
    [pathname, remember, router, setPushed],
  );
}
