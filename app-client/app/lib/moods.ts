import type { ArticleCommentMood } from "@/app/lib/types";

/** Swatch per comment mood. Green and red only for the two directional moods. */
export const MOOD_COLORS: Record<ArticleCommentMood, string> = {
  Bullish: "var(--up)",
  Bearish: "var(--down)",
  Neutral: "#A7AEBE",
  Hodling: "var(--blue)",
  "Dump Eet": "#FF8A3D",
  "He Bought?": "#B4F25C",
  "He Sold?": "#FF6FB5",
  "Diamond Hands": "#8AD6FF",
  Watching: "#C9A7FF",
  Accumulating: "#F5C542",
};
