// The NASFAQ mahjong tile set, drawn entirely as SVG shapes and stroke paths: no <text>, no fonts, no
// images, so the same drawing works in the browser, in server-rendered share cards and in a string.
//
// Circles are coins, bamboo are candlesticks (stock-chart candles) in the traditional stick layouts,
// characters are a numeral over 萬 drawn as strokes. Honors: winds as stroke kanji, 白 an empty frame,
// 發 green, 中 red. Red fives are red with a dot. Colors that carry theme meaning use CSS variables
// with fallbacks (--tile-edge for the outline, --tile-tint for backs), so the file needs no stylesheet.
//
// Pure module (no React state, no "use client"): server components import it freely.

import { createElement, type ReactElement } from "react";
import { isFive, kindOf, type TileId, type TileKind } from "@/app/lib/games/mahjong/tiles";

// ── Tree ────────────────────────────────────────────────────────────────────
type Attrs = Record<string, string | number | undefined>;
type Node = { tag: string; attrs: Attrs; kids: Node[] };
const n = (tag: string, attrs: Attrs = {}, ...kids: (Node | false | null | undefined)[]): Node => ({ tag, attrs, kids: kids.filter(Boolean) as Node[] });

const ATTR_NAMES: Record<string, string> = { strokeWidth: "stroke-width", strokeLinecap: "stroke-linecap", strokeLinejoin: "stroke-linejoin", strokeOpacity: "stroke-opacity", fillOpacity: "fill-opacity", viewBox: "viewBox" };
const REACT_ONLY = new Set(["style"]);

