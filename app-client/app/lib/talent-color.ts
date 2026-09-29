import { getUsableChannelColor, type ColorMode } from "@/app/lib/color";

/**
 * Talent colors from the API range from near-white (#feffe6) to near-black
 * (#35323d). Use this before painting text, lines or washes with them so they
 * stay visible on the current theme's ground.
 */
export function talentAccent(color: string | null | undefined, mode: ColorMode = "dark") {
  return (
    getUsableChannelColor(color, mode, { minDarkLuminance: 0.3, maxLightLuminance: 0.42 }) ??
    (mode === "dark" ? "#3fb8f5" : "#0e8fd6")
  );
}

/** Inline style that sets --tal for a subtree (heroes, profile headers, peeks). */
export function talentStyle(color: string | null | undefined, mode: ColorMode = "dark") {
  return { "--tal": talentAccent(color, mode) } as React.CSSProperties;
}
