"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { useAuthStore } from "@/app/stores/auth-store";

// Feature flags as the API resolves them for this viewer (GET /api/features; api/src/features has
// the flags and their README). The API withholds gated data and endpoints by itself; this only
// hides the links, tabs and boxes that would lead to them. Until the answer arrives every flag
// reads as off, so nothing gated flashes up for a player.

type Flags = Record<string, boolean>;
type State = { viewer: string | null; flags: Flags };
const EMPTY: Flags = {};

const useFeatureStore = create<State>(() => ({ viewer: null, flags: {} }));
let inflight: string | null = null;

function load(viewer: string) {
  if (useFeatureStore.getState().viewer === viewer || inflight === viewer) return;
  inflight = viewer;
  apiFetch<{ features?: Flags }>("/api/features", { cache: "no-store" })
    .then((result) => {
      if (inflight === viewer) useFeatureStore.setState({ viewer, flags: result.features ?? {} });
    })
    .catch(() => {})
    .finally(() => {
      if (inflight === viewer) inflight = null;
    });
}

/** Who the flags were resolved for: signed out, or a player or admin by id. Null until auth settles. */
function useViewer() {
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  if (!initialized) return null;
  return user ? `${user.id}:${user.is_admin ? "staff" : "player"}` : "anonymous";
}

/** Every flag for this viewer ({} until known); reloads when they sign in or out. */
export function useFeatures(): Flags {
  const viewer = useViewer();
  const state = useFeatureStore();
  useEffect(() => {
    if (viewer) load(viewer);
  }, [viewer]);
  return viewer && state.viewer === viewer ? state.flags : EMPTY;
}

/** Whether a feature flag is on for this viewer (false until known). */
export function useFeature(flag: string): boolean {
  return useFeatures()[flag] === true;
}
