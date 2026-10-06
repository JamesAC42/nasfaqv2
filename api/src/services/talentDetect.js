// Finds talents on hololive's official site that we don't track yet. A Node port of the Go
// channelscraper (channelscraper/internal/scraper), so detection runs inside the API with no Go
// toolchain: the talents index lists every profile; each profile page gives the names, YouTube channel,
// X handle, birthday, unit and the full-body reference picture.
//
//   scrapeTalents({ skipProfileIds })  every talent on the site (minus skipped profiles)
//   detectNewTalents(pool)             the ones not already saved as a channel, with suggested tickers

const cheerio = require("cheerio");

const LIST_URL = "https://hololive.hololivepro.com/en/talents/";
const USER_AGENT = "NASFAQV2 Channels Scraper/1.0 (+https://hololive.hololivepro.com/en/talents/)";
const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
const BIRTHDAY_YEAR = 2000; // birthdays are stored as dates; only the month and day mean anything

// Profiles on the site that aren't market talents (staff, affiliates, graduated pages kept up).
const IGNORED_PROFILE_IDS = new Set(["friend-a", "hanazono-sayaka", "harusaki-nodoka", "izuki-michiru", "kazeshiro-yuki"]);

const YOUTUBE_CHANNEL_ID_PATTERNS = [
  /"externalId":"(UC[a-zA-Z0-9_-]+)"/,
  /"channelId":"(UC[a-zA-Z0-9_-]+)"/,
  /https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/,
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function cleanWhitespace(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).join(" ");
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

async function fetchText(url, { limitBytes = 4 << 20 } = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const text = await response.text();
  return { text: text.length > limitBytes ? text.slice(0, limitBytes) : text, finalUrl: response.url || url };
}

/** "talents/<id>" or "en/talents/<id>" → id. */
function profileIdFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 2 && parts[0] === "talents" && parts[1]) return parts[1];
  if (parts.length === 3 && parts[0] === "en" && parts[1] === "talents" && parts[2]) return parts[2];
  return "";
}

function discoverProfileUrls(html, listUrl, skip) {
  const $ = cheerio.load(html);
  const seen = new Set();
  $("a[href]").each((_, element) => {
    let resolved;
    try {
      resolved = new URL($(element).attr("href"), listUrl);
    } catch {
      return;
    }
    const profileId = profileIdFromUrl(resolved.href);
    if (!profileId || skip.has(profileId)) return;
    resolved.search = "";
    resolved.hash = "";
    resolved.pathname = `${resolved.pathname.replace(/\/+$/, "")}/`;
    seen.add(resolved.href);
  });
  if (!seen.size) throw new Error("no talent profile links found");
  return [...seen].sort();
}

/** The last word of the English name ("Achichi Mela" → "Mela"), as the site writes family name first. */
function shortName(nameEnglish) {
  const fields = cleanWhitespace(nameEnglish).split(" ").filter(Boolean);
  return fields.length ? fields[fields.length - 1].replace(/^[()[\]]+|[()[\]]+$/g, "") : "";
}

function defaultIcon(nameEnglish, nameShort) {
  const source = shortName(nameEnglish) || cleanWhitespace(nameShort);
  return source.toLowerCase().replace(/[^a-z]/g, "") || null;
}

/** Three letters for a ticker: the start of her given name (MEL for Mela). Admins can change it. */
function suggestSymbol(nameEnglish, nameShort) {
  const letters = (shortName(nameEnglish) || cleanWhitespace(nameShort)).toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 3) || null;
}

