"use client";

import { useEffect } from "react";
import { lookupArt, type ArtImage } from "@/app/lib/art-manifest";
import { useArtStore } from "@/app/stores/art-store";

/**
 * The manifest entry for an art ID (`SYMBOL/slot/variant` or `_shared/slot/variant`), or null
 * while the manifest loads or when the image doesn't exist yet. Use it to switch a layout on
 * when a piece of art lands, e.g. the card gacha hero going full-bleed once a talent's banner
 * exists: `const banner = useArtImage(artId(symbol, "banner"))`.
 */
export function useArtImage(id: string | null | undefined): ArtImage | null {
  const manifest = useArtStore((state) => state.manifest);
  const ensureLoaded = useArtStore((state) => state.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return id ? lookupArt(manifest, id) : null;
}

/** True when the art ID exists in the manifest. */
export function useHasArt(id: string | null | undefined) {
  return useArtImage(id) !== null;
}
