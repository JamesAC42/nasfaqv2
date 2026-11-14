// Where to send someone after they sign in or make an account, and the one errand that carries on by
// itself once they're back: linking a v1 account. Plain JavaScript so `npm test` can run it without a
// build (return-path.test.mjs).

const ACCOUNT_PAGES = /^\/(login|register|forgot-password|reset-password)(\/|\?|#|$)/;

/**
 * True for a path on this site that's safe to send someone to after signing in. Anything that a browser
 * could read as another site is refused: `//host`, and `/\host`, which browsers treat the same way.
 * @param {unknown} path
 * @returns {path is string}
 */
export function isLocalPath(path) {
  if (typeof path !== "string" || path.length > 512) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
  return !ACCOUNT_PAGES.test(path);
}

/** Where the v1 link page lives. Sign-in and sign-up send people back here when they came from it. */
export const LINK_V1_PATH = "/link-v1";

/** True when a ?next= path points at the v1 link page. */
export const isLinkV1Path = (path) => isLocalPath(path) && /^\/link-v1(\?|#|$)/.test(path);

const LINK_INTENT_KEY = "nasfaq.linkV1";
// Long enough to make an account and come back, short enough that an old tab doesn't surprise anyone.
const LINK_INTENT_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Remembers, in this tab, that someone pressed "make an account" or "sign in" on the v1 link page, so the
 * page can carry on to nasfaq.biz once they're back. Session storage rather than the URL, so a link
 * someone sends can't start it.
 * @param {Pick<Storage, "setItem"> | null | undefined} storage
 */
export function rememberLinkIntent(storage, now = Date.now()) {
  try {
    storage?.setItem(LINK_INTENT_KEY, String(now));
  } catch {
    /* storage blocked: they press the button themselves */
  }
}

/**
 * True, once, if this tab pressed "make an account" or "sign in" on the link page in the last half hour.
 * Reading it clears it, so a reload doesn't send anyone off again.
 * @param {Pick<Storage, "getItem" | "removeItem"> | null | undefined} storage
 */
export function takeLinkIntent(storage, now = Date.now()) {
  try {
    const saved = storage?.getItem(LINK_INTENT_KEY);
    if (saved == null) return false;
    storage?.removeItem(LINK_INTENT_KEY);
    const at = Number(saved);
    return Number.isFinite(at) && at <= now && now - at < LINK_INTENT_LIFETIME_MS;
  } catch {
    return false;
  }
}

/** Forgets the errand without acting on it, for someone who's already linked or chose another way. */
export function forgetLinkIntent(storage) {
  try {
    storage?.removeItem(LINK_INTENT_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * The same page with ?next= kept, for the links between sign-in and sign-up, so switching tabs doesn't
 * lose where someone was going.
 * @param {string} page
 * @param {string | null | undefined} next
 */
export const withNext = (page, next) => (isLocalPath(next) ? `${page}?next=${encodeURIComponent(next)}` : page);
