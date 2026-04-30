const GENERATED_NEWS_THUMBNAIL_HOST = "images.nasfaq.biz";
const GENERATED_NEWS_THUMBNAIL_PREFIX = "/thumbnails/";
const COMPACT_THUMBNAIL_PREFIX = "thumbnail-";

export function getCompactNewsThumbnailUrl(url: string | null | undefined) {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.hostname !== GENERATED_NEWS_THUMBNAIL_HOST || !parsed.pathname.startsWith(GENERATED_NEWS_THUMBNAIL_PREFIX)) {
    return url;
  }

  const lastSlashIndex = parsed.pathname.lastIndexOf("/");
  if (lastSlashIndex < 0 || lastSlashIndex === parsed.pathname.length - 1) return url;

  const filename = parsed.pathname.slice(lastSlashIndex + 1);
  if (filename.startsWith(COMPACT_THUMBNAIL_PREFIX)) return url;

  parsed.pathname = `${parsed.pathname.slice(0, lastSlashIndex + 1)}${COMPACT_THUMBNAIL_PREFIX}${filename}`;
  return parsed.toString();
}
