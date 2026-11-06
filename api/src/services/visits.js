// Signed-out visitors, counted by the site itself (POST /api/site/here from
// components/layout/visit-counter.tsx). Ad blockers block Umami's tracker, so it undercounted
// (10 visitors on a day the ingress logs had 28 browsers). A same-origin request to our own API
// isn't on their lists.
//
// What's stored (market.site_visits), one row per visitor, page and day (New York):
// - visitor_hash: an HMAC of the address (IPv6 by its /64, as in ipHash.js) and the user agent,
//   keyed with a random salt made for that day. The salt lives in Redis for two days and is then
//   gone, so a hash can't be traced back to an address or linked to another day's.
// - the page path, without its query or fragment (that's where reset and verification tokens go);
// - the host of the site that linked here, if any;
// - how many times that visitor viewed that page that day.
// No address, cookie or account. Signed-in players aren't counted here: their days are in
// market.user_active_days. Rows older than VISIT_RETENTION_DAYS (90) are deleted
// (referrals.startReferralScheduler runs pruneOldVisits).

const crypto = require("node:crypto");
const { clientIp } = require("../rateLimit");
const { ipKey } = require("./ipHash");

const TIME_ZONE = "America/New_York";
const SALT_TTL_SECONDS = 2 * 86_400;
const FALLBACK_SALT_MS = 60_000;
const MAX_PATH = 200;
const MAX_HOST = 100;
// Every value from the request is cut to this before any regex runs on it. A path or referrer
// longer than this isn't one we'd keep anyway.
const MAX_RAW = 2048;
const MAX_USER_AGENT = 512;
// Link unfurlers, crawlers and scripts. Most never run the page's JavaScript, so never call in;
// these are the ones that do.
const BOTS = /\bbot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|prerender|puppeteer|playwright|phantom|selenium|python|curl|wget|httpclient|okhttp|monitor|uptime/i;

function retentionDays(env = process.env) {
  const days = Number(env.VISIT_RETENTION_DAYS);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 90;
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The New York calendar day, "2026-11-05". */
function dayKey(date = new Date()) {
  return dayFormat.format(date);
}

const salts = new Map(); // day -> { salt, until }

/**
 * The day's salt: shared by every API process through Redis (whoever asks first makes it), and
 * expired by Redis after two days. Without Redis, a salt of this process's own, tried again a
 * minute later.
 */
async function dailySalt(redis, day, now = Date.now()) {
  const cached = salts.get(day);
  if (cached && cached.until > now) return cached.salt;
  let salt = null;
  if (redis) {
    try {
      const key = `nasfaq:visits:salt:${day}`;
      await redis.set(key, crypto.randomBytes(32).toString("hex"), { NX: true, EX: SALT_TTL_SECONDS });
      salt = await redis.get(key);
    } catch {
      salt = null;
    }
  }
  const shared = Boolean(salt);
  if (!salt) salt = cached?.salt || crypto.randomBytes(32).toString("hex");
  for (const key of salts.keys()) if (key < day) salts.delete(key);
  salts.set(day, { salt, until: shared ? Infinity : now + FALLBACK_SALT_MS });
  return salt;
}

/** The stored hash for one visitor on one day. */
function visitorHash(salt, ip, userAgent) {
  return crypto
    .createHmac("sha256", salt)
    .update(`${ipKey(ip) ?? ""}|${String(userAgent ?? "").slice(0, 300)}`)
    .digest("hex")
    .slice(0, 32);
}

/** A page path as stored: no query or fragment, at most 200 characters, or null. */
function cleanPath(value) {
  let path = String(value ?? "").slice(0, MAX_RAW).split(/[?#]/)[0].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  path = path.replace(/\/{2,}/g, "/");
  // Runs of slashes are one slash by now, so at most one is left at the end.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.length > MAX_PATH || !/^\/[A-Za-z0-9/_\-.~%:@!$&'()*+,;=]*$/.test(path)) return null;
  return path;
}

/** The referring site's host ("www." dropped), or null for none, our own pages or anything odd. */
function cleanReferrerHost(value, ownHosts = new Set()) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value).slice(0, MAX_RAW));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host.length > MAX_HOST || ownHosts.has(host)) return null;
  return host;
}

function ownHosts(req) {
  const hosts = new Set(["holo.nasfaq.biz", "localhost", "127.0.0.1"]);
  for (const value of [process.env.APP_URL, process.env.PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    try {
      if (value) hosts.add(new URL(value).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {}
  }
  const header = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .slice(0, MAX_HOST * 3)
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (header) hosts.add(header.replace(/:\d+$/, "").replace(/^www\./, ""));
  return hosts;
}

const isBot = (userAgent) => !userAgent || BOTS.test(String(userAgent).slice(0, MAX_USER_AGENT));

/**
 * Counts one page view from a signed-out visitor. Returns { counted, reason }: signed-in players,
 * bots and bad paths aren't counted.
 */
async function recordVisit(pool, redis, req, body, { now = new Date() } = {}) {
  if (req.ctx?.user) return { counted: false, reason: "signed_in" };
  const userAgent = String(req.headers?.["user-agent"] || "").slice(0, MAX_USER_AGENT);
  if (isBot(userAgent)) return { counted: false, reason: "bot" };
  const path = cleanPath(body?.path);
  if (!path) return { counted: false, reason: "invalid_path" };
  const day = dayKey(now);
  const hash = visitorHash(await dailySalt(redis, day, now.getTime()), clientIp(req), userAgent);
  await pool.query(
    `
    INSERT INTO market.site_visits (day, visitor_hash, path, referrer_host)
    VALUES ($1::date, $2, $3, $4)
    ON CONFLICT (day, visitor_hash, path) DO UPDATE
      SET views = LEAST(market.site_visits.views + 1, 100000),
          referrer_host = COALESCE(market.site_visits.referrer_host, EXCLUDED.referrer_host)
  `,
    [day, hash, path, cleanReferrerHost(body?.referrer, ownHosts(req))]
  );
  return { counted: true, reason: null };
}

/** Deletes visit rows older than the retention limit. Returns how many. */
async function pruneOldVisits(pool, { days = retentionDays(), now = new Date() } = {}) {
  const { rowCount } = await pool.query(`DELETE FROM market.site_visits WHERE day < $1::date - $2::int`, [dayKey(now), days]);
  return rowCount || 0;
}

module.exports = { TIME_ZONE, cleanPath, cleanReferrerHost, dailySalt, dayKey, isBot, pruneOldVisits, recordVisit, retentionDays, visitorHash };
