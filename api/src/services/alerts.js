// Alerts for the team, posted to the Discord channel behind DISCORD_ALERT_WEBHOOK_URL (the way bug
// reports go to DISCORD_BUG_WEBHOOK_URL, bugReports.js), so production failures reach phones with no
// new vendor. Set DISCORD_ALERT_ROLE_ID too and a new alert pings that role.
//
// Every alert has a key. raise() posts once, then at most once per cooldown while the condition
// lasts; resolve() posts "Resolved" once if a raise went out. The state is kept in Redis so all pods
// share it (a process whose Redis is away keeps its own meanwhile). A condition that flaps posts at
// most one raise and one resolve per cooldown: a raise after a resolve still waits out the cooldown.
// Without the webhook nothing is posted or kept; the process says so once.

const KEY_PREFIX = "nasfaq:ops:alert:";
const DEFAULT_COOLDOWN_MS = 60 * 60_000;
// An alert nobody resolves (its condition went away while nothing was watching) is forgotten after this.
const ACTIVE_TTL_SECONDS = 14 * 86400;
const POST_TIMEOUT_MS = 5000;
const COLORS = { error: 0xd0021b, warning: 0xf5a623, resolved: 0x2e9e5b };

let warnedUnset = false;
let warnedRedis = false;

/** A stand-in for the three Redis calls used here, for a process without Redis. */
function memoryStore() {
  const entries = new Map();
  const live = (key) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) entries.delete(key);
    return entries.get(key) || null;
  };
  return {
    async set(key, value, { NX = false, PX = null, EX = null } = {}) {
      if (NX && live(key)) return null;
      entries.set(key, { value, expiresAt: PX ? Date.now() + PX : EX ? Date.now() + EX * 1000 : null });
      return "OK";
    },
    async get(key) {
      return live(key)?.value ?? null;
    },
    async del(key) {
      return live(key) && entries.delete(key) ? 1 : 0;
    },
    clear() {
      entries.clear();
    },
  };
}
const fallback = memoryStore();

/** Redis, falling back to this process's memory for any call Redis fails. */
function storeFor(redis, logger) {
  if (!redis) return fallback;
  const attempt = (method) => async (...args) => {
    try {
      return await redis[method](...args);
    } catch (error) {
      if (!warnedRedis) logger.warn?.(`alerts: Redis unavailable (${error?.code || error?.name || "error"}); deduping in memory`);
      warnedRedis = true;
      return fallback[method](...args);
    }
  };
  return { set: attempt("set"), get: attempt("get"), del: attempt("del") };
}

function configured(url, logger) {
  if (url) return true;
  if (!warnedUnset) logger.info?.("alerts: DISCORD_ALERT_WEBHOOK_URL is not set; alerts are not sent anywhere");
  warnedUnset = true;
  return false;
}

const clip = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function siteHost() {
  try {
    return new URL(process.env.PUBLIC_APP_BASE_URL).host;
  } catch {
    return null;
  }
}

function duration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The Discord webhook body. Only a new alert may mention anyone, and only DISCORD_ALERT_ROLE_ID. */
function discordPayload(kind, key, { title, message = "", fields = [], severity = "error" }, { roleId = process.env.DISCORD_ALERT_ROLE_ID, now = new Date() } = {}) {
  const ping = kind === "firing" && /^\d+$/.test(String(roleId || ""));
  // Which site and pod it came from, so a local setup's alert can't pass for production's.
  const where = [siteHost(), process.env.HOSTNAME].filter(Boolean).join(" · ");
  return {
    username: "NASFAQ alerts",
    ...(ping ? { content: `<@&${roleId}>` } : {}),
    allowed_mentions: ping ? { parse: [], roles: [String(roleId)] } : { parse: [] },
    embeds: [
      {
        title: clip(kind === "resolved" ? `Resolved: ${title}` : title, 256),
        description: clip(message, 4000),
        color: kind === "resolved" ? COLORS.resolved : COLORS[severity] || COLORS.error,
        fields: fields.slice(0, 10).map((field) => ({ name: clip(field.name, 256), value: clip(field.value, 1024) || "—", inline: Boolean(field.inline) })),
        footer: { text: clip(where ? `${key} · ${where}` : key, 2048) },
        timestamp: now.toISOString(),
      },
    ],
  };
}

