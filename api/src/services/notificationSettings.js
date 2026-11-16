// A player's notification settings (the Notifications section of /settings): which reminders they
// want, and on which channels, plus the browsers and phones they turned push on in.
//
// Everything is off until the player turns it on. Preferences are one row per player
// (market.notification_preferences); a player without a row has every default. A new reminder or
// channel (email, say) is a new column there and a new entry in PREFERENCES, and the page shows it.
//
// Push subscriptions (market.push_subscriptions) are listed back as an id, a coarse device label and
// dates, never the endpoint: it's personal data and stays in the database (webPush.js).

const webPush = require("./webPush");
const { reminderHour } = require("./checkinReminders");
const { PUSH_GROUPS } = require("./notifications");

/**
 * Every preference: its column and its default. The API takes and returns them by these keys. Besides
 * the reminder, one push switch per group of bell notifications (push_market, push_bets, ...; which
 * kinds each covers is notifications.js KIND_GROUPS, sent by pushNotifications.js).
 */
const PREFERENCES = Object.freeze({
  checkin_reminder_push: { column: "checkin_reminder_push", default: false },
  ...Object.fromEntries(PUSH_GROUPS.map((group) => [`push_${group}`, { column: `push_${group}`, default: false }])),
});
/** The most browsers and phones one player can have push on in at once; the oldest goes first. */
const MAX_DEVICES = 10;

function settingsError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

/** "Chrome on Android": a coarse label from the user agent, so a player can tell devices apart. */
function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  // On iPhone and iPad push only works in a web app added to the Home Screen (no "Safari/" in its UA).
  if (os === "iPhone" || os === "iPad") return browser && browser !== "Safari" ? `${browser} on ${os}` : `Home Screen app on ${os}`;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Browser";
}

async function readPreferences(db, userId) {
  const { rows } = await db.query(`SELECT * FROM market.notification_preferences WHERE user_id = $1`, [userId]);
  const row = rows[0] || {};
  return Object.fromEntries(Object.entries(PREFERENCES).map(([key, spec]) => [key, row[spec.column] === undefined || row[spec.column] === null ? spec.default : Boolean(row[spec.column])]));
}

async function listDevices(db, userId) {
  const { rows } = await db.query(
    `SELECT id, device_label, created_at, last_success_at FROM market.push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return rows.map((row) => ({ id: Number(row.id), label: row.device_label || "Browser", created_at: row.created_at, last_success_at: row.last_success_at }));
}

/** What the Notifications section shows: preferences, whether push can work, and the devices. */
async function getSettings(db, userId) {
  return {
    preferences: await readPreferences(db, userId),
    push: { available: webPush.isConfigured(), public_key: webPush.publicKey() },
    devices: await listDevices(db, userId),
    schedule: { checkin_reminder_hour: reminderHour() },
  };
}

/** Sets the preferences named in `changes` ({ checkin_reminder_push: true }); others stay. */
async function updatePreferences(db, userId, changes) {
  const entries = Object.entries(changes && typeof changes === "object" ? changes : {});
  if (!entries.length) throw settingsError("invalid_preferences");
  for (const [key, value] of entries) {
    if (!PREFERENCES[key]) throw settingsError("unknown_preference");
    if (typeof value !== "boolean") throw settingsError("invalid_preferences");
  }
  const columns = entries.map(([key]) => PREFERENCES[key].column);
  const values = entries.map(([, value]) => value);
  await db.query(
    `
    INSERT INTO market.notification_preferences (user_id, ${columns.join(", ")}, updated_at)
    VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")}, now())
    ON CONFLICT (user_id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}, updated_at = now()
  `,
    [userId, ...values]
  );
  return getSettings(db, userId);
}

/**
 * Saves this browser's push subscription for the player. A browser already saved for someone else
 * (two accounts, one browser) moves to this player. Refused while push is off, and for anything that
 * isn't a subscription at a known push service. Keeps the newest MAX_DEVICES.
 */
async function addDevice(db, userId, subscription, { userAgent = "" } = {}) {
  if (!webPush.isConfigured()) throw settingsError("push_unavailable", 503);
  const clean = webPush.cleanSubscription(subscription);
  if (!clean) {
    // Only the host, so a browser on a push service the list doesn't know yet shows up in the log.
    // eslint-disable-next-line no-console
    console.warn(`push subscription refused (host ${webPush.endpointHost(subscription?.endpoint) ?? "none"})`);
    throw settingsError("invalid_subscription");
  }
  const { rows } = await db.query(
    `
    INSERT INTO market.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device_label = EXCLUDED.device_label,
      created_at = CASE WHEN market.push_subscriptions.user_id = EXCLUDED.user_id THEN market.push_subscriptions.created_at ELSE now() END,
      last_success_at = CASE WHEN market.push_subscriptions.user_id = EXCLUDED.user_id THEN market.push_subscriptions.last_success_at END
    RETURNING id
  `,
    [userId, clean.endpoint, clean.p256dh, clean.auth, deviceLabel(userAgent)]
  );
  await db.query(
    `DELETE FROM market.push_subscriptions WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM market.push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
    [userId, MAX_DEVICES]
  );
  return { device_id: Number(rows[0].id), ...(await getSettings(db, userId)) };
}

