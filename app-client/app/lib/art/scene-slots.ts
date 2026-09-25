// Registry of every non-talent image the site wants: backdrops, illustrations, spots, textures.
// Each area keeps its own JSON file in ./slots so parallel work doesn't collide; this file joins them.
// Talent art (key art + chibi poses) is a separate, per-talent pipeline: see art-manifest.ts.
//
// When art is generated, the pipeline writes it to the manifest under `scenes[<id>]` and every
// <SceneArt slot="<id>"> on the site picks it up. Until then the slot renders a placeholder the size
// of the final image. `npm run art:doc` regenerates docs/art/ART_ASSETS.md from these files.

import site from "@/app/lib/art/slots/site.json";
import home from "@/app/lib/art/slots/home.json";
import market from "@/app/lib/art/slots/market.json";
import games from "@/app/lib/art/slots/games.json";
import predictions from "@/app/lib/art/slots/predictions.json";
import howto from "@/app/lib/art/slots/howto.json";
import admin from "@/app/lib/art/slots/admin.json";
import legal from "@/app/lib/art/slots/legal.json";

export type SceneKind =
  | "backdrop" // full-bleed behind a hero or section; text sits on top
  | "illustration" // a picture that explains something (how-to-play steps, empty states)
  | "spot" // small decorative art beside UI
  | "object" // a thing drawn on its own (machine, card back, trophy), usually transparent
  | "texture" // tileable pattern
  | "icon" // small symbolic image
  | "social"; // Open Graph / share images

export type SceneSlot = {
  /** Stable id, `area.name`. Never rename once art exists: the manifest keys on it. */
  id: string;
  title: string;
  /** Routes (or components) that show it. */
  where: string[];
  kind: SceneKind;
  /** Final export size in px (the placeholder uses the same aspect ratio). */
  w: number;
  h: number;
  transparent?: boolean;
  /** Art direction for whoever generates it: subject, mood, composition, what text overlays where. */
  brief: string;
  priority: "high" | "medium" | "low";
  /** Anything that constrains generation: safe areas, must tile, light + dark versions, etc. */
  notes?: string;
};

type SlotFile = { area: string; slots: SceneSlot[] };

export const SCENE_AREAS: SlotFile[] = [site, home, market, games, predictions, howto, admin, legal] as SlotFile[];

export const SCENE_SLOTS: Record<string, SceneSlot> = Object.fromEntries(SCENE_AREAS.flatMap((file) => file.slots).map((slot) => [slot.id, slot]));

export function getSceneSlot(id: string): SceneSlot | null {
  return SCENE_SLOTS[id] ?? null;
}
