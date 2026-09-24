"use client";

import { useSyncExternalStore } from "react";

/** True while a media query matches. False on the server and the first client paint. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const usePhone = () => useMedia("(max-width: 720px)");