function parseBirthday(raw) {
  const text = cleanWhitespace(raw).toLowerCase();
  const match = text.match(/^([a-z]+)\s+(\d{1,2})/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  const day = Number(match[2]);
  if (month < 0 || !(day >= 1 && day <= 31)) return null;
  return `${BIRTHDAY_YEAR}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Unit names as the market writes them ("hololive 2nd Generation", "ReGLOSS", "FLOW GLOW"). */
function normalizeUnit(raw) {
  const unit = cleanWhitespace(raw);
  return unit || null;
}

function referenceImageUrl($, baseUrl) {
  const candidates = [];
  $("img").each((_, element) => {
    const image = $(element);
    const alt = image.attr("alt") || "";
    for (const attr of ["src", "data-src", "data-lazy-src", "data-original"]) {
      const value = image.attr(attr);
      if (!value) continue;
      const lower = value.toLowerCase();
      if (!lower.includes("pr-img") && !lower.includes("pr-image") && !alt.includes("全身画像")) continue;
      try {
        candidates.push(new URL(value.trim(), baseUrl).href);
        return;
      } catch {
        // try the next attribute
      }
    }
  });
  const preferred = candidates.find((url) => /pr-img_01|pr-image_01/i.test(url));
  return preferred || candidates[0] || null;
}

async function resolveYouTubeChannelId(url) {
  const { text } = await fetchText(url);
  for (const pattern of YOUTUBE_CHANNEL_ID_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`could not resolve a YouTube channel id from ${url}`);
}

async function scrapeProfile(profileUrl) {
  const { text, finalUrl } = await fetchText(profileUrl);
  const $ = cheerio.load(text);
  const profileId = profileIdFromUrl(finalUrl);
  if (!profileId) throw new Error(`no profile id in ${finalUrl}`);

  let h1 = $("div.right_box div.bg_box h1").first();
  if (!h1.length) h1 = $("h1").first();
  if (!h1.length) throw new Error(`${profileId}: missing name`);
  const nameJapanese = cleanWhitespace(h1.find("span").first().text().replace(/[・･·]/g, " ")) || null;
  const ownText = h1.clone();
  ownText.find("span").remove();
  const nameEnglish = cleanWhitespace(ownText.text()).replace(/^\[[^\]]+\]\s*/, "");
  const nameShort = shortName(nameEnglish);
  if (!nameEnglish || !nameShort) throw new Error(`${profileId}: missing name`);

  let youtubeChannelId = "";
  let youtubeUrl = "";
  let twitterId = null;
  $("ul.t_sns a[href]").each((_, element) => {
    let href;
    try {
      href = new URL($(element).attr("href"));
    } catch {
      return;
    }
    const host = href.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com") {
      if (href.pathname.startsWith("/channel/") && !youtubeChannelId) youtubeChannelId = href.pathname.slice("/channel/".length).replace(/\/.*$/, "");
      else if (!youtubeUrl) youtubeUrl = href.href;
    } else if ((host === "twitter.com" || host === "x.com") && !twitterId) {
      twitterId = href.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || null;
    }
  });
  if (!youtubeChannelId && youtubeUrl) youtubeChannelId = await resolveYouTubeChannelId(youtubeUrl);
  if (!youtubeChannelId) throw new Error(`${profileId}: missing YouTube channel`);

  const fields = {};
  $("div.talent_data dl").each((_, element) => {
    const key = cleanWhitespace($(element).find("dt").first().text()).toLowerCase();
    if (key) fields[key] = cleanWhitespace($(element).find("dd").first().text());
  });

  return {
    youtube_channel_id: youtubeChannelId,
    name_short: nameShort,
    name_english: nameEnglish,
    name_japanese: nameJapanese,
    twitter_id: twitterId,
    profile_id: profileId,
    birthday: parseBirthday(fields.birthday),
    height: cleanWhitespace(fields.height) || null,
    unit: normalizeUnit(fields.unit),
    icon: defaultIcon(nameEnglish, nameShort),
    reference_image_url: referenceImageUrl($, finalUrl),
    profile_url: finalUrl,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

/** Every talent on the official site, minus skipped profiles. A profile that fails is reported, not fatal. */
async function scrapeTalents({ skipProfileIds = [], listUrl = LIST_URL } = {}) {
  const skip = new Set([...IGNORED_PROFILE_IDS, ...skipProfileIds.map(normalizeKey).filter(Boolean)]);
  const { text, finalUrl } = await fetchText(listUrl);
  const profileUrls = discoverProfileUrls(text, finalUrl, skip);
  const errors = [];
  const rows = await mapWithConcurrency(profileUrls, CONCURRENCY, async (url) => {
    try {
      return await scrapeProfile(url);
    } catch (error) {
      errors.push({ url, error: String(error?.message || error) });
      return null;
    }
  });
  return { talents: rows.filter(Boolean).sort((a, b) => a.profile_id.localeCompare(b.profile_id)), errors, profiles_checked: profileUrls.length };
}

/**
 * Talents on the site that aren't saved as channels yet (matched by YouTube id, name and profile),
 * each with a suggested ticker that's free.
 */
async function detectNewTalents(pool) {
  const { rows: channels } = await pool.query(`SELECT youtube_channel_id, name_short, profile_id, symbol FROM yt.youtube_channels`);
  const { rows: assets } = await pool.query(`SELECT symbol FROM market.market_assets`);
  const knownIds = new Set(channels.map((row) => row.youtube_channel_id));
  const knownNames = new Set(channels.map((row) => normalizeKey(row.name_short)).filter(Boolean));
  const knownProfiles = new Set(channels.map((row) => normalizeKey(row.profile_id)).filter(Boolean));
  const usedSymbols = new Set([...channels.map((row) => row.symbol), ...assets.map((row) => row.symbol)].filter(Boolean).map((symbol) => symbol.toUpperCase()));

  const scraped = await scrapeTalents({ skipProfileIds: [...knownProfiles] });
  const fresh = scraped.talents.filter(
    (talent) => !knownIds.has(talent.youtube_channel_id) && !knownNames.has(normalizeKey(talent.name_short)) && !knownProfiles.has(normalizeKey(talent.profile_id))
  );
  for (const talent of fresh) {
    let symbol = suggestSymbol(talent.name_english, talent.name_short);
    if (symbol && usedSymbols.has(symbol)) {
      const letters = shortName(talent.name_english).toUpperCase().replace(/[^A-Z]/g, "");
      const alternatives = [letters[0] + letters.slice(1).replace(/[AEIOU]/g, "").slice(0, 2), ...[...letters.slice(2)].map((letter) => letters.slice(0, 2) + letter)];
      symbol = alternatives.find((candidate) => candidate.length === 3 && !usedSymbols.has(candidate)) || null;
    }
    if (symbol) usedSymbols.add(symbol);
    talent.symbol = symbol;
    talent.youtube_channel_url = `https://www.youtube.com/channel/${talent.youtube_channel_id}`;
  }
  return { talents: fresh, errors: scraped.errors, profiles_checked: scraped.profiles_checked, checked_at: new Date().toISOString() };
}

module.exports = { scrapeTalents, detectNewTalents, suggestSymbol, parseBirthday, profileIdFromUrl, _test: { shortName, discoverProfileUrls } };
