import type { ChibiPose } from "@/app/lib/art-manifest";

// A chat sticker is a message whose whole body is [[sticker:SYMBOL/pose]]. The API checks that the
// sender owns a card of that talent; clients draw it from the art manifest.
const STICKER_PATTERN = /^\[\[sticker:([A-Z0-9_]{1,16})\/(idle|hype|moon|cope|smug|shock)\]\]$/;

export const stickerBody = (symbol: string, pose: ChibiPose) => `[[sticker:${symbol}/${pose}]]`;

export function parseSticker(body: string | null | undefined): { symbol: string; pose: ChibiPose } | null {
  const match = STICKER_PATTERN.exec(String(body ?? "").trim());
  return match ? { symbol: match[1], pose: match[2] as ChibiPose } : null;
}

/** One-line text for previews ("sticker: PEK hype"). */
export function stickerPreview(body: string | null | undefined) {
  const sticker = parseSticker(body);
  return sticker ? `sticker: ${sticker.symbol} ${sticker.pose}` : null;
}
