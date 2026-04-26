export type ChannelChartTheme = {
  base: string;
  baseSoft: string;
  baseMuted: string;
  baseDeep: string;
  complement: string;
  complementSoft: string;
  complementMuted: string;
  complementDeep: string;
  highlight: string;
  neutral: string;
  text: string;
  grid: string;
  crosshair: string;
  crosshairSoft: string;
  categorical: string[];
};

const DEFAULT_COLOR = "#2563eb";
const DEFAULT_TEXT = "#6b5d4c";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Hsl = {
  h: number;
  s: number;
  l: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHex(value: string | null | undefined) {
  const input = (value || "").trim();
  const short = /^#([0-9a-f]{3})$/i.exec(input);
  if (short) {
    return `#${short[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  const full = /^#([0-9a-f]{6})$/i.exec(input);
  if (full) return `#${full[1].toLowerCase()}`;
  return DEFAULT_COLOR;
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness * 100 };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return {
    h: hue * 60,
    s: saturation * 100,
    l: lightness * 100,
  };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = chroma;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = chroma;
  } else if (hue < 180) {
    green = chroma;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = chroma;
  } else if (hue < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

function adjustLightness(hex: string, amount: number) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: clamp(hsl.l + amount, 0, 100) }));
}

export function adjustSaturation(hex: string, amount: number) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, s: clamp(hsl.s + amount, 0, 100) }));
}

export function rotateHue(hex: string, amount: number) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + amount }));
}

function blend(first: string, second: string, firstWeight = 0.5) {
  const left = hexToRgb(first);
  const right = hexToRgb(second);
  const weight = clamp(firstWeight, 0, 1);
  return rgbToHex({
    r: left.r * weight + right.r * (1 - weight),
    g: left.g * weight + right.g * (1 - weight),
    b: left.b * weight + right.b * (1 - weight),
  });
}

export function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function createChannelChartTheme(channelColor: string | null | undefined): ChannelChartTheme {
  const base = normalizeHex(channelColor);
  const baseDeep = adjustLightness(adjustSaturation(base, 8), -18);
  const baseSoft = adjustLightness(base, 16);
  const baseMuted = adjustLightness(adjustSaturation(base, -24), 10);

  const analogousBase = rotateHue(base, 16);
  const complement = adjustSaturation(analogousBase, 6);
  const complementDeep = adjustLightness(adjustSaturation(rotateHue(base, -10), 4), -16);
  const complementSoft = adjustLightness(rotateHue(base, 10), 18);
  const complementMuted = adjustLightness(adjustSaturation(rotateHue(base, -6), -18), 12);

  const highlight = blend(baseSoft, complementSoft, 0.62);
  const neutral = blend(baseDeep, DEFAULT_TEXT, 0.18);
  const text = blend(DEFAULT_TEXT, baseDeep, 0.84);
  const grid = withAlpha(blend(baseDeep, complement, 0.72), 0.14);
  const crosshair = withAlpha(complementDeep, 0.22);
  const crosshairSoft = withAlpha(baseDeep, 0.14);

  return {
    base,
    baseSoft,
    baseMuted,
    baseDeep,
    complement,
    complementSoft,
    complementMuted,
    complementDeep,
    highlight,
    neutral,
    text,
    grid,
    crosshair,
    crosshairSoft,
    categorical: [
      baseDeep,
      base,
      baseSoft,
      complementDeep,
      complement,
      complementSoft,
      highlight,
      blend(baseMuted, complementMuted, 0.52),
    ],
  };
}
