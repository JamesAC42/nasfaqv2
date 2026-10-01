"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";

/**
 * Which cards the viewer owns, for drawing exchange cards the way the binder does: art only for
 * cards you have, a locked silhouette for the rest. The exchange shows every card (and its other
 * rarities), so without this it would show art nobody has pulled yet. Signed out, nothing is owned.
 */
export function useOwnedCards() {
  const { user } = useAuth();
  const collection = useGamesStore((state) => state.collection);
  useEffect(() => {
    if (user && !collection) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [collection, user]);
  const keys = useMemo(() => new Set(user ? (collection?.cards ?? []).map((card) => card.key) : []), [collection, user]);
  return useCallback((key: string | null | undefined) => Boolean(key && keys.has(key)), [keys]);
}
