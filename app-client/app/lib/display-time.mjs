// How clock times show: New York market time (ET) or the player's own (timezone-setting flag; the
// picker is the Display section of /settings). Plain JavaScript so `npm test` runs it without a build
// (display-time.test.mjs). React reads it through lib/use-display-time.ts.
//
// Only what's displayed changes. Which market day it is, the ticks, the check-in reset and the
// Saturday review are New York time whatever the player picks (lib/market-clock.ts keeps those).
//
// A display is in one of four modes:
// - "server": the server render and hydration, before the page knows the browser's zone. Every time
//   shows in ET, so the HTML and the first client render agree.
// - "legacy": the flag is off for this viewer. Every spot shows what it showed before the setting
//   existed: most in ET, a few in the browser's own zone (`was: "local"`).
// - "market": the flag is on and times show in ET.
// - "local": the flag is on and times show in the browser's zone.

/** @typedef {"server" | "legacy" | "market" | "local"} DisplayMode */
/** @typedef {"market" | "local"} TimeZoneChoice */
/**
 * What a spot showed before the setting, which is what it keeps showing while the flag is off:
 * "et" is ET with the zone after it ("09:00 ET"), "bare" is ET without it, "local" is the browser's
 * zone without it.
 * @typedef {"et" | "bare" | "local"} LegacyStyle
 */
/**
 * @typedef {{
 *   was?: LegacyStyle;
 *   label?: boolean;
 *   alongside?: boolean;
 *   browserLocale?: boolean;
 * }} FormatHow
 */

export const MARKET_TIME_ZONE = "America/New_York";
const MARKET_ALIASES = new Set([MARKET_TIME_ZONE, "US/Eastern", "EST5EDT"]);

/** Whether a zone is New York time. */
export function isMarketZone(zone) {
  return MARKET_ALIASES.has(String(zone || ""));
}

/** The browser's zone (IANA name), or New York when it can't say. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || MARKET_TIME_ZONE;
  } catch {
    return MARKET_TIME_ZONE;
  }
}

const formatters = new Map();
/** A cached Intl.DateTimeFormat: building one is slow, and lists format hundreds of times. */
function formatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let hit = formatters.get(key);
  if (!hit) {
    try {
      hit = new Intl.DateTimeFormat(locale, options);
    } catch {
      // An unknown zone (an old browser, a made-up name): fall back to New York rather than throw.
      hit = new Intl.DateTimeFormat(locale, { ...options, timeZone: MARKET_TIME_ZONE });
    }
    formatters.set(key, hit);
  }
  return hit;
}

const toDate = (at) => (at instanceof Date ? at : new Date(at));

/** `at` formatted with these Intl options in `zone` (en-US unless `locale` says otherwise). "" for an invalid date. */
export function formatInZone(at, zone, options, locale = "en-US") {
  const date = toDate(at);
  if (Number.isNaN(date.getTime())) return "";
  return formatter(locale, { ...options, timeZone: zone }).format(date);
}

// Names Intl only gives in a language other than English.
const SHORT_NAMES = { "Asia/Tokyo": "JST", "Asia/Seoul": "KST" };
// English locales whose short zone names cover most players: en-US knows the Americas, en-GB Europe
// (CET, BST), en-AU Australia (AEDT), en-IN India (IST), en-NZ New Zealand (NZDT).
const NAME_LOCALES = ["en-US", "en-GB", "en-AU", "en-IN", "en-NZ"];