const esc = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function toString(node: Node): string {
  const attrs = Object.entries(node.attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${ATTR_NAMES[key] ?? key}="${esc(value as string | number)}"`)
    .join("");
  return node.kids.length ? `<${node.tag}${attrs}>${node.kids.map(toString).join("")}</${node.tag}>` : `<${node.tag}${attrs}/>`;
}

function toElement(node: Node, key?: number): ReactElement {
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs)) if (value !== undefined && !REACT_ONLY.has(name)) props[name] = value;
  return createElement(node.tag, props, ...node.kids.map((kid, index) => toElement(kid, index)));
}

// ── Palette ─────────────────────────────────────────────────────────────────
export const TILE_COLORS = {
  ivory: "#f6f0dd",
  shade: "#d9d0b3",
  ink: "#1b2233",
  blue: "#2468b3",
  blueDark: "#123e70",
  red: "#cc3a2f",
  redDark: "#7d1e17",
  green: "#23925f",
  greenDark: "#14583a",
  /** The default back: a teal. Seats pass their talent's color. */
  back: "#1f6f5c",
} as const;
const C = TILE_COLORS;
const EDGE_VAR = "var(--tile-edge, #2a3040)";

// ── Stroke glyphs (100 x 100 boxes) ─────────────────────────────────────────
const NUMERALS: Record<number, string> = {
  1: "M10 52 H90",
  2: "M24 30 H76 M10 74 H90",
  3: "M24 20 H76 M32 48 H68 M10 78 H90",
  4: "M16 16 H84 V86 H16 Z M40 18 V54 Q40 68 28 78 M60 18 V62 Q60 74 74 74",
  5: "M20 14 H80 M42 14 V48 M24 48 H70 L66 86 M10 86 H90",
  6: "M48 8 L54 22 M14 36 H86 M40 44 Q36 68 18 86 M60 44 Q60 68 72 78 Q78 82 88 80",
  7: "M12 44 H84 M46 12 V72 Q46 88 86 80",
  8: "M44 20 Q40 58 14 82 M56 34 Q60 64 86 82",
  9: "M46 10 Q38 54 14 82 M18 38 H72 Q78 38 77 48 L74 76 Q73 88 90 80",
};
// 萬: grass on top, a boxed middle and a legged lower half.
const MAN = "M12 16 H88 M34 6 V26 M66 6 V26 M22 36 H78 V62 H22 Z M22 49 H78 M50 36 V90 M30 66 L16 90 M72 66 V82 Q72 90 90 88";
const WINDS: Record<number, string> = {
  // 東
  27: "M14 20 H86 M50 6 V90 Q50 94 42 94 M28 32 H72 V62 H28 Z M28 47 H72 M42 66 Q36 82 16 92 M58 66 Q64 82 84 92",
  // 南
  28: "M50 6 V32 M12 24 H88 M24 32 V92 M24 32 H78 V86 Q78 92 88 90 M42 44 L48 54 M58 44 L52 54 M36 64 H64 M50 54 V82",
  // 西
  29: "M12 20 H88 M34 20 L30 46 M68 20 V46 M18 46 H82 V90 H18 Z M42 46 V70 Q42 76 36 80 M58 46 V70",
  // 北
  30: "M32 8 V80 Q32 90 20 92 M8 36 H32 M10 66 L32 48 M64 8 V66 Q64 82 90 78 M64 36 L88 24 M64 50 L86 44",
};
const HATSU = "M30 6 L16 22 M32 14 L50 26 M64 6 L56 24 M68 14 L88 26 M8 42 H38 V58 H10 M10 58 V76 H40 V90 Q40 96 30 94 M54 42 H90 M66 42 L62 56 M78 42 L82 56 M56 66 H92 M74 66 Q72 82 52 94 M74 70 Q80 84 94 92";
const CHUN = "M20 30 H80 V70 H20 Z M50 8 V92";

// Corner labels: 4 x 6 grids of stroke, one per character.
const LABELS: Record<string, string> = {
  "1": "M1 1 L2.2 0 V6 M0.2 6 H4",
  "2": "M0.2 1.2 Q0.2 0 2 0 Q3.8 0 3.8 1.8 Q3.8 3 0 6 H4",
  "3": "M0.2 0.5 H3.6 L1.8 2.8 Q4 2.8 4 4.4 Q4 6 2 6 Q0.4 6 0 5",
  "4": "M3 6 V0 L0 4.2 H4.2",
  "5": "M3.8 0 H0.5 L0.2 2.8 Q1 2.3 2 2.3 Q4 2.3 4 4.2 Q4 6 2 6 Q0.5 6 0 5",
  "6": "M3.6 0.4 Q0.2 0.4 0.2 4 Q0.2 6 2 6 Q3.8 6 3.8 4.2 Q3.8 2.6 2 2.6 Q0.2 2.6 0.2 4",
  "7": "M0 0.2 H4 L1.6 6",
  "8": "M2 2.9 Q0.2 2.9 0.2 1.5 Q0.2 0 2 0 Q3.8 0 3.8 1.5 Q3.8 2.9 2 2.9 Q0 2.9 0 4.5 Q0 6 2 6 Q4 6 4 4.5 Q4 2.9 2 2.9",
  "9": "M0.4 5.6 Q3.8 5.6 3.8 2 Q3.8 0 2 0 Q0.2 0 0.2 1.8 Q0.2 3.4 2 3.4 Q3.8 3.4 3.8 2",
  E: "M4 0.3 H0.4 V5.7 H4 M0.4 3 H3.2",
  S: "M3.8 0.8 Q3 0 2 0 Q0.2 0 0.2 1.5 Q0.2 3 2 3 Q3.8 3 3.8 4.5 Q3.8 6 2 6 Q0.8 6 0 5.2",
  W: "M0 0 L1 6 L2 2.4 L3 6 L4 0",
  N: "M0.4 6 V0 L3.6 6 V0",
  G: "M3.8 1.2 Q3 0 2 0 Q0.2 0 0.2 3 Q0.2 6 2 6 Q3.8 6 3.8 4 V3.2 H2.2",
  R: "M0.4 6 V0.2 H2.6 Q3.8 0.2 3.8 1.6 Q3.8 3 2.6 3 H0.4 M2.4 3 L3.8 6",
  h: "M0.4 0 V6 M0.4 3.6 Q2 2.2 3.2 3.6 V6",
};
function labelParts(kind: TileKind): string[] {
  if (kind < 27) return [String((kind % 9) + 1)];
  return [["E", "S", "W", "N", "W", "G", "R"][kind - 27]].concat(kind === 31 ? ["h"] : []);
}

// ── Art ─────────────────────────────────────────────────────────────────────
type Opts = { stroke: number; red: boolean };

const stroke = (d: string, color: string, width: number) => n("path", { d, fill: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" });

/** A glyph from a 100-box, drawn at `scale` with a stroke `weight` in tile units, at (x, y). */
function glyph(d: string, color: string, scale: number, weight: number, x: number, y: number) {
  return n("g", { transform: `translate(${x} ${y}) scale(${scale})` }, stroke(d, color, weight / scale));
}

function coin(cx: number, cy: number, r: number, color: string, dark: string) {
  return n(
    "g",
    {},
    n("circle", { cx, cy, r, fill: color, stroke: dark, strokeWidth: Math.max(0.5, r * 0.09) }),
    n("circle", { cx, cy, r: r * 0.6, fill: "none", stroke: C.ivory, strokeWidth: Math.max(0.5, r * 0.14), strokeOpacity: 0.9 }),
    n("circle", { cx, cy, r: r * 0.2, fill: C.ivory })
  );
}

const PIN_COLOR = { b: [C.blue, C.blueDark], r: [C.red, C.redDark], g: [C.green, C.greenDark] } as const;
type CoinSpec = [number, number, "b" | "r" | "g"];

function pinLayout(num: number): { coins: CoinSpec[]; radius: number } {
  switch (num) {
    case 2: return { radius: 12, coins: [[22, 14.5, "g"], [22, 44.5, "b"]] };
    case 3: return { radius: 10, coins: [[11, 10.5, "b"], [22, 29.5, "r"], [33, 48.5, "g"]] };
    case 4: return { radius: 10, coins: [[11.5, 14.5, "g"], [32.5, 14.5, "b"], [11.5, 44.5, "b"], [32.5, 44.5, "g"]] };
    case 5: return { radius: 9.5, coins: [[11, 12.5, "b"], [33, 12.5, "g"], [22, 29.5, "r"], [11, 46.5, "g"], [33, 46.5, "b"]] };
    case 6: return { radius: 9.5, coins: [[11.5, 9.5, "g"], [32.5, 9.5, "g"], [11.5, 29.5, "r"], [32.5, 29.5, "r"], [11.5, 49.5, "r"], [32.5, 49.5, "r"]] };
    case 7: return { radius: 7.2, coins: [[8.5, 8, "g"], [22, 15, "g"], [35.5, 22, "g"], [11, 39.5, "r"], [33, 39.5, "r"], [11, 53.5, "r"], [33, 53.5, "r"]] };
    case 8: return { radius: 7.2, coins: [[12, 7.5, "b"], [32, 7.5, "b"], [12, 22, "b"], [32, 22, "b"], [12, 36.5, "b"], [32, 36.5, "b"], [12, 51, "b"], [32, 51, "b"]] };
    default: return { radius: 7.4, coins: [[8, 8, "g"], [22, 8, "g"], [36, 8, "g"], [8, 29.5, "r"], [22, 29.5, "r"], [36, 29.5, "r"], [8, 51, "b"], [22, 51, "b"], [36, 51, "b"]] };
  }
}

function pinArt(num: number, opts: Opts): Node[] {
  if (num === 1) {
    const [red, redDark] = [C.red, C.redDark];
    return [
      n(
        "g",
        {},
        n("circle", { cx: 22, cy: 29.5, r: 20, fill: red, stroke: redDark, strokeWidth: 1.4 }),
        n("circle", { cx: 22, cy: 29.5, r: 16.2, fill: "none", stroke: C.ivory, strokeWidth: 1.6 }),
        n("circle", { cx: 22, cy: 29.5, r: 11.5, fill: C.blue, stroke: C.blueDark, strokeWidth: 1 }),
        n("circle", { cx: 22, cy: 29.5, r: 7.2, fill: "none", stroke: C.ivory, strokeWidth: 1.2 }),
        n("circle", { cx: 22, cy: 29.5, r: 3.6, fill: C.green, stroke: C.greenDark, strokeWidth: 0.8 })
      ),
    ];
  }
  const { coins, radius } = pinLayout(num);
  return coins.map(([cx, cy, tone]) => {
    // A red five is all red; the others use the traditional mix.
    const [color, dark] = opts.red ? PIN_COLOR.r : PIN_COLOR[tone];
    return coin(cx, cy, radius, color, dark);
  });
}

type StickSpec = [number, number, number, number, "g" | "r"]; // cx, cy, body height, body width, tone

function souLayout(num: number): StickSpec[] {
  switch (num) {
    case 1: return [[22, 29.5, 34, 18, "r"]];
    case 2: return [[22, 15, 20, 10, "g"], [22, 44, 20, 10, "g"]];
    case 3: return [[22, 14, 19, 10, "g"], [12, 44, 19, 10, "g"], [32, 44, 19, 10, "g"]];
    case 4: return [[12, 15, 20, 10, "g"], [32, 15, 20, 10, "g"], [12, 44, 20, 10, "g"], [32, 44, 20, 10, "g"]];
    case 5: return [[11, 13, 17, 10, "g"], [33, 13, 17, 10, "g"], [22, 29.5, 17, 10, "r"], [11, 46, 17, 10, "g"], [33, 46, 17, 10, "g"]];
    case 6: return [[12, 10, 14, 10, "g"], [32, 10, 14, 10, "g"], [12, 29.5, 14, 10, "g"], [32, 29.5, 14, 10, "g"], [12, 49, 14, 10, "g"], [32, 49, 14, 10, "g"]];
    case 7: return [[22, 8, 11, 9, "r"], [8, 29, 14, 8, "g"], [22, 29, 14, 8, "g"], [36, 29, 14, 8, "g"], [8, 49, 14, 8, "g"], [22, 49, 14, 8, "g"], [36, 49, 14, 8, "g"]];
    case 8: return [5.5, 16.5, 27.5, 38.5].flatMap((x): StickSpec[] => [[x, 15, 20, 7.5, "g"], [x, 44, 20, 7.5, "g"]]);
    default: return [8, 22, 36].flatMap((x): StickSpec[] => [[x, 9.5, 14, 8, "g"], [x, 29.5, 14, 8, x === 22 ? "r" : "g"], [x, 49.5, 14, 8, "g"]]);
  }
}

function souArt(num: number, opts: Opts): Node[] {
  return souLayout(num).map(([cx, cy, height, width, tone]) => {
    const red = opts.red || tone === "r";
    const [fill, dark] = red ? [C.red, C.redDark] : [C.green, C.greenDark];
    const wick = Math.min(5, height * 0.3);
    return n(
      "g",
      {},
      n("path", { d: `M${cx} ${cy - height / 2 - wick} V${cy + height / 2 + wick}`, stroke: dark, strokeWidth: 1.3, strokeLinecap: "round", fill: "none" }),
      n("rect", { x: cx - width / 2, y: cy - height / 2, width, height, rx: Math.min(1.6, width / 4), fill, stroke: dark, strokeWidth: 1 }),
      n("path", { d: `M${cx - width / 2 + 1.6} ${cy - height / 2 + 2} V${cy + height / 2 - 2}`, stroke: C.ivory, strokeWidth: 0.9, strokeOpacity: 0.45, strokeLinecap: "round", fill: "none" })
    );
  });
}

function manArt(num: number, opts: Opts): Node[] {
  const numeral = opts.red ? C.red : C.ink;
  return [glyph(NUMERALS[num], numeral, 0.27, opts.stroke, 8.5, 1), glyph(MAN, C.red, 0.3, opts.stroke, 7, 28.5)];
}

function honorArt(kind: TileKind, opts: Opts): Node[] {
  if (kind <= 30) return [glyph(WINDS[kind], C.ink, 0.44, opts.stroke, 0, 7.5)];
  if (kind === 31) return [n("rect", { x: 5, y: 5, width: 34, height: 49, rx: 3.5, fill: "none", stroke: C.blue, strokeWidth: opts.stroke * 1.1 }), n("rect", { x: 9.5, y: 9.5, width: 25, height: 40, rx: 1.6, fill: "none", stroke: C.blue, strokeWidth: opts.stroke * 0.45, strokeOpacity: 0.55 })];
  if (kind === 32) return [glyph(HATSU, C.green, 0.44, opts.stroke, 0, 8)];
  return [glyph(CHUN, C.red, 0.44, opts.stroke, 0, 8)];
}

function artFor(kind: TileKind, opts: Opts): Node[] {
  if (kind < 9) return manArt(kind + 1, opts);
  if (kind < 18) return pinArt(kind - 8, opts);
  if (kind < 27) return souArt(kind - 17, opts);
  return honorArt(kind, opts);
}

function labelNode(kind: TileKind, red: boolean): Node {
  const parts = labelParts(kind);
  const color = red ? C.red : C.ink;
  return n(
    "g",
    { transform: "translate(4.5 4.5) scale(1.55)", opacity: 0.8 },
    ...parts.map((part, index) => n("path", { d: LABELS[part], transform: `translate(${index * 4.8} 0)`, fill: "none", stroke: color, strokeWidth: 0.85, strokeLinecap: "round", strokeLinejoin: "round" }))
  );
}

// ── The tile ────────────────────────────────────────────────────────────────
export type TileSvgOptions = {
  /** A red five. Ignored for any other kind. */
  red?: boolean;
  /** Small corner label (1-9, E S W N, Wh G R). */
  labels?: boolean;
  /** Width in px: sets the SVG's size and the stroke weight (thicker at small sizes). Omit to let CSS size it. */
  size?: number;
  /** Draw the back instead; `tint` is its color. */
  back?: boolean;
  tint?: string | null;
  /** Lay the tile on its side (a called tile, a riichi discard). */
  rotated?: boolean;
  /** The outline color as a literal, for renderers without CSS variables (share cards). Default: var(--tile-edge). */
  edge?: string;
  /** Accessible name. */
  title?: string;
};

function tileBody(kind: TileKind, options: TileSvgOptions): Node[] {
  const red = Boolean(options.red) && isFive(kind);
  const size = options.size ?? 40;
  const opts: Opts = { stroke: size < 30 ? 3.4 : size < 48 ? 2.7 : 2.4, red };
  const body = [
    n("rect", { x: 0.8, y: 0.8, width: 58.4, height: 78.4, rx: 7, fill: C.shade, stroke: options.edge ?? EDGE_VAR, strokeWidth: 1.5 }),
  ];
  if (options.back) {
    const tint = options.tint || (options.edge ? C.back : `var(--tile-tint, ${C.back})`);
    body.push(
      n("rect", { x: 3, y: 3, width: 54, height: 69.5, rx: 5, fill: C.ivory }),
      n("rect", { x: 6.5, y: 6.5, width: 47, height: 62.5, rx: 3.5, fill: tint }),
      n("rect", { x: 6.5, y: 6.5, width: 47, height: 62.5, rx: 3.5, fill: "none", stroke: "#000", strokeOpacity: 0.18, strokeWidth: 1 }),
      n("rect", { x: 11, y: 11, width: 38, height: 53.5, rx: 2, fill: "none", stroke: C.ivory, strokeOpacity: 0.4, strokeWidth: 1 }),
      n("path", { d: "M30 22 L42 37.5 L30 53 L18 37.5 Z", fill: "none", stroke: C.ivory, strokeOpacity: 0.5, strokeWidth: 1.2, strokeLinejoin: "round" }),
      n("circle", { cx: 30, cy: 37.5, r: 3.4, fill: C.ivory, fillOpacity: 0.55 })
    );
    return body;
  }
  body.push(n("rect", { x: 3, y: 3, width: 54, height: 69.5, rx: 5, fill: C.ivory }));
  const art = n("g", { transform: options.labels ? "translate(2.2 3.6) translate(30 34) scale(0.9) translate(-30 -34) translate(8 7.5)" : "translate(8 7.5)" }, ...artFor(kind, opts));
  body.push(art);
  if (options.labels) body.push(labelNode(kind, red));
  if (red) body.push(n("circle", { cx: 50, cy: 10, r: 4.2, fill: C.red, stroke: C.ivory, strokeWidth: 1.2 }));
  return body;
}

function tileRoot(kind: TileKind, options: TileSvgOptions): Node {
  const rotated = Boolean(options.rotated);
  const width = rotated ? 80 : 60;
  const height = rotated ? 60 : 80;
  const size = options.size;
  const px = size ? { width: Math.round(rotated ? (size * 4) / 3 : size), height: Math.round(rotated ? size : (size * 4) / 3) } : {};
  const body = tileBody(kind, options);
  return n(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${width} ${height}`, ...px, role: "img", "aria-label": options.title, focusable: "false" },
    options.title ? n("title", {}) : null,
    rotated ? n("g", { transform: "translate(80 0) rotate(90)" }, ...body) : n("g", {}, ...body)
  );
}

/** The tile as an SVG string, for share cards and anywhere React isn't. Pass a kind (0-33); `red` marks a red five. */
export function tileSvg(kind: TileKind, options: TileSvgOptions = {}): string {
  const root = tileRoot(kind, options);
  // <title> carries text, which the tree has no node for.
  const text = toString(root);
  return options.title ? text.replace("<title/>", `<title>${esc(options.title)}</title>`) : text;
}

/** The same drawing as a React element. */
export function tileSvgElement(kind: TileKind, options: TileSvgOptions = {}): ReactElement {
  return toElement(tileRoot(kind, { ...options, title: undefined }));
}

/** A tile id's drawing: a red five by its id. */
export function tileIdSvg(id: TileId, options: TileSvgOptions = {}): string {
  return tileSvg(kindOf(id), { ...options, red: options.red ?? [16, 52, 88].includes(id) });
}

/** The back, as a string. */
export const tileBackSvg = (options: Omit<TileSvgOptions, "back"> = {}) => tileSvg(0, { ...options, back: true });
export const tileBackSvgElement = (options: Omit<TileSvgOptions, "back"> = {}) => tileSvgElement(0, { ...options, back: true });
