// Can this browser take push notifications, and if not, what would let it? Plain JavaScript so
// `npm test` can run it without a build (push-support.test.mjs). The Notifications section of
// /settings reads it (components/settings/notification-settings.tsx).
//
// iPhone and iPad only do web push from a site added to the Home Screen (iOS/iPadOS 16.4 and later),
// opened from there: in a Safari tab, or any other iOS browser's tab, there's no PushManager at all.
// iPadOS Safari says it's a Mac, so a "Mac" with a touch screen counts as an iPad.

/**
 * @typedef {{ userAgent?: string, maxTouchPoints?: number, standalone?: boolean, serviceWorker?: boolean, pushManager?: boolean, notification?: boolean, secure?: boolean }} PushEnvironment
 * @typedef {"supported" | "ios-home-screen" | "ios-update" | "insecure" | "unsupported"} PushSupport
 */

/** @param {PushEnvironment} env */
export function isAppleMobile(env) {
  const ua = String(env.userAgent || "");
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(env.maxTouchPoints || 0) > 1);
}

/** The iOS/iPadOS major and minor version from the user agent, or null (iPadOS's desktop agent has none). */
export function iosVersion(userAgent) {
  const match = /(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(String(userAgent || ""));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/**
 * What the page should offer:
 * - "supported": the toggle.
 * - "ios-home-screen": iPhone/iPad in a browser tab: add to Home Screen, open it from there, then turn it on.
 * - "ios-update": iOS older than 16.4: no web push at all; update iOS first.
 * - "insecure": not https (push needs a secure page).
 * - "unsupported": a browser without push.
 * @param {PushEnvironment} env
 * @returns {PushSupport}
 */
export function pushSupport(env) {
  if (env.secure === false) return "insecure";
  const apple = isAppleMobile(env);
  const ready = Boolean(env.serviceWorker && env.pushManager && env.notification);
  if (apple) {
    const version = iosVersion(env.userAgent);
    if (version && (version[0] < 16 || (version[0] === 16 && version[1] < 4))) return "ios-update";
    if (!env.standalone) return "ios-home-screen";
    return ready ? "supported" : "ios-update";
  }
  return ready ? "supported" : "unsupported";
}

/** The browser's own environment (call only in the browser). */
export function browserPushEnvironment() {
  const nav = /** @type {Navigator & { standalone?: boolean }} */ (navigator);
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints || 0,
    standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
    serviceWorker: "serviceWorker" in nav,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    secure: window.isSecureContext,
  };
}

/** A VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function keyBytes(base64url) {
  const padded = String(base64url).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(base64url).length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
