import localFont from "next/font/local";
import { Martian_Mono, Zen_Kaku_Gothic_New } from "next/font/google";

// Chicago: the hololive logo face. Display only (headlines, names, big moments).
// The file has a single weight, so always render it at font-weight 400.
export const chicago = localFont({
  src: "./fonts/ChicagoFLF.ttf",
  weight: "400",
  display: "swap",
  variable: "--font-chicago",
  fallback: ["Arial Black", "sans-serif"],
});

// Martian Mono: every number. The width axis lets tables run condensed and hero
// prices run wide from one file (see --mono-narrow / --mono-wide).
export const martianMono = Martian_Mono({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-martian",
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

// Zen Kaku Gothic New: body and UI copy. Latin subset only; Japanese text falls
// back to the system's Japanese fonts, which keeps the payload small.
export const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
  variable: "--font-zen",
  fallback: ["Hiragino Sans", "Segoe UI", "system-ui", "sans-serif"],
});

export const fontVariables = [chicago.variable, martianMono.variable, zenKaku.variable].join(" ");
