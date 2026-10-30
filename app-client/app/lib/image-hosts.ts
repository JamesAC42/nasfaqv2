// Where the site's pictures come from. next.config.ts builds the Content-Security-Policy's img-src
// from SITE_IMAGE_HOSTS, so a picture from anywhere else is reported (and, once the policy is
// enforced, blocked). No path aliases here: next.config.ts imports this file directly.

/** Pictures players write in (article thumbnails and pictures in article bodies, draft thumbnails). */
export const ARTICLE_IMAGE_HOSTS = [
  "images.nasfaq.biz", // our CDN: uploads, generated news thumbnails, icons, art
  "i.ytimg.com", // YouTube thumbnails
  "yt3.ggpht.com", // YouTube channel avatars
  "yt3.googleusercontent.com",
  "pbs.twimg.com", // pictures in posts on X, where most talent news starts
];

/** Every host a page loads pictures from. */
export const SITE_IMAGE_HOSTS = [
  ...ARTICLE_IMAGE_HOSTS,
  "cdn.jsdelivr.net", // Twemoji (IPO and talent emoji)
  "i.4cdn.org", // pictures and videos on the /vt/ thread pages
];

/**
 * `url` when it's an https picture on one of `hosts` (or one of the site's own, a relative path),
 * else null. Anything else would let whoever wrote the article load what they like, from where they
 * like, in every reader's browser.
 */
export function safeImageUrl(url: string | null | undefined, hosts: readonly string[] = ARTICLE_IMAGE_HOSTS): string | null {
  const value = String(url ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && hosts.includes(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The host a picture would have come from, for saying what was left out. */
export function imageHost(url: string | null | undefined): string | null {
  try {
    return new URL(String(url ?? "")).hostname || null;
  } catch {
    return null;
  }
}
