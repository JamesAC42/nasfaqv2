// Web Push (VAPID) for browsers and phones: the daily check-in reminder (checkinReminders.js) is the
// only thing that sends one so far.
//
// Three secrets turn it on: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY and
// WEB_PUSH_SUBJECT (a mailto: or https: address push services can reach the site's owner at). With
// any of them unset or malformed, push is off and everything around it is inert: the settings say
// it's unavailable, subscribing is refused, and the reminder scheduler sends nothing. Nothing throws.
//
// A subscription's endpoint is the push service's address for one browser. It's personal data: it
// never goes in a log line or an error message (WebPushError carries it, so only its status code is
// kept), and the site never gets it back.

const webpush = require("web-push");

// Push services the major browsers use. A subscription naming any other host is refused, so the API
// never POSTs to an address a player made up.
//   Chrome, Edge (Chromium), Android, Samsung Internet, Opera, Brave: fcm.googleapis.com
//   Firefox: updates.push.services.mozilla.com   Safari (macOS, iOS 16.4+ home-screen apps): web.push.apple.com
//   Edge's legacy Windows channel: *.notify.windows.com
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com"];
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];
const MAX_ENDPOINT_LENGTH = 2048;
const SEND_TIMEOUT_MS = 15_000;

/** The VAPID settings from the environment, or null (with why) when push is off. Never throws. */
function readConfig(env = process.env) {
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  const subject = String(env.WEB_PUSH_SUBJECT || "").trim();
  if (!publicKey || !privateKey || !subject) return { config: null, reason: "unset" };
  try {
    // Checks the keys' encoding and length and the subject's form, and throws on any of them.
    webpush.getVapidHeaders("https://fcm.googleapis.com", subject, publicKey, privateKey, "aes128gcm");
  } catch {
    return { config: null, reason: "invalid" };
  }
  return { config: { publicKey, privateKey, subject }, reason: null };
}

// Read on first use, not at require time: server.js loads .env after its requires.
let cached = null;
const current = () => (cached ??= readConfig());

/** Whether push is on: all three settings present and well-formed. */
const isConfigured = () => Boolean(current().config);

/** The public key browsers subscribe with (not a secret), or null while push is off. */
const publicKey = () => current().config?.publicKey ?? null;

/** The one startup line: on or off, never a key. */
function startupLine() {
  const state = current();
  if (state.config) return "web push: on (VAPID keys set)";
  if (state.reason === "invalid") return "web push: off (WEB_PUSH_VAPID_* or WEB_PUSH_SUBJECT is malformed)";
  return "web push: off (WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY and WEB_PUSH_SUBJECT unset)";
}

/** Whether `endpoint` is an https address at a known push service. */
function allowedEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * A browser's PushSubscription (its toJSON(): { endpoint, keys: { p256dh, auth } }) checked and
 * trimmed to what's stored, or null when it isn't one.
 */
function cleanSubscription(input) {
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (!allowedEndpoint(endpoint)) return null;
  if (typeof p256dh !== "string" || !BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 120) return null;
  if (typeof auth !== "string" || !BASE64URL.test(auth) || auth.length < 16 || auth.length > 40) return null;
  return { endpoint, p256dh, auth };
}

/** A push failure with only what's safe to keep: the push service's status code. */
function sendError(error) {
  const statusCode = Number(error?.statusCode) || null;
  return Object.assign(new Error(statusCode ? `push_failed_${statusCode}` : "push_failed"), { code: "push_failed", statusCode });
}

/**
 * Sends one push. `subscription` is a stored row ({ endpoint, p256dh, auth }), `payload` an object
 * the service worker reads (public/sw.js). Throws a push_failed error with only `statusCode` on
 * failure: 404 and 410 mean the browser dropped the subscription.
 */
async function send(subscription, payload, { ttlSeconds = 3600, urgency = "normal", topic } = {}) {
  const { config } = current();
  if (!config) throw Object.assign(new Error("push_unavailable"), { code: "push_unavailable" });
  const { publicKey: key, privateKey, subject } = config;
  try {
    return await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject, publicKey: key, privateKey }, TTL: Math.max(0, Math.floor(ttlSeconds)), urgency, topic, timeout: SEND_TIMEOUT_MS }
    );
  } catch (error) {
    throw sendError(error);
  }
}

/** Whether a send failed because the subscription is gone for good (delete it). */
const isGone = (error) => error?.statusCode === 404 || error?.statusCode === 410;

/** For tests only: reads the settings from `env` until the returned function is called. */
function override(env) {
  const before = cached;
  cached = readConfig(env);
  return () => {
    cached = before;
  };
}

module.exports = { allowedEndpoint, cleanSubscription, isConfigured, isGone, override, publicKey, readConfig, send, startupLine };