async function post(body, { url, fetchImpl = fetch, logger = console, timeoutMs = POST_TIMEOUT_MS, key }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) logger.warn?.(`alert ${key}: Discord answered ${response.status}`);
    return response.ok;
  } catch (error) {
    // Never log the URL: the webhook's token is in it.
    logger.warn?.(`alert ${key}: Discord post failed (${error?.name === "AbortError" ? "timeout" : "network"})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const cooldownKey = (key) => `${KEY_PREFIX}${key}:cooldown`;
const activeKey = (key) => `${KEY_PREFIX}${key}:active`;

/** The alert going on under `key` ({ since, title, state }), or null. */
async function getActive(redis, key, { logger = console } = {}) {
  try {
    return JSON.parse((await storeFor(redis, logger).get(activeKey(key))) || "null");
  } catch {
    return null;
  }
}

/**
 * Posts `alert` ({ title, message, fields, severity }) unless `key` posted within the cooldown.
 * `force` skips the cooldown (a condition that got worse); `state` is kept with the alert for
 * getActive(). A post that fails gives the cooldown back, so the next raise tries again.
 */
async function raise(redis, key, alert, { cooldownMs = DEFAULT_COOLDOWN_MS, force = false, state = null, url = process.env.DISCORD_ALERT_WEBHOOK_URL, logger = console, ...postOptions } = {}) {
  if (!configured(url, logger)) return { sent: false, reason: "not_configured" };
  const store = storeFor(redis, logger);
  if (force) await store.del(cooldownKey(key));
  if ((await store.set(cooldownKey(key), "1", { NX: true, PX: cooldownMs })) !== "OK") return { sent: false, reason: "cooldown" };
  let previous = null;
  try {
    previous = JSON.parse((await store.get(activeKey(key))) || "null");
  } catch {}
  const sent = await post(discordPayload("firing", key, alert, postOptions), { url, logger, key, ...postOptions });
  if (!sent) {
    await store.del(cooldownKey(key));
    return { sent: false, reason: "post_failed" };
  }
  const record = { since: previous?.since || new Date().toISOString(), title: alert.title, state };
  await store.set(activeKey(key), JSON.stringify(record), { EX: ACTIVE_TTL_SECONDS });
  return { sent: true };
}

/** Posts "Resolved" for `key` if an alert for it went out (once, whichever pod gets there first). */
async function resolve(redis, key, alert, { url = process.env.DISCORD_ALERT_WEBHOOK_URL, logger = console, ...postOptions } = {}) {
  if (!configured(url, logger)) return { sent: false, reason: "not_configured" };
  const store = storeFor(redis, logger);
  let previous = null;
  try {
    previous = JSON.parse((await store.get(activeKey(key))) || "null");
  } catch {}
  if (!previous || !(await store.del(activeKey(key)))) return { sent: false, reason: "not_active" };
  const lasted = Date.now() - Date.parse(previous.since);
  const message = [alert.message, Number.isFinite(lasted) ? `Lasted ${duration(lasted)}.` : null].filter(Boolean).join("\n");
  // Under the title that went out, which may have changed since (a count, a date).
  const sent = await post(discordPayload("resolved", key, { ...alert, title: previous.title || alert.title, message }, postOptions), { url, logger, key, ...postOptions });
  return { sent, reason: sent ? null : "post_failed" };
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  KEY_PREFIX,
  discordPayload,
  getActive,
  memoryStore,
  raise,
  resolve,
  _test: {
    reset() {
      warnedUnset = false;
      warnedRedis = false;
      fallback.clear();
    },
  },
};
