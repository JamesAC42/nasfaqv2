import { create } from "zustand";
import { ART_MANIFEST_URL, type ArtManifest } from "@/app/lib/art-manifest";

type ArtStatus = "idle" | "loading" | "ready" | "missing";

type ArtStore = {
  status: ArtStatus;
  manifest: ArtManifest | null;
  ensureLoaded: () => void;
};

export const useArtStore = create<ArtStore>((set, get) => ({
  status: "idle",
  manifest: null,
  ensureLoaded: () => {
    if (get().status !== "idle") return;
    set({ status: "loading" });
    fetch(ART_MANIFEST_URL, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ArtManifest | null) => {
        if (data && typeof data === "object" && data.talents) set({ status: "ready", manifest: data });
        else set({ status: "missing" });
      })
      .catch(() => set({ status: "missing" }));
  },
}));
