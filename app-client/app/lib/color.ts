export function normalizeHexColor(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toLinearChannel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * toLinearChannel(r)) + (0.7152 * toLinearChannel(g)) + (0.0722 * toLinearChannel(b));
}

function mixWithWhite(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: r + ((255 - r) * amount),
    g: g + ((255 - g) * amount),
    b: b + ((255 - b) * amount),
  });
}

export function ensureReadableColorOnDarkBackground(
  value: string | null | undefined,
  minLuminance = 0.24
) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  if (relativeLuminance(normalized) >= minLuminance) return normalized;

  let adjusted = normalized;
  for (let step = 1; step <= 8; step += 1) {
    adjusted = mixWithWhite(normalized, step * 0.12);
    if (relativeLuminance(adjusted) >= minLuminance) {
      return adjusted;
    }
  }

  return adjusted;
}