/** Removes one of the player's devices by id (another player's id does nothing). */
async function removeDevice(db, userId, deviceId) {
  const id = Number(deviceId);
  if (!Number.isInteger(id) || id <= 0) throw settingsError("invalid_device");
  await db.query(`DELETE FROM market.push_subscriptions WHERE id = $1 AND user_id = $2`, [id, userId]);
  return getSettings(db, userId);
}

/**
 * Removes this browser's subscription by its endpoint (the browser knows it; the page sends it when
 * the player turns push off here). Only the player's own row goes.
 */
async function removeDeviceByEndpoint(db, userId, endpoint) {
  if (typeof endpoint !== "string" || !endpoint) throw settingsError("invalid_subscription");
  await forgetDevice(db, userId, endpoint);
  return getSettings(db, userId);
}

/**
 * Deletes the player's row for this endpoint, if there is one, and says whether it did. Signing out
 * calls it (routes/auth.js) so a shared browser stops getting the last player's reminders. It works
 * whatever the flag or the push keys say, and does nothing for anything that isn't an endpoint.
 */
async function forgetDevice(db, userId, endpoint) {
  if (!userId || typeof endpoint !== "string" || !endpoint || endpoint.length > 2048) return false;
  const { rowCount } = await db.query(`DELETE FROM market.push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [endpoint, userId]);
  return rowCount > 0;
}

/**
 * For the admin hub: whether push is on, how many players and devices have it, and how many of those
 * players have the reminder and each group on.
 */
async function pushSummary(db) {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM market.push_subscriptions) AS devices,
      (SELECT COUNT(DISTINCT user_id)::int FROM market.push_subscriptions) AS players,
      COUNT(*) FILTER (WHERE p.checkin_reminder_push)::int AS checkin_reminder_players,
      ${PUSH_GROUPS.map((group) => `COUNT(*) FILTER (WHERE p.push_${group})::int AS ${group}`).join(", ")}
    FROM market.notification_preferences p
    WHERE EXISTS (SELECT 1 FROM market.push_subscriptions s WHERE s.user_id = p.user_id)
  `);
  const { devices, players, checkin_reminder_players: checkinReminderPlayers, ...groups } = rows[0];
  return { configured: webPush.isConfigured(), devices, players, checkin_reminder_players: checkinReminderPlayers, group_players: groups };
}

module.exports = {
  MAX_DEVICES,
  PREFERENCES,
  addDevice,
  deviceLabel,
  forgetDevice,
  getSettings,
  pushSummary,
  readPreferences,
  removeDevice,
  removeDeviceByEndpoint,
  updatePreferences,
};
