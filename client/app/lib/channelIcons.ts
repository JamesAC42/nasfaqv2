const CHANNEL_ICON_BASE_URL = "https://images.nasfaq.biz/icons";

export function getChannelIconUrl(icon?: string | null) {
  const trimmed = icon?.trim();
  if (!trimmed) return null;
  return `${CHANNEL_ICON_BASE_URL}/${encodeURIComponent(trimmed)}.svg`;
}