function shortName(locale, zone, at) {
  const date = toDate(at);
  if (Number.isNaN(date.getTime())) return "";
  return formatter(locale, { timeZone: zone, timeZoneName: "short" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * The zone's short name at `at`, for after a clock time: "ET" for New York (never EST or EDT, so it
 * reads the same all year), "JST", "PST", "CET", "AEDT", or an offset ("GMT+8") where English has no
 * name for it.
 */
export function zoneLabel(zone, at = Date.now()) {
  if (isMarketZone(zone)) return "ET";
  if (SHORT_NAMES[zone]) return SHORT_NAMES[zone];
  let offset = "";
  for (const locale of NAME_LOCALES) {
    const name = shortName(locale, zone, at);
    if (/^[A-Z]{2,5}$/.test(name)) return name;
    offset ||= name;
  }
  return offset || zone;
}

/** The place a zone is named after, for a sentence: "Tokyo", "Los Angeles", "Buenos Aires". */
export function zoneCity(zone) {
  const name = String(zone || "");
  if (isMarketZone(name)) return "New York";
  const last = name.split("/").pop() || name;
  return last.replace(/_/g, " ");
}

/**
 * The parts of `at` on a wall clock in `zone`: { year, month (1-12), day, hour (0-23), minute,
 * second, weekday (0 = Sunday) }. For laying times out by day and hour (the stream calendar).
 */
export function wallClock(at, zone) {
  const parts = formatter("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  }).formatToParts(toDate(at));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** Minutes `zone` is ahead of UTC at `at` (New York in winter: -300). */
export function zoneOffsetMinutes(at, zone) {
  const date = toDate(at);
  const wall = wallClock(date, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a wall-clock time in `zone` happens: zonedInstant(2026, 11, 16, 9, 0, "America/New_York"). */
export function zonedInstant(year, month, day, hour, minute, zone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle a guess that crossed a daylight-saving change.
  let at = guess - zoneOffsetMinutes(guess, zone) * 60_000;
  at = guess - zoneOffsetMinutes(at, zone) * 60_000;
  return at;
}

/**
 * Which mode a display is in. Before the page has mounted it's always "server"; after, the flag
 * decides between "legacy" and the player's pick (none yet counts as New York time).
 * @param {{ mounted: boolean; flagOn: boolean; choice: TimeZoneChoice | null }} state
 * @returns {DisplayMode}
 */
export function displayMode({ mounted, flagOn, choice }) {
  if (!mounted) return "server";
  if (!flagOn) return "legacy";
  return choice === "local" ? "local" : "market";
}

const HAS_CLOCK = (options) => Boolean(options && (options.hour || options.minute || options.timeStyle));
const CLOCK_24H = { hour12: false, hour: "2-digit", minute: "2-digit" };
// toLocaleString()'s own defaults.
const STAMP = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" };

/**
 * The formatter every spot uses. `mode` from displayMode; `browserZone` once mounted.
 * @param {{ mode: DisplayMode; browserZone?: string }} config
 */
export function makeTimeFormat({ mode, browserZone = MARKET_TIME_ZONE }) {
  const localZone = browserZone || MARKET_TIME_ZONE;
  const flagged = mode === "market" || mode === "local";
  /** @param {LegacyStyle} was */
  const zoneFor = (was) => (mode === "local" || (mode === "legacy" && was === "local") ? localZone : MARKET_TIME_ZONE);
  /** @param {FormatHow} how */
  const labelled = (how) => {
    if (how.label === false) return false;
    if (flagged) return true;
    return (how.was ?? "et") === "et";
  };

  const self = {
    mode,
    /** Whether times show in the player's own zone (the flag is on, they picked it, and it isn't New York). */
    local: mode === "local" && !isMarketZone(localZone),
    /** The zone times show in, for a spot that showed ET before. */
    zone: zoneFor("et"),
    /** The browser's own zone ("America/New_York" until mounted). */
    browserZone: localZone,
    /** The short name of the zone times show in: "ET", "JST". */
    label(at = Date.now(), how = {}) {
      return zoneLabel(zoneFor(how.was ?? "et"), at);
    },
    /**
     * `at` with these Intl options (no timeZone) in the display zone. When they include a clock, the
     * zone's name goes after it ("Mon 09:00 ET", "Mon 23:00 JST") unless `label: false`, or the flag
     * is off and the spot didn't show one before. `alongside: true` adds New York time in brackets
     * when the time shows in another zone, for schedule lines that belong to a New York day.
     * @param {string | number | Date} at
     * @param {Intl.DateTimeFormatOptions} options
     * @param {FormatHow} [how]
     */
    format(at, options, how = {}) {
      const zone = zoneFor(how.was ?? "et");
      // A spot that used the browser's language (toLocaleString(undefined, …)) keeps it while the flag is off.
      const text = formatInZone(at, zone, options, mode === "legacy" && how.browserLocale ? undefined : "en-US");
      if (!text || !HAS_CLOCK(options)) return text;
      const withLabel = labelled(how) ? `${text} ${zoneLabel(zone, at)}` : text;
      if (how.alongside && flagged && !isMarketZone(zone)) return `${withLabel} (${formatInZone(at, MARKET_TIME_ZONE, CLOCK_24H)} ET)`;
      return withLabel;
    },
    /**
     * A 24-hour clock time, "09:00 ET" ("09:00:05 ET" with seconds), the shape the market's times
     * have always had. Same `how` as format.
     * @param {string | number | Date} at
     * @param {{ seconds?: boolean } & FormatHow} [how]
     */
    clock(at, how = {}) {
      return self.format(at, how.seconds ? { ...CLOCK_24H, second: "2-digit" } : CLOCK_24H, how);
    },
    /**
     * A full date and time for a tooltip (title=…), what toLocaleString() gives: "11/16/2026, 9:05:00 AM".
     * Before the setting these were in the browser's zone and language, which they keep while the
     * flag is off; with it on they follow the pick and name the zone.
     * @param {string | number | Date} at
     */
    stamp(at) {
      return self.format(at, STAMP, { was: "local", browserLocale: true });
    },
  };
  return self;
}
