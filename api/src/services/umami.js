const { zonedTime } = require("./ipo");

// Site traffic for /admin/analytics, read from our Umami instance. Both sites report to it under their
// own website id (not a secret: each id is in that site's HTML). UMAMI_API_KEY is a secret: it stays
// on the server, and the browser only ever gets the numbers.

const DEFAULT_BASE_URL = "https://umami.fukuin.dev";
const TIME_ZONE = "America/New_York";
const REQUEST_TIMEOUT_MS = 10_000;
const LIST_LIMIT = 15;
const MAX_RANGE_DAYS = 366;
// A range this short gets a bar per hour; anything longer, a bar per day.
const HOURLY_MAX_DAYS = 2;
// Umami stores a referrer's domain without "www.".
const V1_REFERRER = "nasfaq.biz";

const SITES = {
  v2: { id: "1aaf939c-cd8e-4e9d-bef7-cb4739440bae", host: "holo.nasfaq.biz" },
  v1: { id: "4c6483af-2b83-42c8-8e52-fe5541f9af78", host: "nasfaq.biz" },
};

function analyticsError(code) {
  return Object.assign(new Error(code), { code });
}

function umamiConfig(env = process.env) {
  const apiKey = String(env.UMAMI_API_KEY || "").trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: String(env.UMAMI_BASE_URL || "").trim().replace(/\/+$/, "") || DEFAULT_BASE_URL };
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDay(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** `from` and `to` are whole days in New York, `to` included, and the range stops at `now`. */
function parseRange(from, to, now) {
  if (!isDateKey(from) || !isDateKey(to) || from > to) throw analyticsError("invalid_range");
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  const startAt = zonedTime(from, 0, 0, TIME_ZONE).getTime();
  if (days > MAX_RANGE_DAYS || startAt > now.getTime()) throw analyticsError("invalid_range");
  const endAt = Math.min(zonedTime(nextDay(to), 0, 0, TIME_ZONE).getTime() - 1, now.getTime());
  return { startAt, endAt, unit: days <= HOURLY_MAX_DAYS ? "hour" : "day" };
}

const count = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const rows = (value) => (Array.isArray(value) ? value : []);

function totals(stats) {
  return {
    visitors: count(stats?.visitors),
    visits: count(stats?.visits),
    pageviews: count(stats?.pageviews),
    bounces: count(stats?.bounces),
    total_time_sec: count(stats?.totaltime),
  };
}

function ranked(metrics) {
  return rows(metrics)
    .map((row) => ({ label: String(row?.x ?? "").trim(), count: count(row?.y) }))
    .filter((row) => row.label);
}

/** Umami only returns the days or hours that had traffic, as "2026-10-31 13:00:00". Fills in the rest. */
function buildSeries({ from, to, unit, now }, pageviews, sessions) {
  const keyOf = (x) => String(x).slice(0, unit === "hour" ? 13 : 10);
  const byKey = (list) => new Map(rows(list).map((row) => [keyOf(row?.x), count(row?.y)]));
  const views = byKey(pageviews);
  const visitors = byKey(sessions);
  const point = (at) => ({ at, pageviews: views.get(at) ?? 0, visitors: visitors.get(at) ?? 0 });

  const series = [];
  for (let day = from; day <= to; day = nextDay(day)) {
    if (unit === "day") {
      if (zonedTime(day, 0, 0, TIME_ZONE) <= now) series.push(point(day));
      continue;
    }
    for (let hour = 0; hour < 24; hour += 1) {
      if (zonedTime(day, hour, 0, TIME_ZONE) <= now) series.push(point(`${day} ${String(hour).padStart(2, "0")}`));
    }
  }
  return series;
}

/** Everything /admin/analytics shows for one site over a date range. */
async function siteAnalytics({ site, from, to }, { env = process.env, fetchImpl = fetch, logger = console, now = new Date() } = {}) {
  const target = Object.hasOwn(SITES, site) ? SITES[site] : null;
  if (!target) throw analyticsError("invalid_site");
  const { startAt, endAt, unit } = parseRange(from, to, now);
  const config = umamiConfig(env);
  if (!config) throw analyticsError("analytics_not_configured");

  const get = async (path, params = {}) => {
    const url = new URL(`/api/websites/${target.id}/${path}`, config.baseUrl);
    for (const [key, value] of Object.entries({ startAt, endAt, ...params })) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      logger.error(`umami ${path} failed: ${error?.message || error}`);
      throw analyticsError("analytics_unavailable");
    }
    if (response.status === 401 || response.status === 403) {
      logger.error(`umami ${path} failed: ${response.status}`);
      throw analyticsError("analytics_forbidden");
    }
    if (!response.ok) {
      logger.error(`umami ${path} failed: ${response.status}`);
      throw analyticsError("analytics_unavailable");
    }
    try {
      return await response.json();
    } catch {
      logger.error(`umami ${path} failed: the response wasn't JSON`);
      throw analyticsError("analytics_unavailable");
    }
  };
  const metrics = (type) => get("metrics", { type, limit: LIST_LIMIT });

  const [stats, chart, pages, referrers, countries, campaigns, fromV1] = await Promise.all([
    get("stats"),
    get("pageviews", { unit, timezone: TIME_ZONE }),
    metrics("path"),
    metrics("referrer"),
    metrics("country"),
    metrics("utmCampaign"),
    site === "v2" ? get("stats", { referrer: V1_REFERRER }) : null,
  ]);

  return {
    site,
    host: target.host,
    from,
    to,
    unit,
    time_zone: TIME_ZONE,
    generated_at: now.toISOString(),
    totals: totals(stats),
    previous: totals(stats?.comparison),
    series: buildSeries({ from, to, unit, now }, chart?.pageviews, chart?.sessions),
    pages: ranked(pages),
    referrers: ranked(referrers),
    countries: ranked(countries),
    campaigns: ranked(campaigns),
    from_v1: fromV1 ? totals(fromV1) : null,
  };
}

module.exports = { SITES, siteAnalytics, umamiConfig };
