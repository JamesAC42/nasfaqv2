export function normalizeHexColor(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(normalized) ? normalized : null;
}
